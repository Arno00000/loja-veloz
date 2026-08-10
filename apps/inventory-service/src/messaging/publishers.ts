import { EVENT_TYPES } from '@loja-veloz/shared-types';
import type { EventPublisher } from '@loja-veloz/messaging';
import type { ReleasedItem, RequestedItem } from '../repositories/inventory.repository';

/**
 * Fachada de publicacao do Servico de Estoque.
 *
 * `stock.reserved` repassa customerId e total recebidos em order.created.
 * Isso permite que o Servico de Pagamentos trabalhe apenas com o evento, sem
 * consultar o banco de pedidos, o que preservaria o acoplamento que a
 * separacao de bancos pretende eliminar.
 */
export class InventoryEventPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  async publishStockReserved(params: {
    orderId: string;
    customerId: string;
    total: number;
    items: RequestedItem[];
    correlationId: string;
    causationId: string;
  }): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.STOCK_RESERVED,
      {
        orderId: params.orderId,
        customerId: params.customerId,
        total: params.total,
        items: params.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      },
      { correlationId: params.correlationId, causationId: params.causationId }
    );
  }

  async publishStockFailed(params: {
    orderId: string;
    customerId: string;
    reason: string;
    unavailableSkus: string[];
    correlationId: string;
    causationId: string;
  }): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.STOCK_FAILED,
      {
        orderId: params.orderId,
        customerId: params.customerId,
        reason: params.reason.slice(0, 256),
        unavailableSkus: params.unavailableSkus,
      },
      { correlationId: params.correlationId, causationId: params.causationId }
    );
  }

  async publishStockReleased(params: {
    orderId: string;
    releasedItems: ReleasedItem[];
    correlationId: string;
    causationId: string;
  }): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.STOCK_RELEASED,
      {
        orderId: params.orderId,
        releasedItems: params.releasedItems.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
        })),
      },
      { correlationId: params.correlationId, causationId: params.causationId }
    );
  }
}
