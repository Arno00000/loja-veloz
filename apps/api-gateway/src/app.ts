import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import {
  correlationMiddleware,
  createHealthRouter,
  errorHandler,
  httpLoggerMiddleware,
  httpMetricsMiddleware,
  notFoundHandler,
  ValidationError,
  type Logger,
} from '@loja-veloz/observability';
import type { GatewayConfig } from './config';
import { UpstreamClient } from './upstream';
import { createOrdersRouter } from './routes/orders.routes';
import { createInventoryRouter } from './routes/inventory.routes';
import { createPaymentsRouter } from './routes/payments.routes';

export interface CreateAppOptions {
  config: GatewayConfig;
  logger: Logger;
  upstream?: UpstreamClient;
}

/**
 * Monta a aplicacao Express do Gateway.
 *
 * A funcao devolve o app sem escutar porta, o que permite testar a cadeia
 * completa de middlewares com supertest sem abrir socket.
 *
 * Ordem dos middlewares (importa):
 *   1. trust proxy      - IP real atras do Ingress, necessario ao rate limit
 *   2. helmet           - cabecalhos de seguranca antes de qualquer resposta
 *   3. cors             - rejeita origem nao permitida cedo
 *   4. correlacao       - todo log e resposta seguinte ja tem correlationId
 *   5. logger e metricas
 *   6. healthchecks     - antes do rate limit, para nao bloquear probes
 *   7. body parser      - com limite de tamanho
 *   8. rate limit       - so nas rotas de negocio
 *   9. rotas
 *  10. 404 e handler de erro
 */
export function createApp(options: CreateAppOptions): Express {
  const { config, logger } = options;
  const upstream =
    options.upstream ??
    new UpstreamClient({ timeoutMs: config.UPSTREAM_TIMEOUT_MS, logger });

  const app = express();

  // Necessario para que o rate limit enxergue o IP de origem real quando o
  // trafego chega pelo Ingress. Valor 1 confia apenas no proxy imediato.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) => {
        // Requisicoes sem Origin (curl, health check, server-to-server) passam.
        if (!origin || config.CORS_ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new ValidationError(`Origem nao permitida: ${origin}`));
      },
      methods: ['GET', 'POST'],
      allowedHeaders: ['content-type', 'accept', 'x-correlation-id', 'traceparent', 'tracestate'],
      exposedHeaders: ['x-correlation-id'],
      maxAge: 600,
    })
  );

  app.use(correlationMiddleware());
  app.use(httpLoggerMiddleware(logger));
  app.use(httpMetricsMiddleware());

  app.use(
    createHealthRouter({
      serviceName: config.SERVICE_NAME,
      serviceVersion: config.SERVICE_VERSION,
      // O Gateway nao tem banco nem fila. O readiness verifica apenas se o
      // Serviço de Pedidos responde, porque sem ele nenhuma rota util funciona.
      dependencies: [
        {
          name: 'order-service',
          critical: true,
          check: async () => {
            try {
              const result = await upstream.request({
                target: 'order-service',
                baseUrl: config.ORDER_SERVICE_URL,
                path: '/health/live',
                method: 'GET',
                correlationId: 'readiness-probe',
              });
              return result.statusCode === 200;
            } catch {
              return false;
            }
          },
        },
      ],
    })
  );

  app.use(express.json({ limit: config.BODY_LIMIT }));

  const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Limite de requisicoes excedido, tente novamente em instantes',
      },
    },
  });

  app.use('/api', limiter);
  app.use('/api/orders', createOrdersRouter(config, upstream));
  app.use('/api/inventory', createInventoryRouter(config, upstream));
  app.use('/api/payments', createPaymentsRouter(config, upstream));

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
