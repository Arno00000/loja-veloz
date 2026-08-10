import { z } from 'zod';
import { buildEventSchema } from './envelope';
import { orderStatusSchema } from '../domain/order-status';

export const ORDER_EVENT_TYPES = {
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_FAILED: 'order.failed',
} as const;

export const orderItemSchema = z.object({
  sku: z.string().min(1).max(64),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

export type OrderItemPayload = z.infer<typeof orderItemSchema>;

/**
 * order.created
 * Publicado pelo Serviço de Pedidos apos persistir o pedido em PENDING.
 * Carrega tudo que o Estoque e, mais adiante, o Pagamento precisam,
 * de modo que nenhum servico consulte o banco de outro.
 */
export const orderCreatedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().min(1).max(64),
  total: z.number().nonnegative(),
  items: z.array(orderItemSchema).min(1),
});

export const orderCreatedEventSchema = buildEventSchema(
  ORDER_EVENT_TYPES.ORDER_CREATED,
  orderCreatedPayloadSchema
);

export type OrderCreatedPayload = z.infer<typeof orderCreatedPayloadSchema>;
export type OrderCreatedEvent = z.infer<typeof orderCreatedEventSchema>;

/**
 * order.confirmed
 * Publicado quando o pedido chega ao estado terminal CONFIRMED.
 * Consumido apenas para auditoria e metricas.
 */
export const orderConfirmedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().min(1).max(64),
  total: z.number().nonnegative(),
});

export const orderConfirmedEventSchema = buildEventSchema(
  ORDER_EVENT_TYPES.ORDER_CONFIRMED,
  orderConfirmedPayloadSchema
);

export type OrderConfirmedPayload = z.infer<typeof orderConfirmedPayloadSchema>;
export type OrderConfirmedEvent = z.infer<typeof orderConfirmedEventSchema>;

/**
 * order.failed
 * Publicado quando o pedido chega a STOCK_FAILED ou PAYMENT_FAILED.
 */
export const orderFailedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().min(1).max(64),
  status: orderStatusSchema,
  reason: z.string().min(1).max(256),
});

export const orderFailedEventSchema = buildEventSchema(
  ORDER_EVENT_TYPES.ORDER_FAILED,
  orderFailedPayloadSchema
);

export type OrderFailedPayload = z.infer<typeof orderFailedPayloadSchema>;
export type OrderFailedEvent = z.infer<typeof orderFailedEventSchema>;
