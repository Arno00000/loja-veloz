import {
  EXCHANGES,
  EXCHANGE_TYPE,
  QUEUES,
  QUEUE_DEFINITIONS,
  assertTopology,
  deadLetterQueueName,
  findQueueDefinition,
  retryQueueName,
  type TopologyChannel,
} from '../topology';
import { ALL_EVENT_TYPES, EVENT_TYPES } from '@loja-veloz/shared-types';

function fakeChannel() {
  const calls = {
    exchanges: [] as Array<{ exchange: string; type: string; durable: boolean }>,
    queues: [] as Array<{ queue: string; options: Record<string, unknown> }>,
    bindings: [] as Array<{ queue: string; source: string; pattern: string }>,
  };

  const channel: TopologyChannel = {
    async assertExchange(exchange, type, options) {
      calls.exchanges.push({ exchange, type, durable: options.durable });
      return {};
    },
    async assertQueue(queue, options) {
      calls.queues.push({ queue, options });
      return {};
    },
    async bindQueue(queue, source, pattern) {
      calls.bindings.push({ queue, source, pattern });
      return {};
    },
  };

  return { channel, calls };
}

describe('topologia do RabbitMQ', () => {
  it('usa apenas eventTypes do catalogo como routing key', () => {
    for (const definition of QUEUE_DEFINITIONS) {
      for (const binding of definition.bindings) {
        expect(ALL_EVENT_TYPES).toContain(binding);
      }
    }
  });

  it('declara os tres exchanges como topic e duraveis', async () => {
    const { channel, calls } = fakeChannel();
    await assertTopology(channel, { retryDelayMs: 5000 });

    expect(calls.exchanges).toEqual([
      { exchange: EXCHANGES.EVENTS, type: EXCHANGE_TYPE, durable: true },
      { exchange: EXCHANGES.RETRY, type: EXCHANGE_TYPE, durable: true },
      { exchange: EXCHANGES.DLX, type: EXCHANGE_TYPE, durable: true },
    ]);
  });

  it('declara fila principal, retry e DLQ para cada consumidor', async () => {
    const { channel, calls } = fakeChannel();
    await assertTopology(channel, { retryDelayMs: 5000 });

    for (const definition of QUEUE_DEFINITIONS) {
      const names = calls.queues.map((entry) => entry.queue);
      expect(names).toContain(definition.name);
      expect(names).toContain(retryQueueName(definition.name));
      expect(names).toContain(deadLetterQueueName(definition.name));
    }
  });

  it('declara todas as filas como duraveis', async () => {
    const { channel, calls } = fakeChannel();
    await assertTopology(channel, { retryDelayMs: 5000 });
    for (const entry of calls.queues) {
      expect(entry.options.durable).toBe(true);
    }
  });

  it('configura TTL e dead-letter na fila de retry para devolver a fila original', async () => {
    const { channel, calls } = fakeChannel();
    await assertTopology(channel, { retryDelayMs: 7500 });

    const retryQueue = calls.queues.find(
      (entry) => entry.queue === retryQueueName(QUEUES.ORDERS_STOCK_RESULT)
    );

    expect(retryQueue).toBeDefined();
    expect(retryQueue?.options.messageTtl).toBe(7500);
    expect(retryQueue?.options.deadLetterExchange).toBe('');
    expect(retryQueue?.options.deadLetterRoutingKey).toBe(QUEUES.ORDERS_STOCK_RESULT);
  });

  it('vincula cada fila ao exchange principal com as routing keys declaradas', async () => {
    const { channel, calls } = fakeChannel();
    await assertTopology(channel, { retryDelayMs: 5000 });

    expect(calls.bindings).toContainEqual({
      queue: QUEUES.INVENTORY_ORDER_CREATED,
      source: EXCHANGES.EVENTS,
      pattern: EVENT_TYPES.ORDER_CREATED,
    });
    expect(calls.bindings).toContainEqual({
      queue: QUEUES.ORDERS_STOCK_RESULT,
      source: EXCHANGES.EVENTS,
      pattern: EVENT_TYPES.STOCK_FAILED,
    });
    expect(calls.bindings).toContainEqual({
      queue: QUEUES.PAYMENTS_STOCK_RESERVED,
      source: EXCHANGES.EVENTS,
      pattern: EVENT_TYPES.STOCK_RESERVED,
    });
  });

  it('e idempotente: declarar duas vezes produz as mesmas chamadas', async () => {
    const first = fakeChannel();
    const second = fakeChannel();
    await assertTopology(first.channel, { retryDelayMs: 5000 });
    await assertTopology(second.channel, { retryDelayMs: 5000 });
    expect(first.calls).toEqual(second.calls);
  });

  it('localiza a definicao de uma fila pelo nome', () => {
    expect(findQueueDefinition(QUEUES.ORDERS_AUDIT)?.owner).toBe('order-service');
    expect(findQueueDefinition('fila.inexistente')).toBeUndefined();
  });
});
