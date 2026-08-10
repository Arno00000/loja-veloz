import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app';
import { loadPaymentServiceConfig } from '../config';
import { PaymentService } from '../services/payment.service';
import { PaymentGatewaySimulator } from '../services/payment-gateway.simulator';
import { InMemoryPaymentRepository, RecordingPublisher, silentLogger } from './fakes';

const ORDER_ID = '5b1f0f6c-2c9a-4f0f-9a6e-0b8f1c2d3e4f';

const config = loadPaymentServiceConfig({
  SERVICE_NAME: 'payment-service',
  PORT: '3003',
  DATABASE_URL: 'postgresql://payments_user:x@localhost:5432/payments_db',
  RABBITMQ_URL: 'amqp://localhost:5672',
  OTEL_TRACES_ENABLED: 'false',
  PAYMENT_SIMULATION_ENABLED: 'true',
  PAYMENT_FAIL_CUSTOMER_ID: 'CUSTOMER-PAYMENT-FAIL',
});

function buildApp(dependencyHealthy = true) {
  const repository = new InMemoryPaymentRepository();
  const publisher = new RecordingPublisher();
  const service = new PaymentService({
    repository,
    simulator: new PaymentGatewaySimulator({
      simulationEnabled: config.PAYMENT_SIMULATION_ENABLED,
      failCustomerId: config.PAYMENT_FAIL_CUSTOMER_ID,
      processingDelayMs: 0,
    }),
    publisher: publisher.asPublisher(),
    logger: silentLogger,
  });

  const app = createApp({
    config,
    logger: silentLogger,
    service,
    dependencies: [
      { name: 'postgres', critical: true, check: async () => dependencyHealthy },
      { name: 'rabbitmq', critical: true, check: async () => dependencyHealthy },
    ],
  });

  return { app, service };
}

describe('GET /payments/:orderId', () => {
  it('devolve o pagamento aprovado', async () => {
    const { app, service } = buildApp();
    await service.handleStockReserved({
      eventId: randomUUID(),
      eventType: 'stock.reserved',
      orderId: ORDER_ID,
      customerId: 'CUSTOMER-001',
      amount: 250.5,
      correlationId: 'corr-1',
    });

    const response = await request(app).get(`/payments/${ORDER_ID}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('APPROVED');
    expect(response.body.amount).toBe(250.5);
    expect(response.body.externalReference).toMatch(/^SIM-/);
  });

  it('devolve o pagamento recusado com o motivo', async () => {
    const { app, service } = buildApp();
    await service.handleStockReserved({
      eventId: randomUUID(),
      eventType: 'stock.reserved',
      orderId: ORDER_ID,
      customerId: 'CUSTOMER-PAYMENT-FAIL',
      amount: 99.9,
      correlationId: 'corr-2',
    });

    const response = await request(app).get(`/payments/${ORDER_ID}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('FAILED');
    expect(response.body.failureReason).toContain('recusado');
  });

  it('responde 404 quando o pedido ainda nao tem pagamento', async () => {
    const { app } = buildApp();
    const response = await request(app).get(`/payments/${randomUUID()}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('responde 400 quando o orderId nao e um UUID', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/payments/abc');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('healthchecks do Servico de Pagamentos', () => {
  it('liveness responde 200 com dependencias fora do ar', async () => {
    const { app } = buildApp(false);
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
  });

  it('readiness responde 503 com dependencias fora do ar', async () => {
    const { app } = buildApp(false);
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(503);
  });

  it('expoe metricas de pagamento', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.text).toContain('payments_processed_total');
  });
});
