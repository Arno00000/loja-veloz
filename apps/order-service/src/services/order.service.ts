import {
  EVENT_TYPES,
  ORDER_STATUS,
  buildPaginatedResult,
  toSkipTake,
  type OrderStatus,
  type PaginatedResult,
} from '@loja-veloz/shared-types';
import { NotFoundError, type Logger } from '@loja-veloz/observability';
import type { CreateOrderInput, ListOrdersQuery } from '../schemas/order.schema';
import type { OrderRecord, OrderRepository } from '../repositories/order.repository';
import type { OrderEventPublisher } from '../messaging/publishers';
import {
  orderEventsIgnoredTotal,
  orderInvalidTransitionsTotal,
  orderTransitionsTotal,
  ordersConfirmedTotal,
  ordersCreatedTotal,
  ordersFailedTotal,
} from '../metrics';

export interface OrderServiceOptions {
  repository: OrderRepository;
  publisher: OrderEventPublisher;
  logger: Logger;
}

export interface EventOutcome {
  status: 'applied' | 'duplicate' | 'ignored';
  reason?: string;
}

/**
 * Regra de arredondamento monetario do MVP.
 *
 * Valores em reais com duas casas. Somar floats acumula erro
 * (0.1 + 0.2 !== 0.3), entao a soma e feita em centavos inteiros e so no fim
 * volta para reais. A coluna no banco e DECIMAL(12,2), que nao sofre desse
 * problema. Para um sistema financeiro real, a evolucao indicada e trafegar
 * inteiros em centavos de ponta a ponta.
 */
export function calculateTotal(items: Array<{ quantity: number; unitPrice: number }>): number {
  const cents = items.reduce(
    (accumulator, item) => accumulator + Math.round(item.unitPrice * 100) * item.quantity,
    0
  );
  return cents / 100;
}

/**
 * Casos de uso do pedido.
 *
 * Este servico e o unico lugar do sistema autorizado a mudar o estado de um
 * pedido, e toda mudanca passa pela maquina de estados compartilhada.
 */
export class OrderService {
  constructor(private readonly options: OrderServiceOptions) {}

  /**
   * Cria o pedido e anuncia order.created.
   *
   * A ordem importa: o pedido e persistido em PENDING e so entao o evento e
   * publicado. Publicar antes de persistir permitiria que o Estoque reservasse
   * itens de um pedido que nao existe.
   *
   * Limitacao conhecida: entre o commit e o ack do publish existe uma janela
   * em que o processo pode morrer, deixando um pedido PENDING sem evento. O
   * remedio definitivo e o transactional outbox, registrado como evolucao
   * futura. Um pedido nessa situacao fica visivel na consulta e nas metricas,
   * e o runbook descreve como reprocessa-lo.
   */
  async createOrder(input: CreateOrderInput, correlationId: string): Promise<OrderRecord> {
    const total = calculateTotal(input.items);

    const order = await this.options.repository.create({
      customerId: input.customerId,
      total,
      items: input.items,
    });

    ordersCreatedTotal.inc();
    this.options.logger.info(
      { orderId: order.id, customerId: order.customerId, total, correlationId },
      'Pedido criado'
    );

    await this.options.publisher.publishOrderCreated(order, correlationId);

    return order;
  }

  async getOrder(id: string): Promise<OrderRecord> {
    const order = await this.options.repository.findById(id);
    if (!order) {
      throw new NotFoundError('Pedido', id);
    }
    return order;
  }

  async listOrders(query: ListOrdersQuery): Promise<PaginatedResult<OrderRecord>> {
    const { skip, take } = toSkipTake(query);
    const result = await this.options.repository.list({
      skip,
      take,
      status: query.status,
      customerId: query.customerId,
    });
    return buildPaginatedResult(result.items, result.total, query);
  }

  /** stock.reserved -> STOCK_RESERVED. */
  async handleStockReserved(
    eventId: string,
    orderId: string,
    correlationId: string
  ): Promise<EventOutcome> {
    return this.applyTransition({
      eventId,
      eventType: EVENT_TYPES.STOCK_RESERVED,
      orderId,
      targetStatus: ORDER_STATUS.STOCK_RESERVED,
      correlationId,
    });
  }

  /** stock.failed -> STOCK_FAILED, seguido de order.failed. */
  async handleStockFailed(
    eventId: string,
    orderId: string,
    reason: string,
    correlationId: string
  ): Promise<EventOutcome> {
    return this.applyTransition({
      eventId,
      eventType: EVENT_TYPES.STOCK_FAILED,
      orderId,
      targetStatus: ORDER_STATUS.STOCK_FAILED,
      correlationId,
      onApplied: async (order) => {
        ordersFailedTotal.inc({ reason: 'stock' });
        await this.options.publisher.publishOrderFailed(order, reason, correlationId, eventId);
      },
    });
  }

