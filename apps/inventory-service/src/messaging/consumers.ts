import {
  EVENT_TYPES,
  type OrderCreatedPayload,
  type StockReleaseRequestedPayload,
} from '@loja-veloz/shared-types';
import {
  QUEUES,
  registerEventConsumer,
  type IdempotencyStore,
  type RabbitMQClient,
} from '@loja-veloz/messaging';
import type { Logger } from '@loja-veloz/observability';
import type { InventoryService } from '../services/inventory.service';

export interface RegisterConsumersOptions {
  client: RabbitMQClient;
  service: InventoryService;
  logger: Logger;
  maxRetries: number;
  idempotencyStore: IdempotencyStore;
}

export async function registerInventoryConsumers(options: RegisterConsumersOptions): Promise<void> {
  const { client, service, logger, maxRetries, idempotencyStore } = options;

  await registerEventConsumer({
    client,
    logger,
    maxRetries,
    idempotencyStore,
    queue: QUEUES.INVENTORY_ORDER_CREATED,
    handler: async (event, context) => {
      const payload = event.payload as OrderCreatedPayload;
      await service.handleOrderCreated({
        eventId: event.eventId,
        eventType: event.eventType,
        orderId: payload.orderId,
        customerId: payload.customerId,
        total: payload.total,
        items: payload.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
        correlationId: context.correlationId,
      });
    },
  });

  await registerEventConsumer({
    client,
    logger,
    maxRetries,
    idempotencyStore,
    queue: QUEUES.INVENTORY_STOCK_RELEASE,
    handler: async (event, context) => {
      if (event.eventType !== EVENT_TYPES.STOCK_RELEASE_REQUESTED) {
        logger.warn(
          { queue: context.queue, eventType: event.eventType },
          'Evento sem handler nesta fila, ignorado'
        );
        return;
      }

      const payload = event.payload as StockReleaseRequestedPayload;
      await service.handleReleaseRequested({
        eventId: event.eventId,
        eventType: event.eventType,
        orderId: payload.orderId,
        correlationId: context.correlationId,
      });
    },
  });
}
