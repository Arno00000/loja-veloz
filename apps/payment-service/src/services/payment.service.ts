import { NotFoundError, type Logger } from '@loja-veloz/observability';
import type { PaymentRecord, PaymentRepository } from '../repositories/payment.repository';
import type { PaymentGatewaySimulator } from './payment-gateway.simulator';
import type { PaymentEventPublisher } from '../messaging/publishers';
import {
  paymentAuthorizationDurationSeconds,
  paymentsDuplicateTotal,
  paymentsProcessedTotal,
} from '../metrics';

export interface PaymentServiceOptions {
  repository: PaymentRepository;
  simulator: PaymentGatewaySimulator;
  publisher: PaymentEventPublisher;
  logger: Logger;
}

export interface PaymentOutcome {
  status: 'approved' | 'failed' | 'duplicate';
}

export class PaymentService {
  constructor(private readonly options: PaymentServiceOptions) {}

  async getByOrderId(orderId: string): Promise<PaymentRecord> {
    const payment = await this.options.repository.findByOrderId(orderId);
    if (!payment) {
      throw new NotFoundError('Pagamento do pedido', orderId);
    }
    return payment;
  }

  /**
   * Reage a stock.reserved.
   *
   * Ordem das operacoes: autoriza, persiste, publica. Persistir antes de
   * publicar garante que a consulta GET /payments/:orderId ja encontre o
   * registro quando o pedido mudar de estado.
   *
   * Sempre publica exatamente um resultado, aprovado ou recusado. Silencio
   * aqui deixaria o pedido preso em STOCK_RESERVED.
   */
  async handleStockReserved(params: {
    eventId: string;
    eventType: string;
    orderId: string;
    customerId: string;
    amount: number;
    correlationId: string;
  }): Promise<PaymentOutcome> {
    const endTimer = paymentAuthorizationDurationSeconds.startTimer();
    const authorization = await this.options.simulator.authorize({
      orderId: params.orderId,
      customerId: params.customerId,
      amount: params.amount,
    });
    endTimer();

    const result = await this.options.repository.record({
      eventId: params.eventId,
      eventType: params.eventType,
      orderId: params.orderId,
      status: authorization.approved ? 'APPROVED' : 'FAILED',
      amount: params.amount,
      externalReference: authorization.approved ? authorization.externalReference : 'N/A',
      ...(authorization.approved ? {} : { failureReason: authorization.reason }),
    });

    if (result.outcome === 'duplicate') {
      paymentsDuplicateTotal.inc();
      this.options.logger.info(
        {
          orderId: params.orderId,
          eventId: params.eventId,
          correlationId: params.correlationId,
        },
        'Evento de pagamento ja processado, ignorado'
      );
      return { status: 'duplicate' };
    }

    const payment = result.payment;

    if (!authorization.approved) {
      paymentsProcessedTotal.inc({ status: 'failed' });
      this.options.logger.warn(
        {
          orderId: params.orderId,
          paymentId: payment.id,
          amount: params.amount,
          correlationId: params.correlationId,
        },
        'Pagamento recusado'
      );

      await this.options.publisher.publishPaymentFailed({
        orderId: params.orderId,
        paymentId: payment.id,
        amount: params.amount,
        reason: authorization.reason,
        correlationId: params.correlationId,
        causationId: params.eventId,
      });

      return { status: 'failed' };
    }

    paymentsProcessedTotal.inc({ status: 'approved' });
    this.options.logger.info(
      {
        orderId: params.orderId,
        paymentId: payment.id,
        amount: params.amount,
        correlationId: params.correlationId,
      },
      'Pagamento aprovado'
    );

    await this.options.publisher.publishPaymentApproved({
      orderId: params.orderId,
      paymentId: payment.id,
      amount: params.amount,
      externalReference: authorization.externalReference,
      correlationId: params.correlationId,
      causationId: params.eventId,
    });

    return { status: 'approved' };
  }
}
