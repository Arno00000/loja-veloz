import { randomUUID } from 'node:crypto';
import {
  parseEvent,
  type DomainEvent,
  type EventType,
  EVENT_VERSION_V1,
} from '@loja-veloz/shared-types';
import { injectTraceContext, type Logger } from '@loja-veloz/observability';
import type { RabbitMQClient } from './connection';
import { EXCHANGES } from './topology';
import { messagePublishFailuresTotal, messagesPublishedTotal } from './metrics';

export const CORRELATION_HEADER = 'x-correlation-id';
export const RETRY_COUNT_HEADER = 'x-retry-count';
export const FAILURE_REASON_HEADER = 'x-failure-reason';
export const ORIGINAL_QUEUE_HEADER = 'x-original-queue';

export interface PublishContext {
  correlationId: string;
  /** `eventId` do evento que originou este, quando houver. */
  causationId?: string;
}

export interface EventPublisherOptions {
  client: RabbitMQClient;
  producer: string;
  logger: Logger;
  /** Tempo maximo de espera pelo ack do broker. */
  confirmTimeoutMs?: number;
}

/**
 * Publicador de eventos de dominio.
 *
 * Garantias oferecidas:
 * - mensagem persistente (`deliveryMode: 2`) em exchange e filas duraveis;
 * - publisher confirms: a promessa so resolve depois do ack do broker;
 * - o payload e validado contra o schema do proprio catalogo antes de sair,
 *   o que impede que um produtor publique um contrato quebrado.
 *
 * Limitacao assumida e documentada: entre o commit no banco e o ack do
 * publish existe uma janela em que o processo pode morrer. Nesse caso o
 * efeito local ja aconteceu, mas o evento nao foi publicado. A solucao
 * definitiva e o transactional outbox, listado como evolucao futura em
 * docs/limitations-and-roadmap.md. Implementa-lo pela metade seria pior do
 * que assumir a limitacao de forma explicita.
 */
export class EventPublisher {
  private readonly confirmTimeoutMs: number;

  constructor(private readonly options: EventPublisherOptions) {
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? 5000;
  }

  async publish<TType extends EventType>(
    eventType: TType,
    payload: unknown,
    context: PublishContext
  ): Promise<DomainEvent<unknown>> {
    const event: DomainEvent<unknown> = {
      eventId: randomUUID(),
      eventType,
      eventVersion: EVENT_VERSION_V1,
      occurredAt: new Date().toISOString(),
      correlationId: context.correlationId,
      producer: this.options.producer,
      payload,
    };
    if (context.causationId) {
      event.causationId = context.causationId;
    }

    // Falha rapido se o produtor montou um payload fora do contrato.
    parseEvent(eventType, event);

    const channel = this.options.client.getPublishChannel();
    const headers = injectTraceContext({ [CORRELATION_HEADER]: context.correlationId });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout de ${this.confirmTimeoutMs}ms aguardando confirmacao do broker`));
      }, this.confirmTimeoutMs);
      timer.unref();

      channel.publish(
        EXCHANGES.EVENTS,
        eventType,
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: event.eventId,
          type: eventType,
          timestamp: Date.now(),
          appId: this.options.producer,
          correlationId: context.correlationId,
          headers,
        },
        (error) => {
          clearTimeout(timer);
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }
      );
    }).catch((error: unknown) => {
      messagePublishFailuresTotal.inc({ event_type: eventType });
      this.options.logger.error(
        {
          eventType,
          eventId: event.eventId,
          correlationId: context.correlationId,
          err: error instanceof Error ? error : new Error(String(error)),
        },
        'Falha ao publicar evento'
      );
      throw error;
    });

    messagesPublishedTotal.inc({ event_type: eventType });
    this.options.logger.info(
      {
        eventType,
        eventId: event.eventId,
        correlationId: context.correlationId,
        causationId: context.causationId,
      },
      'Evento publicado'
    );

    return event;
  }
}
