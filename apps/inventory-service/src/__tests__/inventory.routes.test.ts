import request from 'supertest';
import { createApp } from '../app';
import { loadInventoryServiceConfig } from '../config';
import { InventoryService } from '../services/inventory.service';
import { InMemoryInventoryRepository, RecordingPublisher, silentLogger } from './fakes';

function buildConfig(overrides: Record<string, string> = {}) {
  return loadInventoryServiceConfig({
    SERVICE_NAME: 'inventory-service',
    PORT: '3002',
    DATABASE_URL: 'postgresql://inventory_user:x@localhost:5432/inventory_db',
    RABBITMQ_URL: 'amqp://localhost:5672',
    OTEL_TRACES_ENABLED: 'false',
    INVENTORY_RESTOCK_ENABLED: 'true',
    INVENTORY_ADMIN_KEY: 'admin_dev_only',
    ...overrides,
  });
}

function buildApp(configOverrides: Record<string, string> = {}, dependencyHealthy = true) {
  const config = buildConfig(configOverrides);
  const repository = new InMemoryInventoryRepository([
    { sku: 'SKU-TECLADO-001', availableQuantity: 10 },
    { sku: 'SKU-SEM-ESTOQUE', availableQuantity: 0 },
  ]);
  const publisher = new RecordingPublisher();
  const service = new InventoryService({
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

  return { app, repository };
}

describe('configuracao do endpoint academico', () => {
  it('recusa habilitar reposicao sem chave de administracao', () => {
    expect(() =>
      loadInventoryServiceConfig({
        SERVICE_NAME: 'inventory-service',
        PORT: '3002',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/inventory_db',
        RABBITMQ_URL: 'amqp://localhost:5672',
        INVENTORY_RESTOCK_ENABLED: 'true',
      })
    ).toThrow(/INVENTORY_ADMIN_KEY/);
  });

  it('vem desabilitado por padrao', () => {
    const config = loadInventoryServiceConfig({
      SERVICE_NAME: 'inventory-service',
      PORT: '3002',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/inventory_db',
      RABBITMQ_URL: 'amqp://localhost:5672',
    });
    expect(config.INVENTORY_RESTOCK_ENABLED).toBe(false);
  });
});

describe('GET /inventory/:sku', () => {
  it('devolve o saldo do SKU', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/inventory/SKU-TECLADO-001');

    expect(response.status).toBe(200);
    expect(response.body.availableQuantity).toBe(10);
  });

  it('devolve zero para o SKU de demonstracao de falha', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/inventory/SKU-SEM-ESTOQUE');

    expect(response.status).toBe(200);
    expect(response.body.availableQuantity).toBe(0);
  });

  it('responde 404 para SKU inexistente', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/inventory/SKU-INEXISTENTE');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('responde 400 para SKU com caracteres invalidos', async () => {
    const { app } = buildApp();
    const response = await request(app).get('/inventory/SKU%20INVALIDO!');

    expect(response.status).toBe(400);
  });
});

describe('POST /inventory/restock', () => {
  it('repoe o estoque quando a chave de administracao esta correta', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/inventory/restock')
      .set('x-admin-key', 'admin_dev_only')
      .send({ sku: 'SKU-SEM-ESTOQUE', quantity: 25 });

    expect(response.status).toBe(200);
    expect(response.body.availableQuantity).toBe(25);
  });

  it('responde 401 sem a chave de administracao', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/inventory/restock')
      .send({ sku: 'SKU-TECLADO-001', quantity: 5 });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('responde 401 com a chave errada', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/inventory/restock')
      .set('x-admin-key', 'chave-errada')
      .send({ sku: 'SKU-TECLADO-001', quantity: 5 });

    expect(response.status).toBe(401);
  });

  it('responde 404 quando o recurso esta desabilitado', async () => {
    const { app } = buildApp({ INVENTORY_RESTOCK_ENABLED: 'false' });
    const response = await request(app)
      .post('/inventory/restock')
      .set('x-admin-key', 'admin_dev_only')
      .send({ sku: 'SKU-TECLADO-001', quantity: 5 });

    expect(response.status).toBe(404);
  });

  it('rejeita quantidade invalida', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/inventory/restock')
      .set('x-admin-key', 'admin_dev_only')
      .send({ sku: 'SKU-TECLADO-001', quantity: -3 });

    expect(response.status).toBe(400);
  });
});

describe('healthchecks do Servico de Estoque', () => {
  it('liveness responde 200 com dependencias fora do ar', async () => {
    const { app } = buildApp({}, false);
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
  });

  it('readiness responde 503 com dependencias fora do ar', async () => {
    const { app } = buildApp({}, false);
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(503);
  });
});
