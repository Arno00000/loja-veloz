// ATENCAO: `./instrumentation` precisa ser o primeiro import deste arquivo.
// Ele carrega a configuracao e inicia o OpenTelemetry antes que o Express
// seja carregado pelos imports seguintes.
import { config } from './instrumentation';
import {
  closeHttpServer,
  createLogger,
  initMetrics,
  registerGracefulShutdown,
  shutdownTracing,
} from '@loja-veloz/observability';
import { createApp } from './app';

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

const app = createApp({ config, logger });

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      environment: config.ENVIRONMENT,
      orderService: config.ORDER_SERVICE_URL,
      inventoryService: config.INVENTORY_SERVICE_URL,
      paymentService: config.PAYMENT_SERVICE_URL,
    },
    'API Gateway iniciado'
  );
});

// keepAliveTimeout maior que o do proxy a frente evita a corrida em que o
// proxy reaproveita uma conexao que o Node acabou de fechar, o que aparece
// como 502 esporadico atras do Ingress.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

registerGracefulShutdown({
  logger,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  steps: [
    {
      name: 'http-server',
      run: () => closeHttpServer(server, Math.max(config.SHUTDOWN_TIMEOUT_MS - 2000, 1000)),
    },
    { name: 'tracing', run: shutdownTracing },
  ],
});
