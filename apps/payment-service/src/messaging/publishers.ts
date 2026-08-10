import { EVENT_TYPES } from '@loja-veloz/shared-types';
import type { EventPublisher } from '@loja-veloz/messaging';

export class PaymentEventPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  async publishPaymentApproved(params: {
    orderId: string;
    paymentId: string;
    amount: number;
    externalReference: string;
    correlationId: string;
    causationId: string;
  }): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.PAYMENT_APPROVED,
      {
        orderId: params.orderId,
        paymentId: params.paymentId,
        amount: params.amount,
        externalReference: params.externalReference,
      },
      { correlationId: params.correlationId, causationId: params.causationId }
    );
  }

  async publishPaymentFailed(params: {
    orderId: string;
    paymentId: string;
    amount: number;
    reason: string;
    correlationId: string;
    causationId: string;
  }): Promise<void> {
    await this.publisher.publish(
      EVENT_TYPES.PAYMENT_FAILED,
      {
        orderId: params.orderId,
        paymentId: params.paymentId,
        amount: params.amount,
        reason: params.reason.slice(0, 256),
      },
      { correlationId: params.correlationId, causationId: params.causationId }
    );
  }
}
