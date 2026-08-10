import { decideFailureRoute, readRetryCount, readCorrelationId } from '../consumer';
import { InMemoryIdempotencyStore } from '../idempotency';
import { RETRY_COUNT_HEADER, CORRELATION_HEADER } from '../publisher';
import type { ConsumeMessage } from 'amqplib';

function message(headers: Record<string, unknown>, correlationId?: string): ConsumeMessage {
  return {
    content: Buffer.from('{}'),
    fields: { routingKey: 'order.created' },
    properties: { headers, correlationId },
  } as unknown as ConsumeMessage;
}

describe('politica de retry', () => {
  it('reenvia enquanto houver tentativas disponiveis', () => {
    expect(decideFailureRoute(0, 3, true)).toEqual({ action: 'retry', nextRetryCount: 1 });
    expect(decideFailureRoute(1, 3, true)).toEqual({ action: 'retry', nextRetryCount: 2 });
    expect(decideFailureRoute(2, 3, true)).toEqual({ action: 'retry', nextRetryCount: 3 });
  });

  it('envia para a DLQ quando as tentativas se esgotam', () => {
    expect(decideFailureRoute(3, 3, true)).toEqual({
      action: 'dead-letter',
      reason: 'retries_exhausted',
    });
    expect(decideFailureRoute(10, 3, true)).toEqual({
      action: 'dead-letter',
      reason: 'retries_exhausted',
    });
  });

  it('nunca produz retry infinito', () => {
    const maxRetries = 3;
    let retryCount = 0;
    let iterations = 0;

    for (; iterations < 100; iterations += 1) {
      const decision = decideFailureRoute(retryCount, maxRetries, true);
      if (decision.action === 'dead-letter') {
        break;
      }
      retryCount = decision.nextRetryCount;
    }

    expect(iterations).toBe(maxRetries);
    expect(decideFailureRoute(retryCount, maxRetries, true).action).toBe('dead-letter');
  });

  it('com maxRetries igual a zero vai direto para a DLQ', () => {
    expect(decideFailureRoute(0, 0, true)).toEqual({
      action: 'dead-letter',
      reason: 'retries_exhausted',
    });
  });

  it('erros nao recuperaveis pulam o retry', () => {
    expect(decideFailureRoute(0, 5, false)).toEqual({
      action: 'dead-letter',
      reason: 'non_retryable',
    });
  });
});

describe('leitura de headers da mensagem', () => {
  it('le o contador de tentativas como numero', () => {
    expect(readRetryCount(message({ [RETRY_COUNT_HEADER]: 2 }))).toBe(2);
  });

  it('aceita contador enviado como texto', () => {
    expect(readRetryCount(message({ [RETRY_COUNT_HEADER]: '3' }))).toBe(3);
  });

  it('assume zero quando o header esta ausente ou invalido', () => {
    expect(readRetryCount(message({}))).toBe(0);
    expect(readRetryCount(message({ [RETRY_COUNT_HEADER]: 'abc' }))).toBe(0);
    expect(readRetryCount(message({ [RETRY_COUNT_HEADER]: -5 }))).toBe(0);
  });

  it('le o correlationId do header, do Buffer ou da propriedade AMQP', () => {
    expect(readCorrelationId(message({ [CORRELATION_HEADER]: 'corr-1' }))).toBe('corr-1');
    expect(readCorrelationId(message({ [CORRELATION_HEADER]: Buffer.from('corr-2') }))).toBe(
      'corr-2'
    );
    expect(readCorrelationId(message({}, 'corr-3'))).toBe('corr-3');
    expect(readCorrelationId(message({}))).toBe('sem-correlacao');
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('reconhece eventos ja processados', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.wasProcessed('evt-1')).toBe(false);
    await store.markProcessed('evt-1', 'order.created');
    expect(await store.wasProcessed('evt-1')).toBe(true);
    expect(store.size).toBe(1);
  });

  it('marcar duas vezes o mesmo evento nao duplica o registro', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.markProcessed('evt-1', 'order.created');
    await store.markProcessed('evt-1', 'order.created');
    expect(store.size).toBe(1);
  });
});
