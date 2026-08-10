import { createLogger } from '@loja-veloz/observability';
import { randomUUID } from 'node:crypto';
import type {
  PaymentRecord,
  PaymentRepository,
  RecordPaymentData,
  RecordPaymentResult,
} from '../repositories/payment.repository';
import type { PaymentEventPublisher } from '../messaging/publishers';

/**
 * Repositorio em memoria com as mesmas duas restricoes unicas da
 * implementacao Prisma: eventId ja processado e pedido ja pago.
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly payments = new Map<string, PaymentRecord>();
  private readonly processedEvents = new Set<string>();

  async findByOrderId(orderId: string): Promise<PaymentRecord | null> {
    const found = this.payments.get(orderId);
    return found ? { ...found } : null;
  }

  async record(data: RecordPaymentData): Promise<RecordPaymentResult> {
    if (this.processedEvents.has(data.eventId) || this.payments.has(data.orderId)) {
      return { outcome: 'duplicate' };
    }
    this.processedEvents.add(data.eventId);

    const now = new Date();
    const payment: PaymentRecord = {
      id: randomUUID(),
      orderId: data.orderId,
      status: data.status,
      amount: data.amount,
      externalReference: data.externalReference,
      failureReason: data.failureReason ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.payments.set(data.orderId, payment);

    return { outcome: 'recorded', payment: { ...payment } };
  }
}

export interface RecordedPublication {
  type: 'payment.approved' | 'payment.failed';
  orderId: string;
  amount: number;
  reason?: string;
}

export class RecordingPublisher {
  readonly published: RecordedPublication[] = [];

  async publishPaymentApproved(params: { orderId: string; amount: number }): Promise<void> {
    this.published.push({
      type: 'payment.approved',
      orderId: params.orderId,
      amount: params.amount,
    });
  }

  async publishPaymentFailed(params: {
    orderId: string;
    amount: number;
    reason: string;
  }): Promise<void> {
    this.published.push({
      type: 'payment.failed',
      orderId: params.orderId,
      amount: params.amount,
      reason: params.reason,
    });
  }

  typesPublished(): string[] {
    return this.published.map((entry) => entry.type);
  }

  asPublisher(): PaymentEventPublisher {
    return this as unknown as PaymentEventPublisher;
  }
}

export const silentLogger = createLogger({
  serviceName: 'payment-service-test',
  serviceVersion: 'test',
  environment: 'test',
  level: 'silent',
});
