import { EVENT_TYPES } from '@loja-veloz/shared-types';
import type { EventPublisher } from '@loja-veloz/messaging';
import type { OrderRecord } from '../repositories/order.repository';

/**
 * Fachada de publicacao do Servico de Pedidos.
 *
 * Existe para que a camada de servico nao monte payloads a mao em varios
 * lugares. Todo evento sai daqui com o formato exato do contrato compartilhado.
 */
export class OrderEventPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  async publishOrderCreated(order: OrderRecord, correlationId: string): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.ORDER_CREATED,
      {
        orderId: order.id,
        customerId: order.customerId,
        total: order.total,
        items: order.items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
      { correlationId }
    );
  }

  async publishOrderConfirmed(
    order: OrderRecord,
    correlationId: string,
    causationId: string
  ): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.ORDER_CONFIRMED,
      { orderId: order.id, customerId: order.customerId, total: order.total },
      { correlationId, causationId }
    );
  }

  async publishOrderFailed(
    order: OrderRecord,
    reason: string,
    correlationId: string,
    causationId: string
  ): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.ORDER_FAILED,
      {
        orderId: order.id,
        customerId: order.customerId,
        status: order.status,
        reason: reason.slice(0, 256),
      },
      { correlationId, causationId }
    );
  }

  async publishStockReleaseRequested(
    orderId: string,
    reason: string,
    correlationId: string,
    causationId: string
  ): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.STOCK_RELEASE_REQUESTED,
      { orderId, reason: reason.slice(0, 256) },
      { correlationId, causationId }
    );
  }
}
