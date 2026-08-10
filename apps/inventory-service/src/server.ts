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
import { PrismaInventoryRepository } from './repositories/inventory.repository';
import { PrismaIdempotencyStore } from './repositories/processed-event.repository';
import { InventoryEventPublisher } from './messaging/publishers';
import { InventoryService } from './services/inventory.service';
import { registerInventoryConsumers } from './messaging/consumers';

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

if (config.INVENTORY_RESTOCK_ENABLED) {
  logger.warn(
    'POST /inventory/restock esta habilitado. Recurso academico: desabilite em producao.'
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

const repository = new PrismaInventoryRepository(prisma);
const idempotencyStore = new PrismaIdempotencyStore(prisma);
const publisher = new InventoryEventPublisher(
  new EventPublisher({ client: rabbit, producer: config.SERVICE_NAME, logger })
);
const service = new InventoryService({ repository, publisher, logger });

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

  await registerInventoryConsumers({
    client: rabbit,
    service,
    logger,
    maxRetries: config.RABBITMQ_MAX_RETRIES,
    idempotencyStore,
  });

  const server = app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, environment: config.ENVIRONMENT },
      'Servico de Estoque iniciado'
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
    'Falha na inicializacao do Servico de Estoque'
  );
  process.exit(1);
});
