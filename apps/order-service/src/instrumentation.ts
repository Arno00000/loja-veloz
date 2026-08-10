// Primeiro import de server.ts. Ver comentario em
// packages/observability/tracing.js para o motivo do ponto de entrada
// dedicado: carregar o indice do pacote arrastaria o Express antes da
// instrumentacao estar ativa.
import { initTracing } from '@loja-veloz/observability/tracing';
import { loadOrderServiceConfig } from './config';

export const config = loadOrderServiceConfig();

initTracing({
  serviceName: config.SERVICE_NAME,
  serviceVersion: config.SERVICE_VERSION,
  environment: config.ENVIRONMENT,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_TRACES_ENABLED,
  samplingRatio: config.OTEL_SAMPLING_RATIO,
});
