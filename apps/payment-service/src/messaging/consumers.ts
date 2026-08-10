import { EVENT_TYPES, type StockReservedPayload } from '@loja-veloz/shared-types';
import {
  QUEUES,
  registerEventConsumer,
  type IdempotencyStore,
  type RabbitMQClient,
} from '@loja-veloz/messaging';
import type { Logger } from '@loja-veloz/observability';
import type { PaymentService } from '../services/payment.service';

export interface RegisterConsumersOptions {
  client: RabbitMQClient;
  service: PaymentService;
  logger: Logger;
  maxRetries: number;
  idempotencyStore: IdempotencyStore;
}

/**
 * O Servico de Pagamentos so entra em cena depois que o estoque foi
 * reservado. Ele nunca consome order.created diretamente: cobrar antes de
 * confirmar disponibilidade geraria estorno em todo pedido sem estoque.
 */
export async function registerPaymentConsumers(options: RegisterConsumersOptions): Promise<void> {
  const { client, service, logger, maxRetries, idempotencyStore } = options;

  await registerEventConsumer({
    client,
    logger,
    maxRetries,
    idempotencyStore,
    queue: QUEUES.PAYMENTS_STOCK_RESERVED,
    handler: async (event, context) => {
      if (event.eventType !== EVENT_TYPES.STOCK_RESERVED) {
        logger.warn(
          { queue: context.queue, eventType: event.eventType },
          'Evento sem handler nesta fila, ignorado'
        );
        return;
      }

      const payload = event.payload as StockReservedPayload;
      await service.handleStockReserved({
        eventId: event.eventId,
        eventType: event.eventType,
        orderId: payload.orderId,
        customerId: payload.customerId,
        amount: payload.total,
        correlationId: context.correlationId,
      });
    },
  });
}
