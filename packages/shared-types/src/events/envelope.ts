import { z } from 'zod';

/**
 * Envelope unico de todos os eventos de dominio trocados via RabbitMQ.
 *
 * Regras contratuais:
 * - `eventId` e a chave de idempotencia. Consumidores registram esse valor
 *   em uma tabela `ProcessedEvent` antes de considerar o evento tratado.
 * - `eventType` coincide exatamente com a routing key publicada no exchange.
 * - `eventVersion` comeca em 1. Alteracoes incompativeis exigem nova versao,
 *   nunca alteracao silenciosa do payload.
 * - `correlationId` acompanha a jornada de negocio inteira (do Gateway ate o
 *   estado final do pedido) e e distinto do trace context do OpenTelemetry,
 *   que e propagado separadamente nos headers `traceparent`/`tracestate`.
 * - `causationId` aponta para o `eventId` do evento que originou este,
 *   permitindo reconstruir a cadeia causal.
 */
export const domainEventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  correlationId: z.string().min(1).max(128),
  causationId: z.string().uuid().optional(),
  producer: z.string().min(1),
});

export type DomainEventEnvelope = z.infer<typeof domainEventEnvelopeSchema>;

export interface DomainEvent<TPayload> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  producer: string;
  payload: TPayload;
}

/**
 * Constroi o schema completo de um evento combinando o envelope com o schema
 * do payload especifico e travando `eventType` no literal correspondente.
 */
export function buildEventSchema<TType extends string, TPayload extends z.ZodTypeAny>(
  eventType: TType,
  payloadSchema: TPayload
) {
  return domainEventEnvelopeSchema.extend({
    eventType: z.literal(eventType),
    payload: payloadSchema,
  });
}

export const EVENT_VERSION_V1 = 1 as const;
