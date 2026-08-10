import { createLogger } from '@loja-veloz/observability';
import type {
  InventoryItemRecord,
  InventoryRepository,
  ReleaseResult,
  RequestedItem,
  ReserveResult,
} from '../repositories/inventory.repository';
import type { InventoryEventPublisher } from '../messaging/publishers';

interface Reservation {
  orderId: string;
  sku: string;
  quantity: number;
  status: 'RESERVED' | 'RELEASED';
}

/**
 * Repositorio em memoria com a mesma semantica tudo-ou-nada da implementacao
 * Prisma: a reserva so e aplicada se todos os itens couberem no saldo.
 */
export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly items = new Map<string, InventoryItemRecord>();
  private readonly reservations: Reservation[] = [];
  private readonly processedEvents = new Set<string>();

  constructor(seed: Array<{ sku: string; availableQuantity: number }> = []) {
    for (const item of seed) {
      this.items.set(item.sku, {
        sku: item.sku,
        description: '',
        availableQuantity: item.availableQuantity,
        reservedQuantity: 0,
        updatedAt: new Date(),
      });
    }
  }

  async findBySku(sku: string): Promise<InventoryItemRecord | null> {
    const found = this.items.get(sku);
    return found ? { ...found } : null;
  }

  async reserve(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    items: RequestedItem[];
  }): Promise<ReserveResult> {
    if (this.processedEvents.has(params.eventId)) {
      return { outcome: 'duplicate' };
    }
    this.processedEvents.add(params.eventId);

    const unavailableSkus = params.items
      .filter((item) => {
        const stock = this.items.get(item.sku);
        return !stock || stock.availableQuantity < item.quantity;
      })
      .map((item) => item.sku);

    if (unavailableSkus.length > 0) {
      return { outcome: 'insufficient', unavailableSkus };
    }

    for (const item of params.items) {
      const stock = this.items.get(item.sku);
      if (!stock) {
        continue;
      }
      stock.availableQuantity -= item.quantity;
      stock.reservedQuantity += item.quantity;
      stock.updatedAt = new Date();
      this.reservations.push({
        orderId: params.orderId,
        sku: item.sku,
        quantity: item.quantity,
        status: 'RESERVED',
      });
    }

    return { outcome: 'reserved', items: params.items };
  }

  async release(params: {
    eventId: string;
    eventType: string;
    orderId: string;
  }): Promise<ReleaseResult> {
    if (this.processedEvents.has(params.eventId)) {
      return { outcome: 'duplicate' };
    }
    this.processedEvents.add(params.eventId);

    const active = this.reservations.filter(
      (reservation) => reservation.orderId === params.orderId && reservation.status === 'RESERVED'
    );

    if (active.length === 0) {
      return { outcome: 'nothing_to_release' };
    }

    for (const reservation of active) {
      const stock = this.items.get(reservation.sku);
      if (stock) {
        stock.availableQuantity += reservation.quantity;
        stock.reservedQuantity = Math.max(stock.reservedQuantity - reservation.quantity, 0);
        stock.updatedAt = new Date();
      }
      reservation.status = 'RELEASED';
    }

    return {
      outcome: 'released',
      items: active.map((reservation) => ({
        sku: reservation.sku,
        quantity: reservation.quantity,
      })),
    };
  }

  async restock(sku: string, quantity: number, description?: string): Promise<InventoryItemRecord> {
    const existing = this.items.get(sku);
    if (existing) {
      existing.availableQuantity += quantity;
      if (description) {
        existing.description = description;
      }
      existing.updatedAt = new Date();
      return { ...existing };
    }

    const created: InventoryItemRecord = {
      sku,
      description: description ?? '',
      availableQuantity: quantity,
      reservedQuantity: 0,
      updatedAt: new Date(),
    };
    this.items.set(sku, created);
    return { ...created };
  }
}

export interface RecordedPublication {
  type: 'stock.reserved' | 'stock.failed' | 'stock.released';
  orderId: string;
  reason?: string;
  unavailableSkus?: string[];
}

export class RecordingPublisher {
  readonly published: RecordedPublication[] = [];

  async publishStockReserved(params: { orderId: string }): Promise<void> {
    this.published.push({ type: 'stock.reserved', orderId: params.orderId });
  }

  async publishStockFailed(params: {
    orderId: string;
    reason: string;
    unavailableSkus: string[];
  }): Promise<void> {
    this.published.push({
      type: 'stock.failed',
      orderId: params.orderId,
      reason: params.reason,
      unavailableSkus: params.unavailableSkus,
    });
  }

  async publishStockReleased(params: { orderId: string }): Promise<void> {
    this.published.push({ type: 'stock.released', orderId: params.orderId });
  }

  typesPublished(): string[] {
    return this.published.map((entry) => entry.type);
  }

  asPublisher(): InventoryEventPublisher {
    return this as unknown as InventoryEventPublisher;
  }
}

export const silentLogger = createLogger({
  serviceName: 'inventory-service-test',
  serviceVersion: 'test',
  environment: 'test',
  level: 'silent',
});
