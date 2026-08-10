import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
  type Metric,
} from 'prom-client';
import type { Request, Response } from 'express';

/**
 * Registry proprio por processo, em vez do registry global.
 * Isso torna os testes deterministicos: cada suite pode criar e descartar
 * o seu registry sem colisao de metricas ja registradas.
 */
export const registry = new Registry();

let defaultMetricsStarted = false;

export interface MetricsInitOptions {
  serviceName: string;
  serviceVersion: string;
  environment: string;
}

/**
 * Rotulos aplicados a todas as metricas do processo.
 *
 * Regra de cardinalidade: apenas dimensoes de baixa cardinalidade viram label.
 * Identificadores como orderId, customerId e eventId NUNCA sao labels, pois
 * cresceriam sem limite e derrubariam o Prometheus. Essas informacoes vivem
 * em logs e traces, que suportam alta cardinalidade.
 */
export function initMetrics(options: MetricsInitOptions): Registry {
  registry.setDefaultLabels({
    service: options.serviceName,
    version: options.serviceVersion,
    environment: options.environment,
  });

  if (!defaultMetricsStarted) {
    collectDefaultMetrics({ register: registry });
    defaultMetricsStarted = true;
  }

  return registry;
}

/**
 * Buckets em segundos, escolhidos para APIs HTTP internas: a maior parte das
 * respostas fica abaixo de 250 ms e o interesse esta nas caudas.
 */
export const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total de requisicoes HTTP recebidas',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duracao das requisicoes HTTP em segundos',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: HTTP_DURATION_BUCKETS,
  registers: [registry],
});

export const httpErrorsTotal = new Counter({
  name: 'http_errors_total',
  help: 'Total de respostas HTTP com status 4xx ou 5xx',
  labelNames: ['method', 'route', 'status_class'] as const,
  registers: [registry],
});

export const dependencyUpGauge = new Gauge({
  name: 'dependency_up',
  help: 'Estado da dependencia externa observado no ultimo readiness (1 disponivel, 0 indisponivel)',
  labelNames: ['dependency'] as const,
  registers: [registry],
});

/** Helper para contadores de dominio, sempre no registry do processo. */
export function createCounter<T extends string>(config: {
  name: string;
  help: string;
  labelNames?: readonly T[];
}): Counter<T> {
  return new Counter({
    name: config.name,
    help: config.help,
    labelNames: (config.labelNames ?? []) as T[],
    registers: [registry],
  });
}

export function createHistogram<T extends string>(config: {
  name: string;
  help: string;
  labelNames?: readonly T[];
  buckets?: number[];
}): Histogram<T> {
  return new Histogram({
    name: config.name,
    help: config.help,
    labelNames: (config.labelNames ?? []) as T[],
    buckets: config.buckets ?? HTTP_DURATION_BUCKETS,
    registers: [registry],
  });
}

export function createGauge<T extends string>(config: {
  name: string;
  help: string;
  labelNames?: readonly T[];
}): Gauge<T> {
  return new Gauge({
    name: config.name,
    help: config.help,
    labelNames: (config.labelNames ?? []) as T[],
    registers: [registry],
  });
}

export type AnyMetric = Metric<string>;

/** Handler do endpoint GET /metrics, no formato de exposicao do Prometheus. */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}