  /** payment.approved -> CONFIRMED, seguido de order.confirmed. */
  async handlePaymentApproved(
    eventId: string,
    orderId: string,
    correlationId: string
  ): Promise<EventOutcome> {
    return this.applyTransition({
      eventId,
      eventType: EVENT_TYPES.PAYMENT_APPROVED,
      orderId,
      targetStatus: ORDER_STATUS.CONFIRMED,
      correlationId,
      onApplied: async (order) => {
        ordersConfirmedTotal.inc();
        await this.options.publisher.publishOrderConfirmed(order, correlationId, eventId);
      },
    });
  }

  /**
   * payment.failed -> PAYMENT_FAILED.
   *
   * Alem de order.failed, dispara stock.release.requested para que o Estoque
   * devolva as quantidades reservadas. A confirmacao (stock.released) chega
   * depois e serve apenas para auditoria: o estado final do pedido continua
   * sendo PAYMENT_FAILED.
   */
  async handlePaymentFailed(
    eventId: string,
    orderId: string,
    reason: string,
    correlationId: string
  ): Promise<EventOutcome> {
    return this.applyTransition({
      eventId,
      eventType: EVENT_TYPES.PAYMENT_FAILED,
      orderId,
      targetStatus: ORDER_STATUS.PAYMENT_FAILED,
      correlationId,
      onApplied: async (order) => {
        ordersFailedTotal.inc({ reason: 'payment' });
        await this.options.publisher.publishOrderFailed(order, reason, correlationId, eventId);
        await this.options.publisher.publishStockReleaseRequested(
          order.id,
          reason,
          correlationId,
          eventId
        );
      },
    });
  }

  private async applyTransition(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    targetStatus: OrderStatus;
    correlationId: string;
    onApplied?: (order: OrderRecord) => Promise<void>;
  }): Promise<EventOutcome> {
    const result = await this.options.repository.applyEvent({
      eventId: params.eventId,
      eventType: params.eventType,
      orderId: params.orderId,
      targetStatus: params.targetStatus,
    });

    if (result.outcome === 'duplicate') {
      orderEventsIgnoredTotal.inc({ reason: 'duplicate' });
      this.options.logger.info(
        {
          eventId: params.eventId,
          eventType: params.eventType,
          orderId: params.orderId,
          correlationId: params.correlationId,
        },
        'Evento ja processado anteriormente, ignorado'
      );
      return { status: 'duplicate' };
    }

    if (result.outcome === 'order_not_found') {
      // Nao adianta reprocessar: um pedido inexistente nao vai passar a
      // existir. O evento e absorvido aqui e registrado como anomalia.
      orderEventsIgnoredTotal.inc({ reason: 'order_not_found' });
      this.options.logger.error(
        {
          eventId: params.eventId,
          eventType: params.eventType,
          orderId: params.orderId,
          correlationId: params.correlationId,
        },
        'Evento recebido para pedido inexistente'
      );
      return { status: 'ignored', reason: 'order_not_found' };
    }

    if (result.outcome === 'invalid_transition') {
      // Acontece quando um evento chega fora de ordem ou depois que o pedido
      // ja atingiu um estado terminal. Nao e erro de infraestrutura, entao
      // nao vai para retry: seria reprocessado indefinidamente com o mesmo
      // resultado.
      orderInvalidTransitionsTotal.inc({
        from: result.currentStatus,
        to: params.targetStatus,
      });
      this.options.logger.warn(
        {
          eventId: params.eventId,
          eventType: params.eventType,
          orderId: params.orderId,
          currentStatus: result.currentStatus,
          targetStatus: params.targetStatus,
          correlationId: params.correlationId,
        },
        'Transicao de estado rejeitada'
      );
      return { status: 'ignored', reason: 'invalid_transition' };
    }

    orderTransitionsTotal.inc({ from: result.previousStatus, to: params.targetStatus });
    this.options.logger.info(
      {
        eventId: params.eventId,
        eventType: params.eventType,
        orderId: params.orderId,
        from: result.previousStatus,
        to: params.targetStatus,
        correlationId: params.correlationId,
      },
      'Estado do pedido atualizado'
    );

    if (params.onApplied) {
      await params.onApplied(result.order);
    }

    return { status: 'applied' };
  }
}
