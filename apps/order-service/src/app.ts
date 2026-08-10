import express, { type Express } from 'express';
import helmet from 'helmet';
import {
  correlationMiddleware,
  createHealthRouter,
  errorHandler,
  httpLoggerMiddleware,
  httpMetricsMiddleware,
  notFoundHandler,
  type DependencyCheck,
  type Logger,
} from '@loja-veloz/observability';
import type { OrderServiceConfig } from './config';
import type { OrderService } from './services/order.service';
import { OrderController } from './controllers/order.controller';
import { createOrderRoutes } from './routes/order.routes';

export interface CreateAppOptions {
  config: OrderServiceConfig;
  logger: Logger;
  service: OrderService;
  dependencies: DependencyCheck[];
}

/**
 * Aplicacao HTTP do Servico de Pedidos.
 *
 * Nao expoe CORS nem rate limit: este servico so recebe trafego da rede
 * interna, atras do Gateway, e a NetworkPolicy do Kubernetes garante isso.
 * Duplicar essas protecoes aqui daria uma falsa sensacao de defesa em
 * profundidade sem acrescentar barreira real.
 */
export function createApp(options: CreateAppOptions): Express {
  const { config, logger, service, dependencies } = options;
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(correlationMiddleware());
  app.use(httpLoggerMiddleware(logger));
  app.use(httpMetricsMiddleware());

  app.use(
    createHealthRouter({
      serviceName: config.SERVICE_NAME,
      serviceVersion: config.SERVICE_VERSION,
      dependencies,
    })
  );

  app.use(express.json({ limit: config.BODY_LIMIT }));

  app.use('/orders', createOrderRoutes(new OrderController(service)));

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
