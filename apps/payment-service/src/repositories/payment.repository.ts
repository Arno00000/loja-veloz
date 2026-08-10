import { PG_UNIQUE_VIOLATION } from '@loja-veloz/messaging';
import type { PrismaClient } from '../db/prisma';

export type PaymentStatusValue = 'APPROVED' | 'FAILED';

export interface PaymentRecord {
  id: string;
  orderId: string;
  status: PaymentStatusValue;
  amount: number;
  externalReference: string;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordPaymentData {
  eventId: string;
  eventType: string;
  orderId: string;
  status: PaymentStatusValue;
  amount: number;
  externalReference: string;
  failureReason?: string;
}

export type RecordPaymentResult =
  { outcome: 'recorded'; payment: PaymentRecord } | { outcome: 'duplicate' };

export interface PaymentRepository {
  findByOrderId(orderId: string): Promise<PaymentRecord | null>;
  record(data: RecordPaymentData): Promise<RecordPaymentResult>;
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

interface PaymentRow {
  id: string;
  orderId: string;
  status: string;
  amount: unknown;
  externalReference: string;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status as PaymentStatusValue,
    amount: typeof row.amount === 'number' ? row.amount : Number(row.amount),
    externalReference: row.externalReference,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByOrderId(orderId: string): Promise<PaymentRecord | null> {
    const found = await this.prisma.payment.findUnique({ where: { orderId } });
    return found ? toRecord(found as unknown as PaymentRow) : null;
  }

  /**
   * Registra o pagamento e o eventId na mesma transacao.
   *
   * Ha duas restricoes unicas protegendo a operacao: `processed_events.event_id`
   * (mesma mensagem entregue duas vezes) e `payments.order_id` (dois eventos
   * distintos tentando pagar o mesmo pedido). Qualquer uma das duas colisoes
   * e tratada como duplicata, o que garante um unico pagamento por pedido.
   */
  async record(data: RecordPaymentData): Promise<RecordPaymentResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({
          data: { eventId: data.eventId, eventType: data.eventType },
        });

        const payment = await tx.payment.create({
          data: {
            orderId: data.orderId,
            status: data.status,
            amount: data.amount,
            externalReference: data.externalReference,
            failureReason: data.failureReason ?? null,
          },
        });

        return {
          outcome: 'recorded',
          payment: toRecord(payment as unknown as PaymentRow),
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
