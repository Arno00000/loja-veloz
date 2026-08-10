import { createLogger } from '@loja-veloz/observability';
import request from 'supertest';
import { createApp } from '../app';
import { loadGatewayConfig, type GatewayConfig } from '../config';
import type { UpstreamClient, UpstreamRequest, UpstreamResponse } from '../upstream';
import { ServiceUnavailableError, UpstreamTimeoutError } from '@loja-veloz/observability';

const silentLogger = createLogger({
  serviceName: 'api-gateway-test',
  serviceVersion: 'test',
  environment: 'test',
  level: 'silent',
});

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SERVICE_NAME: 'api-gateway',
    PORT: '8080',
    ORDER_SERVICE_URL: 'http://order-service:3001',
    INVENTORY_SERVICE_URL: 'http://inventory-service:3002',
    PAYMENT_SERVICE_URL: 'http://payment-service:3003',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    OTEL_TRACES_ENABLED: 'false',
    ...overrides,
  };
}

function fakeUpstream(
  respond: (request: UpstreamRequest) => Promise<UpstreamResponse> | UpstreamResponse
): { client: UpstreamClient; calls: UpstreamRequest[] } {
  const calls: UpstreamRequest[] = [];
  const client = {
    request: async (req: UpstreamRequest) => {
      calls.push(req);
      return respond(req);
    },
  } as unknown as UpstreamClient;
  return { client, calls };
}

function buildApp(
  respond: (request: UpstreamRequest) => Promise<UpstreamResponse> | UpstreamResponse,
  env: NodeJS.ProcessEnv = baseEnv()
) {
  const config: GatewayConfig = loadGatewayConfig(env);
  const upstream = fakeUpstream(respond);
  return { app: createApp({ config, logger: silentLogger, upstream: upstream.client }), upstream };
}

describe('healthchecks', () => {
  it('liveness responde 200 sem consultar dependencias', async () => {
    const { app, upstream } = buildApp(() => ({ statusCode: 200, body: {} }));
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    // Nenhuma chamada a servico interno: liveness nao verifica dependencia.
    expect(upstream.calls).toHaveLength(0);
  });

  it('readiness responde 200 quando o Servico de Pedidos responde', async () => {
    const { app } = buildApp(() => ({ statusCode: 200, body: { status: 'ok' } }));
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
  });

  it('readiness responde 503 quando o Servico de Pedidos esta fora do ar', async () => {
    const { app } = buildApp(() => {
      throw new ServiceUnavailableError('order-service indisponivel');
    });
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.dependencies[0].healthy).toBe(false);
  });

  it('expoe metricas no formato do Prometheus', async () => {
    const { app } = buildApp(() => ({ statusCode: 200, body: {} }));
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.text).toContain('http_requests_total');
  });
});

describe('correlacao', () => {
  it('gera um correlationId quando o cliente nao envia', async () => {
    const { app, upstream } = buildApp(() => ({ statusCode: 200, body: { data: [] } }));
    const response = await request(app).get('/api/orders');

    expect(response.headers['x-correlation-id']).toBeDefined();
    expect(upstream.calls[0]?.correlationId).toBe(response.headers['x-correlation-id']);
  });

  it('propaga um correlationId valido enviado pelo cliente', async () => {
    const { app, upstream } = buildApp(() => ({ statusCode: 200, body: { data: [] } }));
    const response = await request(app)
      .get('/api/orders')
      .set('x-correlation-id', 'pedido-campanha-001');

    expect(response.headers['x-correlation-id']).toBe('pedido-campanha-001');
    expect(upstream.calls[0]?.correlationId).toBe('pedido-campanha-001');
  });

  it('descarta correlationId com formato suspeito e gera um novo', async () => {
    const { app } = buildApp(() => ({ statusCode: 200, body: { data: [] } }));
    const response = await request(app)
      .get('/api/orders')
      .set('x-correlation-id', 'valor com espaco e <script>');

    expect(response.headers['x-correlation-id']).not.toContain('script');
  });
});

