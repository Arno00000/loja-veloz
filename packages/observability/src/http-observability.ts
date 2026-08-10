import type { NextFunction, Request, Response } from 'express';
import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import { httpErrorsTotal, httpRequestDurationSeconds, httpRequestsTotal } from './metrics';

/**
 * Normaliza a rota para uso como label do Prometheus.
 *
 * Sem esta normalizacao, `/orders/<uuid>` geraria uma serie temporal por
 * pedido criado. Usamos o padrao registrado no roteador (`/orders/:id`) e,
 * quando ele nao existe (404), agrupamos em `unmatched`.
 */
export function normalizeRoute(req: Request): string {
  const baseUrl = req.baseUrl ?? '';
  const routePath = req.route?.path;

  if (typeof routePath === 'string' && routePath.length > 0) {
    const full = `${baseUrl}${routePath === '/' ? '' : routePath}`;
    return full.length > 0 ? full : '/';
  }

  return 'unmatched';
}

function statusClass(statusCode: number): string {
  return `${Math.floor(statusCode / 100)}xx`;
}

/**
 * Middleware de metricas HTTP. Registrado antes das rotas; a coleta acontece
 * no evento `finish` da resposta, quando `req.route` ja esta preenchido.
 */
export function httpMetricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const endTimer = httpRequestDurationSeconds.startTimer();

    res.on('finish', () => {
      const labels = {
        method: req.method,
        route: normalizeRoute(req),
        status_code: String(res.statusCode),
      };

      endTimer(labels);
      httpRequestsTotal.inc(labels);

      if (res.statusCode >= 400) {
        httpErrorsTotal.inc({
          method: req.method,
          route: labels.route,
          status_class: statusClass(res.statusCode),
        });
      }
    });

    next();
  };
}

/**
 * Middleware de log de requisicao. Endpoints de infraestrutura sao silenciados
 * para nao inundar o Loki com ruido de probes e scraping do Prometheus.
 */
export function httpLoggerMiddleware(logger: Logger) {
  return pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => {
        const url = req.url ?? '';
        return url.startsWith('/health') || url === '/metrics';
      },
    },
    customProps: (_req, res) => ({
      correlationId: (res as unknown as { locals?: Record<string, unknown> }).locals?.correlationId,
    }),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) {
        return 'error';
      }
      if (res.statusCode >= 400) {
        return 'warn';
      }
      return 'info';
    },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}
