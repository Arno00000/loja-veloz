// Primeiro import de server.ts. Ver packages/observability/tracing.js.
import { initTracing } from '@loja-veloz/observability/tracing';
import { loadPaymentServiceConfig } from './config';

export const config = loadPaymentServiceConfig();

initTracing({
  serviceName: config.SERVICE_NAME,
  serviceVersion: config.SERVICE_VERSION,
  environment: config.ENVIRONMENT,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_TRACES_ENABLED,
  samplingRatio: config.OTEL_SAMPLING_RATIO,
});
