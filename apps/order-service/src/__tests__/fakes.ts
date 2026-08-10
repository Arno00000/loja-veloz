import { createLogger } from '@loja-veloz/observability';
import { randomUUID } from 'node:crypto';
import { canTransition, ORDER_STATUS, type OrderStatus } from '@loja-veloz/shared-types';
import type {
  ApplyEventResult,
  CreateOrderData,
  ListOrdersFilter,
  OrderRecord,
  OrderRepository,
} from '../repositories/order.repository';
import type { OrderEventPublisher } from '../messaging/publishers';

/**
 * Repositorio em memoria com a mesma semantica transacional do Prisma:
 * registro de idempotencia e mudanca de estado sao aplicados juntos, e uma
 * segunda ocorrencia do mesmo eventId e reconhecida como duplicata.
 *
 * Permite testar toda a maquina de estados sem PostgreSQL em execucao.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly processedEvents = new Set<string>();

  async create(data: CreateOrderData): Promise<OrderRecord> {
    const now = new Date();
    const order: OrderRecord = {
      id: randomUUID(),
      customerId: data.customerId,
      status: ORDER_STATUS.PENDING,
      total: data.total,
      createdAt: now,
      updatedAt: now,
      items: data.items.map((item) => ({ ...item })),
    };
    this.orders.set(order.id, order);
    return { ...order, items: [...order.items] };
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const found = this.orders.get(id);
    return found ? { ...found, items: [...found.items] } : null;
  }

  async list(filter: ListOrdersFilter): Promise<{ items: OrderRecord[]; total: number }> {
    const all = [...this.orders.values()]
      .filter((order) => (filter.status ? order.status === filter.status : true))
      .filter((order) => (filter.customerId ? order.customerId === filter.customerId : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      items: all.slice(filter.skip, filter.skip + filter.take).map((order) => ({ ...order })),
      total: all.length,
    };
  }

  async applyEvent(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    targetStatus: OrderStatus;
  }): Promise<ApplyEventResult> {
    if (this.processedEvents.has(params.eventId)) {
      return { outcome: 'duplicate' };
    }
    this.processedEvents.add(params.eventId);

    const order = this.orders.get(params.orderId);
    if (!order) {
      return { outcome: 'order_not_found' };
    }

    const previousStatus = order.status;
    if (!canTransition(previousStatus, params.targetStatus)) {
      return { outcome: 'invalid_transition', currentStatus: previousStatus };
    }

    order.status = params.targetStatus;
    order.updatedAt = new Date();

    return { outcome: 'applied', order: { ...order }, previousStatus };
  }

  seed(order: OrderRecord): void {
    this.orders.set(order.id, order);
  }

  get processedEventCount(): number {
    return this.processedEvents.size;
  }
}

export interface RecordedPublication {
  type:
    | 'order.created'
    | 'order.confirmed'
    | 'order.failed'
    | 'stock.release.requested';
  orderId: string;
  correlationId: string;
  reason?: string;
}

export class RecordingPublisher {
  readonly published: RecordedPublication[] = [];

  async publishOrderCreated(order: OrderRecord, correlationId: string): Promise<void> {
    this.published.push({ type: 'order.created', orderId: order.id, correlationId });
  }

  async publishOrderConfirmed(order: OrderRecord, correlationId: string): Promise<void> {
    this.published.push({ type: 'order.confirmed', orderId: order.id, correlationId });
  }

  async publishOrderFailed(
    order: OrderRecord,
    reason: string,
    correlationId: string
  ): Promise<void> {
    this.published.push({ type: 'order.failed', orderId: order.id, correlationId, reason });
  }

  async publishStockReleaseRequested(
    orderId: string,
    reason: string,
    correlationId: string
  ): Promise<void> {
    this.published.push({ type: 'stock.release.requested', orderId, correlationId, reason });
  }

  typesPublished(): string[] {
    return this.published.map((entry) => entry.type);
  }

  asPublisher(): OrderEventPublisher {
    return this as unknown as OrderEventPublisher;
  }
}

export const silentLogger = createLogger({
  serviceName: 'order-service-test',
  serviceVersion: 'test',
  environment: 'test',
  level: 'silent',
});