describe('encaminhamento de pedidos', () => {
  it('encaminha POST /api/orders preservando o status 201', async () => {
    const created = { id: '5b1f0f6c-2c9a-4f0f-9a6e-0b8f1c2d3e4f', status: 'PENDING' };
    const { app, upstream } = buildApp(() => ({ statusCode: 201, body: created }));

    const response = await request(app)
      .post('/api/orders')
      .send({ customerId: 'CUSTOMER-001', items: [{ sku: 'SKU-1', quantity: 1, unitPrice: 10 }] });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(created);
    expect(upstream.calls[0]?.method).toBe('POST');
    expect(upstream.calls[0]?.path).toBe('/orders');
    expect(upstream.calls[0]?.target).toBe('order-service');
  });

  it('repassa erro de validacao do servico interno sem reescrever', async () => {
    const body = { error: { code: 'VALIDATION_ERROR', message: 'Payload invalido' } };
    const { app } = buildApp(() => ({ statusCode: 400, body }));

    const response = await request(app).post('/api/orders').send({ customerId: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('repassa 404 de pedido inexistente', async () => {
    const { app } = buildApp(() => ({
      statusCode: 404,
      body: { error: { code: 'RESOURCE_NOT_FOUND', message: 'Pedido nao encontrado' } },
    }));

    const response = await request(app).get('/api/orders/00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
  });

  it('repassa parametros de paginacao', async () => {
    const { app, upstream } = buildApp(() => ({ statusCode: 200, body: { data: [] } }));
    await request(app).get('/api/orders?page=2&pageSize=5&status=CONFIRMED');

    expect(upstream.calls[0]?.query).toMatchObject({
      page: '2',
      pageSize: '5',
      status: 'CONFIRMED',
    });
  });
});

describe('tratamento de falhas de dependencia', () => {
  it('traduz timeout do servico interno em 504', async () => {
    const { app } = buildApp(() => {
      throw new UpstreamTimeoutError('order-service', 5000);
    });

    const response = await request(app).get('/api/orders');
    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe('UPSTREAM_TIMEOUT');
    expect(response.body.error.correlationId).toBeDefined();
  });

  it('traduz conexao recusada em 503', async () => {
    const { app } = buildApp(() => {
      throw new ServiceUnavailableError('Servico inventory-service indisponivel');
    });

    const response = await request(app).get('/api/inventory/SKU-1');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('nao vaza detalhes internos em erro inesperado', async () => {
    const { app } = buildApp(() => {
      throw new Error('ECONNREFUSED 10.0.0.5:5432 senha=segredo');
    });

    const response = await request(app).get('/api/payments/00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('segredo');
  });
});

describe('seguranca', () => {
  it('aplica cabecalhos de seguranca do Helmet', async () => {
    const { app } = buildApp(() => ({ statusCode: 200, body: {} }));
    const response = await request(app).get('/health/live');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('rejeita corpo acima do limite configurado', async () => {
    const { app } = buildApp(() => ({ statusCode: 201, body: {} }), baseEnv({ BODY_LIMIT: '1kb' }));

    const response = await request(app)
      .post('/api/orders')
      .send({ customerId: 'C1', filler: 'x'.repeat(4096) });

    expect(response.status).toBe(413);
  });

  it('aplica rate limit apos o limite configurado', async () => {
    const { app } = buildApp(
      () => ({ statusCode: 200, body: { data: [] } }),
      baseEnv({
        RATE_LIMIT_MAX: '3',
        RATE_LIMIT_WINDOW_MS: '60000',
      })
    );

    for (let i = 0; i < 3; i += 1) {
      const allowed = await request(app).get('/api/orders');
      expect(allowed.status).toBe(200);
    }

    const blocked = await request(app).get('/api/orders');
    expect(blocked.status).toBe(429);
  });

  it('nao aplica rate limit aos healthchecks', async () => {
    const { app } = buildApp(
      () => ({ statusCode: 200, body: {} }),
      baseEnv({ RATE_LIMIT_MAX: '1' })
    );

    for (let i = 0; i < 5; i += 1) {
      const response = await request(app).get('/health/live');
      expect(response.status).toBe(200);
    }
  });

  it('responde 404 padronizado para rota desconhecida', async () => {
    const { app } = buildApp(() => ({ statusCode: 200, body: {} }));
    const response = await request(app).get('/api/nao-existe');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
