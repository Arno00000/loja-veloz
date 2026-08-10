/**
 * Bootstrap de telemetria.
 *
 * Este modulo deve ser o PRIMEIRO import de `server.ts`. A avaliacao de
 * modulos em JavaScript segue a ordem das declaracoes de import, entao tudo
 * que esta aqui roda antes de `express` e `http` serem carregados, que e o
 * requisito das auto-instrumentacoes do OpenTelemetry.
 *
 * O import aponta para o ponto de entrada `/tracing` justamente para nao
 * carregar o indice do pacote de observabilidade, que arrastaria o Express.
 */
import { initTracing } from '@loja-veloz/observability/tracing';
import { loadGatewayConfig } from './config';

export const config = loadGatewayConfig();

initTracing({
  serviceName: config.SERVICE_NAME,
  serviceVersion: config.SERVICE_VERSION,
  environment: config.ENVIRONMENT,
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  enabled: config.OTEL_TRACES_ENABLED,
  samplingRatio: config.OTEL_SAMPLING_RATIO,
});
