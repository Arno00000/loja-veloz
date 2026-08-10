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
import type { InventoryServiceConfig } from './config';
import type { InventoryService } from './services/inventory.service';
import { InventoryController } from './controllers/inventory.controller';
import { createInventoryRoutes } from './routes/inventory.routes';

export interface CreateAppOptions {
  config: InventoryServiceConfig;
  logger: Logger;
  service: InventoryService;
  dependencies: DependencyCheck[];
}

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
  app.use('/inventory', createInventoryRoutes(new InventoryController(service, config)));

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
