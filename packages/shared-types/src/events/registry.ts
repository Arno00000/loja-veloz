import type { z } from 'zod';
import {
  ORDER_EVENT_TYPES,
  orderCreatedEventSchema,
  orderConfirmedEventSchema,
  orderFailedEventSchema,
} from './order-events';
import {
  STOCK_EVENT_TYPES,
  stockReservedEventSchema,
  stockFailedEventSchema,
  stockReleaseRequestedEventSchema,
  stockReleasedEventSchema,
} from './stock-events';
import {
  PAYMENT_EVENT_TYPES,
  paymentApprovedEventSchema,
  paymentFailedEventSchema,
} from './payment-events';

/**
 * Catalogo unico de eventos do dominio.
 *
 * Os valores desta constante sao, ao mesmo tempo:
 * - o `eventType` gravado no envelope;
 * - a routing key usada na publicacao no exchange `loja-veloz.events`;
 * - a chave de binding das filas.
 *
 * Manter os tres significados no mesmo literal elimina uma classe inteira de
 * erros de configuracao entre produtores e consumidores.
 */
export const EVENT_TYPES = {
  ...ORDER_EVENT_TYPES,
  ...STOCK_EVENT_TYPES,
  ...PAYMENT_EVENT_TYPES,
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export const EVENT_SCHEMAS = {
  [EVENT_TYPES.ORDER_CREATED]: orderCreatedEventSchema,
  [EVENT_TYPES.ORDER_CONFIRMED]: orderConfirmedEventSchema,
  [EVENT_TYPES.ORDER_FAILED]: orderFailedEventSchema,
  [EVENT_TYPES.STOCK_RESERVED]: stockReservedEventSchema,
  [EVENT_TYPES.STOCK_FAILED]: stockFailedEventSchema,
  [EVENT_TYPES.STOCK_RELEASE_REQUESTED]: stockReleaseRequestedEventSchema,
  [EVENT_TYPES.STOCK_RELEASED]: stockReleasedEventSchema,
  [EVENT_TYPES.PAYMENT_APPROVED]: paymentApprovedEventSchema,
  [EVENT_TYPES.PAYMENT_FAILED]: paymentFailedEventSchema,
} as const;

export type EventSchemaMap = typeof EVENT_SCHEMAS;

export const ALL_EVENT_TYPES: readonly EventType[] = Object.values(EVENT_TYPES);

export function isKnownEventType(value: string): value is EventType {
  return ALL_EVENT_TYPES.includes(value as EventType);
}

/**
 * Valida um payload bruto contra o schema do `eventType` informado.
 * Lanca `ZodError` quando o formato nao corresponde ao contrato.
 */
export function parseEvent<TType extends EventType>(
  eventType: TType,
  raw: unknown
): z.infer<EventSchemaMap[TType]> {
  const schema = EVENT_SCHEMAS[eventType];
  return schema.parse(raw) as z.infer<EventSchemaMap[TType]>;
}

/**
 * Variante segura, sem excecao. Usada nos consumidores para decidir entre
 * reprocessar e enviar diretamente para a DLQ: um payload que viola o
 * contrato nunca vai ficar valido em uma nova tentativa.
 */
export function safeParseEvent<TType extends EventType>(
  eventType: TType,
  raw: unknown
): { success: true; data: z.infer<EventSchemaMap[TType]> } | { success: false; error: z.ZodError } {
  const schema = EVENT_SCHEMAS[eventType];
  const result = schema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data as z.infer<EventSchemaMap[TType]> };
  }
  return { success: false, error: result.error };
}
