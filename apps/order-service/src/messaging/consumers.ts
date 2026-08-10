import {
  EVENT_TYPES,
  type DomainEvent,
  type StockFailedPayload,
  type StockReservedPayload,
  type StockReleasedPayload,
  type PaymentApprovedPayload,
  type PaymentFailedPayload,
} from '@loja-veloz/shared-types';
import {
  QUEUES,
  registerEventConsumer,
  type IdempotencyStore,
  type RabbitMQClient,
} from '@loja-veloz/messaging';
import type { Logger } from '@loja-veloz/observability';
import type { OrderService } from '../services/order.service';

export interface RegisterConsumersOptions {
  client: RabbitMQClient;
  service: OrderService;
  logger: Logger;
  maxRetries: number;
  idempotencyStore: IdempotencyStore;
}

/**
 * Registra os tres consumidores do Servico de Pedidos.
 *
 * Nenhum handler decide sobre ack, retry ou DLQ: essa politica vive no pacote
 * de mensageria. O handler apenas processa ou lanca. Lancar significa "tente
 * de novo"; retornar significa "concluido".
 *
 * Eventos absorvidos deliberadamente (duplicata, transicao invalida, pedido
 * inexistente) retornam normalmente, porque reprocessa-los daria sempre o
 * mesmo resultado e so encheria a fila de retry.
 */
export async function registerOrderConsumers(options: RegisterConsumersOptions): Promise<void> {
  const { client, service, logger, maxRetries, idempotencyStore } = options;

  await registerEventConsumer({
    client,
    logger,
    maxRetries,
    idempotencyStore,
    queue: QUEUES.ORDERS_STOCK_RESULT,
    handler: async (event, context) => {
      if (event.eventType === EVENT_TYPES.STOCK_RESERVED) {
        const payload = event.payload as StockReservedPayload;
        await service.handleStockReserved(event.eventId, payload.orderId, context.correlationId);
        return;
      }

      if (event.eventType === EVENT_TYPES.STOCK_FAILED) {
        const payload = event.payload as StockFailedPayload;
        await service.handleStockFailed(
          event.eventId,
          payload.orderId,
          payload.reason,
          context.correlationId
        );
        return;
      }

      logUnexpected(logger, event, context.queue);
    },
  });

  await registerEventConsumer({
    client,
    logger,
    maxRetries,
    idempotencyStore,
    queue: QUEUES.ORDERS_PAYMENT_RESULT,
    handler: async (event, context) => {
      if (event.eventType === EVENT_TYPES.PAYMENT_APPROVED) {
        const payload = event.payload as PaymentApprovedPayload;
        await service.handlePaymentApproved(event.eventId, payload.orderId, context.correlationId);
        return;
      }

      if (event.eventType === EVENT_TYPES.PAYMENT_FAILED) {
        const payload = event.payload as PaymentFailedPayload;
        await service.handlePaymentFailed(
          event.eventId,
          payload.orderId,
          payload.reason,
          context.correlationId
        );
        return;
      }

      logUnexpected(logger, event, context.queue);
    },
  });

  // Trilha de auditoria. Consome stock.released apenas para registrar que a
  // devolucao de estoque aconteceu. Nao altera o estado do pedido: apos uma
  // falha de pagamento o estado final continua sendo PAYMENT_FAILED.
  await registerEventConsumer({
    client,
    logger,
    maxRetries,
    queue: QUEUES.ORDERS_AUDIT,
    handler: async (event, context) => {
      const payload = event.payload as StockReleasedPayload;
      logger.info(
        {
          orderId: payload.orderId,
          eventId: event.eventId,
          correlationId: context.correlationId,
          releasedItems: payload.releasedItems.length,
        },
        'Auditoria: estoque devolvido apos falha de pagamento'
      );
    },
  });
}

function logUnexpected(logger: Logger, event: DomainEvent<unknown>, queue: string): void {
  logger.warn(
    { queue, eventType: event.eventType, eventId: event.eventId },
    'Evento sem handler nesta fila, ignorado'
  );
}
