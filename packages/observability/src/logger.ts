import pino, { type Logger, type LoggerOptions } from 'pino';
import { trace, context } from '@opentelemetry/api';

export type { Logger };

export interface LoggerFactoryOptions {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  level: string;
  /** Em desenvolvimento local, `pretty` deixa o log legivel no terminal. */
  pretty?: boolean;
}

/**
 * Campos sensiveis removidos automaticamente de qualquer log.
 * A lista cobre os caminhos mais comuns em requisicoes HTTP e configuracao.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-admin-key"]',
  'req.body.password',
  'req.body.token',
  'password',
  'senha',
  'secret',
  'token',
  'authorization',
  'DATABASE_URL',
  'RABBITMQ_URL',
  'INVENTORY_ADMIN_KEY',
];

/**
 * Cria o logger raiz do processo.
 *
 * Logs sao emitidos como JSON em stdout (12-Factor, fator XI: logs como
 * fluxo de eventos). Nenhum servico escreve arquivos de log: a coleta e
 * responsabilidade do Grafana Alloy no ambiente local e do agente de
 * coleta no Kubernetes.
 *
 * `traceId` e `spanId` sao anexados automaticamente quando ha um span ativo,
 * o que permite pular de um log no Loki para o trace correspondente no Jaeger.
 */
export function createLogger(options: LoggerFactoryOptions): Logger {
  const config: LoggerOptions = {
    level: options.level,
    base: {
      service: options.serviceName,
      version: options.serviceVersion,
      environment: options.environment,
      pid: process.pid,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: REDACT_PATHS,
      censor: '***',
      remove: false,
    },
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) {
        return {};
      }
      const spanContext = span.spanContext();
      return { traceId: spanContext.traceId, spanId: spanContext.spanId };
    },
  };

  if (options.pretty) {
    return pino({
      ...config,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(config);
}

/**
 * Retorna traceId e spanId do span ativo, se houver.
 * Usado por consumidores de mensagem, que nao passam pelo middleware HTTP.
 */
export function currentTraceFields(): { traceId?: string; spanId?: string } {
  const span = trace.getSpan(context.active());
  if (!span) {
    return {};
  }
  const spanContext = span.spanContext();
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}
