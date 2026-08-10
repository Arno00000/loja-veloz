import { z } from 'zod';
import { buildEventSchema } from './envelope';

export const STOCK_EVENT_TYPES = {
  STOCK_RESERVED: 'stock.reserved',
  STOCK_FAILED: 'stock.failed',
  STOCK_RELEASE_REQUESTED: 'stock.release.requested',
  STOCK_RELEASED: 'stock.released',
} as const;

export const reservedItemSchema = z.object({
  sku: z.string().min(1).max(64),
  quantity: z.number().int().positive(),
});

export type ReservedItemPayload = z.infer<typeof reservedItemSchema>;

/**
 * stock.reserved
 * Publicado pelo Serviço de Estoque apos reservar todos os itens em uma
 * unica transacao. `customerId` e `total` sao repassados adiante para que o
 * Serviço de Pagamentos nao precise consultar o banco de pedidos.
 */
export const stockReservedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().min(1).max(64),
  total: z.number().nonnegative(),
  items: z.array(reservedItemSchema).min(1),
});

export const stockReservedEventSchema = buildEventSchema(
  STOCK_EVENT_TYPES.STOCK_RESERVED,
  stockReservedPayloadSchema
);

export type StockReservedPayload = z.infer<typeof stockReservedPayloadSchema>;
export type StockReservedEvent = z.infer<typeof stockReservedEventSchema>;

/**
 * stock.failed
 * Publicado quando ao menos um item nao pode ser reservado. A reserva e
 * tudo-ou-nada: nenhuma quantidade permanece reservada apos a falha.
 */
export const stockFailedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string().min(1).max(64),
  reason: z.string().min(1).max(256),
  unavailableSkus: z.array(z.string().min(1).max(64)),
});

export const stockFailedEventSchema = buildEventSchema(
  STOCK_EVENT_TYPES.STOCK_FAILED,
  stockFailedPayloadSchema
);

export type StockFailedPayload = z.infer<typeof stockFailedPayloadSchema>;
export type StockFailedEvent = z.infer<typeof stockFailedEventSchema>;

/**
 * stock.release.requested
 * Publicado pelo Serviço de Pedidos apos uma falha de pagamento, para que o
 * Estoque devolva as quantidades reservadas ao saldo disponivel.
 */
export const stockReleaseRequestedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1).max(256),
});

export const stockReleaseRequestedEventSchema = buildEventSchema(
  STOCK_EVENT_TYPES.STOCK_RELEASE_REQUESTED,
  stockReleaseRequestedPayloadSchema
);

export type StockReleaseRequestedPayload = z.infer<typeof stockReleaseRequestedPayloadSchema>;
export type StockReleaseRequestedEvent = z.infer<typeof stockReleaseRequestedEventSchema>;

/**
 * stock.released
 * Confirmacao da liberacao. Usado apenas para auditoria e observabilidade:
 * nao altera o estado terminal PAYMENT_FAILED do pedido.
 */
export const stockReleasedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  releasedItems: z.array(reservedItemSchema),
});

export const stockReleasedEventSchema = buildEventSchema(
  STOCK_EVENT_TYPES.STOCK_RELEASED,
  stockReleasedPayloadSchema
);

export type StockReleasedPayload = z.infer<typeof stockReleasedPayloadSchema>;
export type StockReleasedEvent = z.infer<typeof stockReleasedEventSchema>;
