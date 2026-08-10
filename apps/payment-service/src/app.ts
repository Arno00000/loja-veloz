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
import type { PaymentServiceConfig } from './config';
import type { PaymentService } from './services/payment.service';
import { PaymentController } from './controllers/payment.controller';
import { createPaymentRoutes } from './routes/payment.routes';

export interface CreateAppOptions {
  config: PaymentServiceConfig;
  logger: Logger;
  service: PaymentService;
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
  app.use('/payments', createPaymentRoutes(new PaymentController(service)));

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
