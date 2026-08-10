import { randomUUID } from 'node:crypto';
import {
  PaymentGatewaySimulator,
  DEMO_FAILURE_REASON,
} from '../services/payment-gateway.simulator';
import { PaymentService } from '../services/payment.service';
import { InMemoryPaymentRepository, RecordingPublisher, silentLogger } from './fakes';

const ORDER_ID = '5b1f0f6c-2c9a-4f0f-9a6e-0b8f1c2d3e4f';
const FAIL_CUSTOMER = 'CUSTOMER-PAYMENT-FAIL';
const CORRELATION = 'corr-pagamento-001';

function buildSimulator(simulationEnabled = true) {
  return new PaymentGatewaySimulator({
    simulationEnabled,
    failCustomerId: FAIL_CUSTOMER,
    processingDelayMs: 0,
  });
}

function build(simulationEnabled = true) {
  const repository = new InMemoryPaymentRepository();
  const publisher = new RecordingPublisher();
  const service = new PaymentService({
    repository,
    simulator: buildSimulator(simulationEnabled),
    publisher: publisher.asPublisher(),
    logger: silentLogger,
  });
  return { repository, publisher, service };
}

function stockReserved(customerId: string, eventId = randomUUID(), orderId = ORDER_ID) {
  return {
    eventId,
    eventType: 'stock.reserved',
    orderId,
    customerId,
    amount: 250.5,
    correlationId: CORRELATION,
  };
}

describe('simulador de pagamento', () => {
  it('aprova clientes comuns', async () => {
    const result = await buildSimulator().authorize({
      orderId: ORDER_ID,
      customerId: 'CUSTOMER-001',
      amount: 100,
    });

    expect(result.approved).toBe(true);
    if (result.approved) {
      expect(result.externalReference).toMatch(/^SIM-/);
    }
  });

  it('recusa o cliente de demonstracao de forma deterministica', async () => {
    const simulator = buildSimulator();

    for (let i = 0; i < 20; i += 1) {
      const result = await simulator.authorize({
        orderId: ORDER_ID,
        customerId: FAIL_CUSTOMER,
        amount: 100,
      });
      expect(result.approved).toBe(false);
      if (!result.approved) {
        expect(result.reason).toBe(DEMO_FAILURE_REASON);
      }
    }
  });

  it('aprova o cliente de demonstracao quando a simulacao esta desligada', async () => {
    const result = await buildSimulator(false).authorize({
      orderId: ORDER_ID,
      customerId: FAIL_CUSTOMER,
      amount: 100,
    });

    expect(result.approved).toBe(true);
  });

  it('nao usa aleatoriedade: 50 aprovacoes seguidas para o mesmo cliente comum', async () => {
    const simulator = buildSimulator();
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        simulator.authorize({ orderId: ORDER_ID, customerId: 'CUSTOMER-001', amount: 10 })
      )
    );

    expect(results.every((result) => result.approved)).toBe(true);
  });

  it('gera uma referencia externa distinta por autorizacao', async () => {
    const simulator = buildSimulator();
    const first = await simulator.authorize({ orderId: ORDER_ID, customerId: 'C1', amount: 10 });
    const second = await simulator.authorize({ orderId: ORDER_ID, customerId: 'C1', amount: 10 });

    if (first.approved && second.approved) {
      expect(first.externalReference).not.toBe(second.externalReference);
    }
  });
});

describe('processamento de stock.reserved', () => {
  it('aprova, persiste e publica payment.approved', async () => {
    const { service, publisher, repository } = build();

    const outcome = await service.handleStockReserved(stockReserved('CUSTOMER-001'));

    expect(outcome.status).toBe('approved');
    expect(publisher.typesPublished()).toEqual(['payment.approved']);

    const stored = await repository.findByOrderId(ORDER_ID);
    expect(stored?.status).toBe('APPROVED');
    expect(stored?.amount).toBe(250.5);
  });

  it('recusa, persiste e publica payment.failed', async () => {
    const { service, publisher, repository } = build();

    const outcome = await service.handleStockReserved(stockReserved(FAIL_CUSTOMER));

    expect(outcome.status).toBe('failed');
    expect(publisher.typesPublished()).toEqual(['payment.failed']);
    expect(publisher.published[0]?.reason).toBe(DEMO_FAILURE_REASON);

    const stored = await repository.findByOrderId(ORDER_ID);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.failureReason).toBe(DEMO_FAILURE_REASON);
  });

  it('publica exatamente um resultado por evento', async () => {
    const { service, publisher } = build();
    await service.handleStockReserved(stockReserved('CUSTOMER-001'));
    expect(publisher.published).toHaveLength(1);
  });
});

describe('idempotencia do pagamento', () => {
  it('ignora o mesmo eventId entregue duas vezes', async () => {
    const { service, publisher } = build();
    const eventId = randomUUID();

    const first = await service.handleStockReserved(stockReserved('CUSTOMER-001', eventId));
    const second = await service.handleStockReserved(stockReserved('CUSTOMER-001', eventId));

    expect(first.status).toBe('approved');
    expect(second.status).toBe('duplicate');
    expect(publisher.published).toHaveLength(1);
  });

  it('nao cria um segundo pagamento para o mesmo pedido', async () => {
    const { service, publisher } = build();

    await service.handleStockReserved(stockReserved('CUSTOMER-001', randomUUID()));
    const second = await service.handleStockReserved(stockReserved('CUSTOMER-001', randomUUID()));

    expect(second.status).toBe('duplicate');
    expect(publisher.published).toHaveLength(1);
  });
});
