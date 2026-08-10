import { PG_UNIQUE_VIOLATION } from '@loja-veloz/messaging';
import type { PrismaClient } from '../db/prisma';

export interface InventoryItemRecord {
  sku: string;
  description: string;
  availableQuantity: number;
  reservedQuantity: number;
  updatedAt: Date;
}

export interface RequestedItem {
  sku: string;
  quantity: number;
}

export interface ReleasedItem {
  sku: string;
  quantity: number;
}

export type ReserveResult =
  | { outcome: 'reserved'; items: RequestedItem[] }
  | { outcome: 'insufficient'; unavailableSkus: string[] }
  | { outcome: 'duplicate' };

export type ReleaseResult =
  | { outcome: 'released'; items: ReleasedItem[] }
  | { outcome: 'nothing_to_release' }
  | { outcome: 'duplicate' };

/**
 * Porta de persistencia do estoque. A implementacao em memoria usada nos
 * testes reproduz a mesma semantica transacional.
 */
export interface InventoryRepository {
  findBySku(sku: string): Promise<InventoryItemRecord | null>;
  reserve(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    items: RequestedItem[];
  }): Promise<ReserveResult>;
  release(params: {
    eventId: string;
    eventType: string;
    orderId: string;
  }): Promise<ReleaseResult>;
  restock(sku: string, quantity: number, description?: string): Promise<InventoryItemRecord>;
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySku(sku: string): Promise<InventoryItemRecord | null> {
    const found = await this.prisma.inventoryItem.findUnique({ where: { sku } });
    return found
      ? {
          sku: found.sku,
          description: found.description,
          availableQuantity: found.availableQuantity,
          reservedQuantity: found.reservedQuantity,
          updatedAt: found.updatedAt,
        }
      : null;
  }

  /**
   * Reserva tudo-ou-nada.
   *
   * A transacao inteira e revertida se qualquer item faltar, entao nunca
   * sobra reserva parcial. O UPDATE condicional
   * (`availableQuantity >= quantity`) e o ponto critico: ele resolve a corrida
   * entre duas reservas simultaneas do mesmo SKU sem precisar de SELECT FOR
   * UPDATE. Se o UPDATE afetar zero linhas, outro pedido levou a quantidade
   * primeiro e a reserva falha.
   *
   * O registro do eventId acontece na mesma transacao, o que torna a operacao
   * idempotente diante de reentrega.
   */
  async reserve(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    items: RequestedItem[];
  }): Promise<ReserveResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({
          data: { eventId: params.eventId, eventType: params.eventType },
        });

        const unavailableSkus: string[] = [];

        for (const item of params.items) {
          const affected = await tx.$executeRaw`
            UPDATE inventory_items
               SET available_quantity = available_quantity - ${item.quantity},
                   reserved_quantity  = reserved_quantity  + ${item.quantity},
                   updated_at         = NOW()
             WHERE sku = ${item.sku}
               AND available_quantity >= ${item.quantity}
          `;

          if (affected === 0) {
            unavailableSkus.push(item.sku);
          }
        }

        if (unavailableSkus.length > 0) {
          // Desfaz tudo: a reserva e atomica por definicao de negocio.
          throw new InsufficientStockError(unavailableSkus);
        }

        await tx.inventoryReservation.createMany({
          data: params.items.map((item) => ({
            orderId: params.orderId,
            sku: item.sku,
            quantity: item.quantity,
          })),
        });

        return { outcome: 'reserved', items: params.items } as const;
      });
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        return { outcome: 'insufficient', unavailableSkus: error.unavailableSkus };
      }
      if (isUniqueViolation(error)) {
        return { outcome: 'duplicate' };
      }
      throw error;
    }
  }

  /**
   * Devolve ao saldo disponivel tudo que estava reservado para o pedido.
   * Reservas ja liberadas sao ignoradas, o que torna a operacao segura contra
   * reentrega mesmo antes da checagem de idempotencia.
   */
  async release(params: {
    eventId: string;
    eventType: string;
    orderId: string;
  }): Promise<ReleaseResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({
          data: { eventId: params.eventId, eventType: params.eventType },
        });

        const reservations = await tx.inventoryReservation.findMany({
          where: { orderId: params.orderId, status: 'RESERVED' },
        });

        if (reservations.length === 0) {
          return { outcome: 'nothing_to_release' } as const;
        }

        for (const reservation of reservations) {
          await tx.$executeRaw`
            UPDATE inventory_items
               SET available_quantity = available_quantity + ${reservation.quantity},
                   reserved_quantity  = GREATEST(reserved_quantity - ${reservation.quantity}, 0),
                   updated_at         = NOW()
             WHERE sku = ${reservation.sku}
          `;
        }

        await tx.inventoryReservation.updateMany({
          where: { orderId: params.orderId, status: 'RESERVED' },
          data: { status: 'RELEASED' },
        });

        return {
          outcome: 'released',
          items: reservations.map((reservation) => ({
            sku: reservation.sku,
            quantity: reservation.quantity,
          })),
        } as const;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { outcome: 'duplicate' };
      }
      throw error;
    }
  }

  async restock(
    sku: string,
    quantity: number,
    description?: string
  ): Promise<InventoryItemRecord> {
    const item = await this.prisma.inventoryItem.upsert({
      where: { sku },
      create: {
        sku,
        description: description ?? '',
        availableQuantity: quantity,
        reservedQuantity: 0,
      },
      update: {
        availableQuantity: { increment: quantity },
        ...(description ? { description } : {}),
      },
    });

    return {
      sku: item.sku,
      description: item.description,
      availableQuantity: item.availableQuantity,
      reservedQuantity: item.reservedQuantity,
      updatedAt: item.updatedAt,
    };
  }
}

/** Erro interno usado para abortar a transacao de reserva. */
export class InsufficientStockError extends Error {
  constructor(public readonly unavailableSkus: string[]) {
    super(`Estoque insuficiente para: ${unavailableSkus.join(', ')}`);
    this.name = 'InsufficientStockError';
  }
}
