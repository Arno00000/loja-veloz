import { NotFoundError, type Logger } from '@loja-veloz/observability';
import type {
  InventoryItemRecord,
  InventoryRepository,
  RequestedItem,
} from '../repositories/inventory.repository';
import type { InventoryEventPublisher } from '../messaging/publishers';
import {
  inventoryEventsIgnoredTotal,
  restockOperationsTotal,
  stockReleasesTotal,
  stockReservationFailuresTotal,
  stockReservationsTotal,
} from '../metrics';

export interface InventoryServiceOptions {
  repository: InventoryRepository;
  publisher: InventoryEventPublisher;
  logger: Logger;
}

export interface HandleOutcome {
  status: 'reserved' | 'failed' | 'released' | 'duplicate' | 'ignored';
  reason?: string;
}

export class InventoryService {
  constructor(private readonly options: InventoryServiceOptions) {}

  async getBySku(sku: string): Promise<InventoryItemRecord> {
    const item = await this.options.repository.findBySku(sku);
    if (!item) {
      throw new NotFoundError('SKU', sku);
    }
    return item;
  }

  async restock(sku: string, quantity: number, description?: string): Promise<InventoryItemRecord> {
    const item = await this.options.repository.restock(sku, quantity, description);
    restockOperationsTotal.inc();
    this.options.logger.warn(
      { sku, quantity, availableQuantity: item.availableQuantity },
      'Reposicao manual de estoque pelo endpoint academico'
    );
    return item;
  }

  /**
   * Reage a order.created.
   *
   * Sempre publica exatamente um resultado: stock.reserved ou stock.failed.
   * O Servico de Pedidos depende disso para nao ficar preso em PENDING.
   */
  async handleOrderCreated(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    customerId: string;
    total: number;
    items: RequestedItem[];
    correlationId: string;
  }): Promise<HandleOutcome> {
    const result = await this.options.repository.reserve({
      eventId: params.eventId,
      eventType: params.eventType,
      orderId: params.orderId,
      items: params.items,
    });

    if (result.outcome === 'duplicate') {
      inventoryEventsIgnoredTotal.inc({ reason: 'duplicate' });
      this.options.logger.info(
        { orderId: params.orderId, eventId: params.eventId, correlationId: params.correlationId },
        'order.created duplicado, reserva ja processada'
      );
      return { status: 'duplicate' };
    }

    if (result.outcome === 'insufficient') {
      stockReservationFailuresTotal.inc({ reason: 'insufficient_stock' });
      const reason = `Estoque insuficiente para: ${result.unavailableSkus.join(', ')}`;

      this.options.logger.warn(
        {
          orderId: params.orderId,
          unavailableSkus: result.unavailableSkus,
          correlationId: params.correlationId,
        },
        'Reserva de estoque recusada'
      );

      await this.options.publisher.publishStockFailed({
        orderId: params.orderId,
        customerId: params.customerId,
        reason,
        unavailableSkus: result.unavailableSkus,
        correlationId: params.correlationId,
        causationId: params.eventId,
      });

      return { status: 'failed', reason };
    }

    stockReservationsTotal.inc();
    this.options.logger.info(
      {
        orderId: params.orderId,
        items: result.items.length,
        correlationId: params.correlationId,
      },
      'Estoque reservado'
    );

    await this.options.publisher.publishStockReserved({
      orderId: params.orderId,
      customerId: params.customerId,
      total: params.total,
      items: result.items,
      correlationId: params.correlationId,
      causationId: params.eventId,
    });

    return { status: 'reserved' };
  }

  /**
   * Reage a stock.release.requested apos falha de pagamento.
   *
   * Publica stock.released para fechar a trilha de auditoria. Esse evento nao
   * altera o estado do pedido, que permanece PAYMENT_FAILED.
   */
  async handleReleaseRequested(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    correlationId: string;
  }): Promise<HandleOutcome> {
    const result = await this.options.repository.release({
      eventId: params.eventId,
      eventType: params.eventType,
      orderId: params.orderId,
    });

    if (result.outcome === 'duplicate') {
      inventoryEventsIgnoredTotal.inc({ reason: 'duplicate' });
      return { status: 'duplicate' };
    }

    if (result.outcome === 'nothing_to_release') {
      // Acontece quando o pedido falhou no proprio estoque: nunca houve
      // reserva para devolver. Nao e erro.
      inventoryEventsIgnoredTotal.inc({ reason: 'nothing_to_release' });
      this.options.logger.info(
        { orderId: params.orderId, correlationId: params.correlationId },
        'Nenhuma reserva ativa para liberar'
      );
      return { status: 'ignored', reason: 'nothing_to_release' };
    }

    stockReleasesTotal.inc();
    this.options.logger.info(
      {
        orderId: params.orderId,
        releasedItems: result.items.length,
        correlationId: params.correlationId,
      },
      'Reserva de estoque liberada'
    );

    await this.options.publisher.publishStockReleased({
      orderId: params.orderId,
      releasedItems: result.items,
      correlationId: params.correlationId,
      causationId: params.eventId,
    });

    return { status: 'released' };
  }
}
