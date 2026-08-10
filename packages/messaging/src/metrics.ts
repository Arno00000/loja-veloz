import { createCounter, createHistogram, createGauge } from '@loja-veloz/observability';

/**
 * Metricas de mensageria.
 *
 * Todos os labels usados aqui sao de baixa cardinalidade: nome de fila,
 * tipo de evento e motivo classificado. `eventId`, `orderId` e `correlationId`
 * jamais aparecem como label, apenas em logs e traces.
 */
export const messagesPublishedTotal = createCounter({
  name: 'messaging_messages_published_total',
  help: 'Total de mensagens publicadas no exchange principal',
  labelNames: ['event_type'] as const,
});

export const messagePublishFailuresTotal = createCounter({
  name: 'messaging_publish_failures_total',
  help: 'Total de falhas ao publicar mensagens, incluindo nack do broker',
  labelNames: ['event_type'] as const,
});

export const messagesConsumedTotal = createCounter({
  name: 'messaging_messages_consumed_total',
  help: 'Total de mensagens consumidas e processadas com sucesso',
  labelNames: ['queue', 'event_type'] as const,
});

export const messageConsumeFailuresTotal = createCounter({
  name: 'messaging_consume_failures_total',
  help: 'Total de falhas no processamento de mensagens',
  labelNames: ['queue', 'event_type', 'reason'] as const,
});

export const messageRetriesTotal = createCounter({
  name: 'messaging_retries_total',
  help: 'Total de mensagens reenviadas para a fila de retry',
  labelNames: ['queue', 'event_type'] as const,
});

export const messagesDeadLetteredTotal = createCounter({
  name: 'messaging_dead_lettered_total',
  help: 'Total de mensagens enviadas para a dead letter queue',
  labelNames: ['queue', 'event_type', 'reason'] as const,
});

export const duplicateMessagesTotal = createCounter({
  name: 'messaging_duplicate_messages_total',
  help: 'Total de mensagens descartadas por idempotencia (eventId ja processado)',
  labelNames: ['queue', 'event_type'] as const,
});

export const messageProcessingDurationSeconds = createHistogram({
  name: 'messaging_processing_duration_seconds',
  help: 'Tempo de processamento de eventos pelos consumidores',
  labelNames: ['queue', 'event_type'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

export const brokerConnectionUp = createGauge({
  name: 'messaging_broker_connection_up',
  help: 'Estado da conexao com o RabbitMQ (1 conectado, 0 desconectado)',
});

export const brokerReconnectionsTotal = createCounter({
  name: 'messaging_broker_reconnections_total',
  help: 'Total de reconexoes ao RabbitMQ apos queda',
});
