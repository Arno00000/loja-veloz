import { z } from 'zod';
import { buildEventSchema } from './envelope';

export const PAYMENT_EVENT_TYPES = {
  PAYMENT_APPROVED: 'payment.approved',
  PAYMENT_FAILED: 'payment.failed',
} as const;

/**
 * payment.approved
 * `externalReference` representa o identificador que um provedor externo
 * devolveria. No MVP e gerado pelo simulador local.
 */
export const paymentApprovedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().nonnegative(),
  externalReference: z.string().min(1).max(128),
});

export const paymentApprovedEventSchema = buildEventSchema(
  PAYMENT_EVENT_TYPES.PAYMENT_APPROVED,
  paymentApprovedPayloadSchema
);

export type PaymentApprovedPayload = z.infer<typeof paymentApprovedPayloadSchema>;
export type PaymentApprovedEvent = z.infer<typeof paymentApprovedEventSchema>;

/**
 * payment.failed
 * Recusa do pagamento. Dispara, no Serviço de Pedidos, a transicao para
 * PAYMENT_FAILED e a publicacao de stock.release.requested.
 */
export const paymentFailedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amount: z.number().nonnegative(),
  reason: z.string().min(1).max(256),
});

export const paymentFailedEventSchema = buildEventSchema(
  PAYMENT_EVENT_TYPES.PAYMENT_FAILED,
  paymentFailedPayloadSchema
);

export type PaymentFailedPayload = z.infer<typeof paymentFailedPayloadSchema>;
export type PaymentFailedEvent = z.infer<typeof paymentFailedEventSchema>;
