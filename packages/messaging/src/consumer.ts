import type { Channel, ConsumeMessage } from 'amqplib';
import {
  isKnownEventType,
  safeParseEvent,
  type DomainEvent,
  type EventType,
} from '@loja-veloz/shared-types';
import {
  runWithCorrelationId,
  runWithExtractedContext,
  withSpan,
  type Logger,
} from '@loja-veloz/observability';
import type { RabbitMQClient } from './connection';
import { EXCHANGES, type QueueName } from './topology';
import {
  CORRELATION_HEADER,
  FAILURE_REASON_HEADER,
  ORIGINAL_QUEUE_HEADER,
  RETRY_COUNT_HEADER,
} from './publisher';
import {
  duplicateMessagesTotal,
  messageConsumeFailuresTotal,
  messageProcessingDurationSeconds,
  messageRetriesTotal,
  messagesConsumedTotal,
  messagesDeadLetteredTotal,
} from './metrics';
import type { IdempotencyStore } from './idempotency';

export interface EventHandlerContext {
  correlationId: string;
  queue: QueueName;
  retryCount: number;
  logger: Logger;
}

export type EventHandler = (
  event: DomainEvent<unknown>,
  context: EventHandlerContext
) => Promise<void>;

/** Erro que o handler pode lancar para sinalizar que retry nao vai adiantar. */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface ConsumerOptions {
  client: RabbitMQClient;
  queue: QueueName;
  handler: EventHandler;
  logger: Logger;
  maxRetries: number;
  /**
   * Guarda previa de idempotencia. Complementa, e nao substitui, o registro
   * transacional do `eventId` feito dentro do handler.
   */
  idempotencyStore?: IdempotencyStore;
}

type DeadLetterReason =
  | 'invalid_json'
  | 'unknown_event_type'
  | 'contract_violation'
  | 'retries_exhausted'
  | 'non_retryable';

