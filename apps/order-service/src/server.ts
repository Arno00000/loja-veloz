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
import { PrismaOrderRepository } from './repositories/order.repository';
import { PrismaIdempotencyStore } from './repositories/processed-event.repository';
import { OrderEventPublisher } from './messaging/publishers';
import { OrderService } from './services/order.service';
import { registerOrderConsumers } from './messaging/consumers';

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

const repository = new PrismaOrderRepository(prisma);
const idempotencyStore = new PrismaIdempotencyStore(prisma);
const publisher = new OrderEventPublisher(
  new EventPublisher({ client: rabbit, producer: config.SERVICE_NAME, logger })
);
const service = new OrderService({ repository, publisher, logger });

const app = createApp({
  config,
  logger,
  service,
  // O readiness verifica banco e broker porque, sem qualquer um dos dois, o
  // servico nao consegue criar pedidos nem reagir a eventos. O liveness,
  // por decisao explicita, nao verifica nada disso.
  dependencies: [
    { name: 'postgres', critical: true, check: () => checkDatabase(prisma) },
    { name: 'rabbitmq', critical: true, check: () => rabbit.healthCheck() },
  ],
});

async function bootstrap(): Promise<void> {
  // A conexao com o broker nao bloqueia a subida do processo: se o RabbitMQ
  // ainda nao estiver pronto, o cliente reconecta sozinho com backoff e o
  // readiness segura o trafego ate la.
  await rabbit.connect();

  await registerOrderConsumers({
    client: rabbit,
    service,
    logger,
    maxRetries: config.RABBITMQ_MAX_RETRIES,
    idempotencyStore,
  });

  const server = app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, environment: config.ENVIRONMENT },
      'Servico de Pedidos iniciado'
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
    'Falha na inicializacao do Servico de Pedidos'
  );
  process.exit(1);
});
