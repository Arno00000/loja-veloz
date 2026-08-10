// ATENCAO: `./instrumentation` precisa ser o primeiro import deste arquivo.
import { config } from './instrumentation';
import {
  closeHttpServer,
  createLogger,
  initMetrics,
  registerGracefulShutdown,
  shutdownTracing,
} from '@loja-veloz/observability';
import { EventPublisher, RabbitMQClient } from '@loja-veloz/messaging';
import { createApp } from './app';
import { checkDatabase, disconnectPrisma, getPrismaClient } from './db/prisma';
import { PrismaPaymentRepository } from './repositories/payment.repository';
import { PrismaIdempotencyStore } from './repositories/processed-event.repository';
import { PaymentGatewaySimulator } from './services/payment-gateway.simulator';
import { PaymentEventPublisher } from './messaging/publishers';
import { PaymentService } from './services/payment.service';
import { registerPaymentConsumers } from './messaging/consumers';

const logger = createLogger({
  serviceName: config.SERVICE_NAME,
  serviceVersion: config.SERVICE_VERSION,
  environment: config.ENVIRONMENT,
  level: config.LOG_LEVEL,
  pretty: config.NODE_ENV === 'development',
});

initMetrics({
  serviceName: config.SERVICE_NAME,
  serviceVersion: config.SERVICE_VERSION,
  environment: config.ENVIRONMENT,
});

if (config.PAYMENT_SIMULATION_ENABLED) {
  logger.warn(
    { failCustomerId: config.PAYMENT_FAIL_CUSTOMER_ID },
    'Simulacao de recusa habilitada. Recurso academico: desabilite em producao.'
  );
}

const prisma = getPrismaClient(config.DATABASE_URL);

const rabbit = new RabbitMQClient({
  url: config.RABBITMQ_URL,
  serviceName: config.SERVICE_NAME,
  logger,
  prefetch: config.RABBITMQ_PREFETCH,
  retryDelayMs: config.RABBITMQ_RETRY_DELAY_MS,
  reconnectMinMs: config.RABBITMQ_RECONNECT_MIN_MS,
  reconnectMaxMs: config.RABBITMQ_RECONNECT_MAX_MS,
});

const repository = new PrismaPaymentRepository(prisma);
const idempotencyStore = new PrismaIdempotencyStore(prisma);
const simulator = new PaymentGatewaySimulator({
  simulationEnabled: config.PAYMENT_SIMULATION_ENABLED,
  failCustomerId: config.PAYMENT_FAIL_CUSTOMER_ID,
  processingDelayMs: config.PAYMENT_PROCESSING_DELAY_MS,
});
const publisher = new PaymentEventPublisher(
  new EventPublisher({ client: rabbit, producer: config.SERVICE_NAME, logger })
);
const service = new PaymentService({ repository, simulator, publisher, logger });

const app = createApp({
  config,
  logger,
  service,
  dependencies: [
    { name: 'postgres', critical: true, check: () => checkDatabase(prisma) },
    { name: 'rabbitmq', critical: true, check: () => rabbit.healthCheck() },
  ],
});

async function bootstrap(): Promise<void> {
  await rabbit.connect();

  await registerPaymentConsumers({
    client: rabbit,
    service,
    logger,
    maxRetries: config.RABBITMQ_MAX_RETRIES,
    idempotencyStore,
  });

  const server = app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, environment: config.ENVIRONMENT },
      'Servico de Pagamentos iniciado'
    );
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  registerGracefulShutdown({
    logger,
    timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
    steps: [
      {
        name: 'http-server',
        run: () => closeHttpServer(server, Math.max(config.SHUTDOWN_TIMEOUT_MS - 5000, 1000)),
      },
      { name: 'rabbitmq-consumers', run: () => rabbit.stopConsuming() },
      { name: 'rabbitmq-connection', run: () => rabbit.close() },
      { name: 'prisma', run: disconnectPrisma },
      { name: 'tracing', run: shutdownTracing },
    ],
  });
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    { err: error instanceof Error ? error : new Error(String(error)) },
    'Falha na inicializacao do Servico de Pagamentos'
  );
  process.exit(1);
});