export function readRetryCount(message: ConsumeMessage): number {
  const raw = message.properties.headers?.[RETRY_COUNT_HEADER];
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '0'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function readCorrelationId(message: ConsumeMessage): string {
  const header = message.properties.headers?.[CORRELATION_HEADER];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  if (Buffer.isBuffer(header)) {
    return header.toString('utf8');
  }
  return message.properties.correlationId ?? 'sem-correlacao';
}

/**
 * Decide o destino de uma mensagem que falhou.
 *
 * Regra: enquanto houver tentativas disponiveis, a mensagem volta pela fila
 * de retry com atraso. Esgotadas as tentativas, vai para a DLQ.
 * Nao existe caminho que produza retry infinito.
 */
export function decideFailureRoute(
  retryCount: number,
  maxRetries: number,
  retryable: boolean
): { action: 'retry'; nextRetryCount: number } | { action: 'dead-letter'; reason: DeadLetterReason } {
  if (!retryable) {
    return { action: 'dead-letter', reason: 'non_retryable' };
  }
  if (retryCount < maxRetries) {
    return { action: 'retry', nextRetryCount: retryCount + 1 };
  }
  return { action: 'dead-letter', reason: 'retries_exhausted' };
}

/**
 * Registra um consumidor resiliente para uma fila.
 *
 * Contrato de acknowledgement, em modo manual:
 *
 * - `ack` so acontece depois de (a) processamento bem-sucedido, ou
 *   (b) republicacao confirmada da mensagem na fila de retry ou na DLQ.
 *   Isso evita perder mensagem e evita o laco de redelivery imediato que
 *   `nack(requeue: true)` provocaria contra uma dependencia fora do ar.
 *
 * - Payload que viola o contrato nunca e reprocessado: um JSON invalido ou
 *   um `eventType` desconhecido nao vao ficar validos numa nova tentativa.
 *   Vao direto para a DLQ.
 *
 * - Falha ao republicar e o unico caso em que usamos `nack(requeue: true)`:
 *   se nao conseguimos nem mover a mensagem, devolve-la ao broker e mais
 *   seguro do que descarta-la.
 */
export async function registerEventConsumer(options: ConsumerOptions): Promise<void> {
  const { client, queue, handler, logger, maxRetries } = options;

  const register = async (channel: Channel): Promise<void> => {
    const republish = async (
      target: 'retry' | 'dead-letter',
      message: ConsumeMessage,
      extraHeaders: Record<string, string | number>
    ): Promise<void> => {
      const exchange = target === 'retry' ? EXCHANGES.RETRY : EXCHANGES.DLX;
      const publishChannel = client.getPublishChannel();

      await new Promise<void>((resolve, reject) => {
        publishChannel.publish(
          exchange,
          queue,
          message.content,
          {
            persistent: true,
            contentType: message.properties.contentType ?? 'application/json',
            messageId: message.properties.messageId,
            type: message.properties.type,
            correlationId: message.properties.correlationId,
            headers: {
              ...(message.properties.headers ?? {}),
              ...extraHeaders,
              [ORIGINAL_QUEUE_HEADER]: queue,
            },
          },
          (error) => (error ? reject(error) : resolve())
        );
      });
    };

    const consumeResult = await channel.consume(
      queue,
      (message) => {
        if (message === null) {
          logger.warn({ queue }, 'Consumidor cancelado pelo broker');
          return;
        }
        void handleMessage(message);
      },
      { noAck: false }
    );

    client.trackConsumerTag(consumeResult.consumerTag);
    logger.info({ queue, consumerTag: consumeResult.consumerTag }, 'Consumidor registrado');

    async function handleMessage(message: ConsumeMessage): Promise<void> {
      const correlationId = readCorrelationId(message);
      const retryCount = readRetryCount(message);
      const routingKey = message.fields.routingKey;

      const deadLetter = async (reason: DeadLetterReason, eventType: string): Promise<void> => {
        try {
          await republish('dead-letter', message, {
            [FAILURE_REASON_HEADER]: reason,
            [RETRY_COUNT_HEADER]: retryCount,
          });
          channel.ack(message);
          messagesDeadLetteredTotal.inc({ queue, event_type: eventType, reason });
          logger.error(
            { queue, eventType, reason, correlationId, retryCount },
            'Mensagem enviada para a dead letter queue'
          );
        } catch (error) {
          // Nao conseguimos mover a mensagem: devolver ao broker e mais seguro
          // do que confirmar e perde-la.
          logger.error({ queue, err: error }, 'Falha ao publicar na DLQ, devolvendo ao broker');
          channel.nack(message, false, true);
        }
      };

      let raw: unknown;
      try {
        raw = JSON.parse(message.content.toString('utf8'));
      } catch {
        messageConsumeFailuresTotal.inc({ queue, event_type: routingKey, reason: 'invalid_json' });
        await deadLetter('invalid_json', routingKey);
        return;
      }

      const envelopeType = (raw as { eventType?: unknown }).eventType;
      if (typeof envelopeType !== 'string' || !isKnownEventType(envelopeType)) {
        messageConsumeFailuresTotal.inc({
          queue,
          event_type: routingKey,
          reason: 'unknown_event_type',
        });
        await deadLetter('unknown_event_type', routingKey);
        return;
      }

      const eventType: EventType = envelopeType;
      const parsed = safeParseEvent(eventType, raw);
      if (!parsed.success) {
        messageConsumeFailuresTotal.inc({
          queue,
          event_type: eventType,
          reason: 'contract_violation',
        });
        logger.error(
          { queue, eventType, correlationId, issues: parsed.error.issues },
          'Evento viola o contrato publicado'
        );
        await deadLetter('contract_violation', eventType);
        return;
      }

      const event = parsed.data as unknown as DomainEvent<unknown>;

      // Guarda previa de idempotencia: evita trabalho repetido, mas a garantia
      // real vem do registro transacional feito dentro do handler.
      if (options.idempotencyStore) {
        try {
          if (await options.idempotencyStore.wasProcessed(event.eventId)) {
            duplicateMessagesTotal.inc({ queue, event_type: eventType });
            channel.ack(message);
            logger.info(
              { queue, eventType, eventId: event.eventId, correlationId },
              'Evento duplicado ignorado por idempotencia'
            );
            return;
          }
        } catch (error) {
          logger.warn(
            { queue, eventType, err: error },
            'Falha na consulta de idempotencia, seguindo para o handler'
          );
        }
      }

      const endTimer = messageProcessingDurationSeconds.startTimer({
        queue,
        event_type: eventType,
      });

      try {
        // Reconstroi o trace remoto a partir dos headers e propaga o
        // correlationId pelo contexto assincrono.
        await runWithExtractedContext(message.properties.headers ?? {}, () =>
          runWithCorrelationId(correlationId, () =>
            withSpan(
              `consume ${queue}`,
              {
                'messaging.system': 'rabbitmq',
                'messaging.destination.name': queue,
                'messaging.operation': 'process',
                'messaging.rabbitmq.routing_key': routingKey,
                'event.type': eventType,
                'event.retry_count': retryCount,
              },
              async () => handler(event, { correlationId, queue, retryCount, logger })
            )
          )
        );

        channel.ack(message);
        endTimer();
        messagesConsumedTotal.inc({ queue, event_type: eventType });
        logger.info(
          { queue, eventType, eventId: event.eventId, correlationId, retryCount },
          'Evento processado'
        );
      } catch (error) {
        endTimer();
        const retryable = !(error instanceof NonRetryableError);
        messageConsumeFailuresTotal.inc({
          queue,
          event_type: eventType,
          reason: retryable ? 'handler_error' : 'non_retryable',
        });

        const decision = decideFailureRoute(retryCount, maxRetries, retryable);

        if (decision.action === 'dead-letter') {
          logger.error(
            {
              queue,
              eventType,
              eventId: event.eventId,
              correlationId,
              retryCount,
              reason: decision.reason,
              err: error instanceof Error ? error : new Error(String(error)),
            },
            'Processamento falhou em definitivo'
          );
          await deadLetter(decision.reason, eventType);
          return;
        }

        try {
          await republish('retry', message, {
            [RETRY_COUNT_HEADER]: decision.nextRetryCount,
            [FAILURE_REASON_HEADER]: error instanceof Error ? error.name : 'UnknownError',
          });
          channel.ack(message);
          messageRetriesTotal.inc({ queue, event_type: eventType });
          logger.warn(
            {
              queue,
              eventType,
              eventId: event.eventId,
              correlationId,
              retryCount: decision.nextRetryCount,
              maxRetries,
              err: error instanceof Error ? error : new Error(String(error)),
            },
            'Evento reenviado para a fila de retry'
          );
        } catch (republishError) {
          logger.error(
            { queue, eventType, err: republishError },
            'Falha ao reenviar para retry, devolvendo ao broker'
          );
          channel.nack(message, false, true);
        }
      }
    }
  };

  await client.registerConsumer(register);
}
