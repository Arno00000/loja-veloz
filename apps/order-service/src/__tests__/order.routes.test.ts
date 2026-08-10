import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ORDER_STATUS } from '@loja-veloz/shared-types';
import { createApp } from '../app';
import { loadOrderServiceConfig } from '../config';
import { OrderService } from '../services/order.service';
import { InMemoryOrderRepository, RecordingPublisher, silentLogger } from './fakes';

const config = loadOrderServiceConfig({
  SERVICE_NAME: 'order-service',
  PORT: '3001',
  DATABASE_URL: 'postgresql://orders_user:x@localhost:5432/orders_db',
  RABBITMQ_URL: 'amqp://localhost:5672',
  OTEL_TRACES_ENABLED: 'false',
});

function buildApp(dependencyHealthy = true) {
  const repository = new InMemoryOrderRepository();
  const publisher = new RecordingPublisher();
  const service = new OrderService({
    repository,
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

  return { app, repository, publisher, service };
}

const validBody = {
  customerId: 'CUSTOMER-001',
  items: [{ sku: 'SKU-TECLADO-001', quantity: 2, unitPrice: 125.25 }],
};

describe('POST /orders', () => {
  it('cria o pedido e responde 201 com Location', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/orders').send(validBody);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe(ORDER_STATUS.PENDING);
    expect(response.body.total).toBe(250.5);
    expect(response.headers.location).toBe(`/orders/${response.body.id}`);
    expect(response.headers['x-correlation-id']).toBeDefined();
  });

  it.each([
    ['sem customerId', { items: validBody.items }],
    ['customerId vazio', { customerId: '   ', items: validBody.items }],
    ['sem itens', { customerId: 'C1', items: [] }],
    ['quantidade zero', { customerId: 'C1', items: [{ sku: 'S1', quantity: 0, unitPrice: 5 }] }],
    [
      'quantidade fracionada',
      { customerId: 'C1', items: [{ sku: 'S1', quantity: 1.5, unitPrice: 5 }] },
    ],
    ['preco negativo', { customerId: 'C1', items: [{ sku: 'S1', quantity: 1, unitPrice: -5 }] }],
    [
      'sku repetido',
      {
        customerId: 'C1',
        items: [
          { sku: 'S1', quantity: 1, unitPrice: 5 },
          { sku: 'S1', quantity: 2, unitPrice: 5 },
        ],
      },
    ],
  ])('rejeita payload invalido: %s', async (_label, body) => {
    const { app } = buildApp();
    const response = await request(app).post('/orders').send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(response.body.error.details)).toBe(true);
  });

  it('nao publica evento quando a validacao falha', async () => {
    const { app, publisher } = buildApp();
    await request(app).post('/orders').send({ customerId: '' });
    expect(publisher.published).toHaveLength(0);
  });
});

describe('GET /orders/:id', () => {
  it('devolve o pedido existente', async () => {
    const { app } = buildApp();
    const created = await request(app).post('/orders').send(validBody);
    const response = await request(app).get(`/orders/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.body.id);
    expect(response.body.items).toHaveLength(1);
  });

  it('responde 404 para pedido inexistente', async () => {
    const { app } = buildApp();
    const response = await request(app).get(`/orders/${randomUUID()}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('responde 400 quando o id nao e um UUID', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/orders/abc');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /orders', () => {
  it('lista com paginacao padrao', async () => {
    const { app } = buildApp();
    await request(app).post('/orders').send(validBody);
    await request(app).post('/orders').send(validBody);

    const response = await request(app).get('/orders');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination.page).toBe(1);
    expect(response.body.pagination.pageSize).toBe(20);
  });

  it('rejeita pageSize acima do maximo', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/orders?pageSize=5000');

    expect(response.status).toBe(400);
  });

  it('rejeita status desconhecido no filtro', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/orders?status=CANCELADO');

    expect(response.status).toBe(400);
  });
});

describe('healthchecks do Servico de Pedidos', () => {
  it('liveness responde 200 mesmo com dependencias fora do ar', async () => {
    const { app } = buildApp(false);
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
  });

  it('readiness responde 503 quando o banco esta indisponivel', async () => {
    const { app } = buildApp(false);
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'postgres', healthy: false })])
    );
  });

  it('readiness responde 200 quando tudo esta disponivel', async () => {
    const { app } = buildApp(true);
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(200);
  });
});
