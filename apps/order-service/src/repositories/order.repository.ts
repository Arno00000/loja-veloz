import {
  canTransition,
  ORDER_STATUS,
  type OrderStatus,
} from '@loja-veloz/shared-types';
import { PG_UNIQUE_VIOLATION } from '@loja-veloz/messaging';
import type { PrismaClient } from '../db/prisma';

export interface OrderItemRecord {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderRecord {
  id: string;
  customerId: string;
  status: OrderStatus;
  total: number;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemRecord[];
}

export interface CreateOrderData {
  customerId: string;
  total: number;
  items: OrderItemRecord[];
}

export interface ListOrdersFilter {
  skip: number;
  take: number;
  status?: OrderStatus;
  customerId?: string;
}

export type ApplyEventResult =
  | { outcome: 'applied'; order: OrderRecord; previousStatus: OrderStatus }
  | { outcome: 'duplicate' }
  | { outcome: 'order_not_found' }
  | { outcome: 'invalid_transition'; currentStatus: OrderStatus };

/**
 * Porta de persistencia do dominio de pedidos.
 *
 * A camada de servico depende desta interface e nao do Prisma, o que permite
 * exercitar toda a maquina de estados e o fluxo de eventos em teste unitario
 * com uma implementacao em memoria, sem banco em execucao.
 */
export interface OrderRepository {
  create(data: CreateOrderData): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  list(filter: ListOrdersFilter): Promise<{ items: OrderRecord[]; total: number }>;
  applyEvent(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    targetStatus: OrderStatus;
  }): Promise<ApplyEventResult>;
}

/** Converte o Decimal do Prisma em number para uso na camada de aplicacao. */
function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

interface PrismaOrderRow {
  id: string;
  customerId: string;
  status: string;
  total: unknown;
  createdAt: Date;
  updatedAt: Date;
  items?: Array<{ sku: string; quantity: number; unitPrice: unknown }>;
}

function toRecord(row: PrismaOrderRow): OrderRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    status: row.status as OrderStatus,
    total: toNumber(row.total),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: (row.items ?? []).map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
    })),
  };
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateOrderData): Promise<OrderRecord> {
    const created = await this.prisma.order.create({
      data: {
        customerId: data.customerId,
        status: ORDER_STATUS.PENDING,
        total: data.total,
        items: {
          create: data.items.map((item) => ({
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        },
      },
      include: { items: true },
    });

    return toRecord(created as unknown as PrismaOrderRow);
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const found = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    return found ? toRecord(found as unknown as PrismaOrderRow) : null;
  }

  async list(filter: ListOrdersFilter): Promise<{ items: OrderRecord[]; total: number }> {
    const where = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: rows.map((row) => toRecord(row as unknown as PrismaOrderRow)),
      total,
    };
  }

  /**
   * Aplica a mudanca de estado provocada por um evento.
   *
   * Tudo acontece em uma unica transacao:
   *   1. registra o eventId em processed_events (chave primaria unica);
   *   2. le o pedido;
   *   3. valida a transicao;
   *   4. atualiza o status.
   *
   * Como o registro de idempotencia e a atualizacao do pedido compartilham a
   * transacao, nao existe estado intermediario possivel: ou o evento foi
   * registrado e aplicado, ou nada mudou. Uma segunda entrega do mesmo evento
   * colide na chave unica e e reconhecida como duplicata.
   */
  async applyEvent(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    targetStatus: OrderStatus;
  }): Promise<ApplyEventResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({
          data: { eventId: params.eventId, eventType: params.eventType },
        });

        const current = await tx.order.findUnique({
          where: { id: params.orderId },
          include: { items: true },
        });

        if (!current) {
          return { outcome: 'order_not_found' } as const;
        }

        const previousStatus = current.status as OrderStatus;

        if (!canTransition(previousStatus, params.targetStatus)) {
          return { outcome: 'invalid_transition', currentStatus: previousStatus } as const;
        }

        const updated = await tx.order.update({
          where: { id: params.orderId },
          data: { status: params.targetStatus },
          include: { items: true },
        });

        return {
          outcome: 'applied',
          order: toRecord(updated as unknown as PrismaOrderRow),
          previousStatus,
        } as const;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { outcome: 'duplicate' };
      }
      throw error;
    }
  }
}

/** Detecta a violacao de chave unica do Prisma sem importar o tipo gerado. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
