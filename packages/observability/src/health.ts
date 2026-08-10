import { Router, type Request, type Response } from 'express';
import { dependencyUpGauge, metricsHandler } from './metrics';

export interface DependencyCheck {
  /** Nome curto e estavel, usado como label de baixa cardinalidade. */
  name: string;
  /** Deve resolver rapidamente; use timeout interno na implementacao. */
  check: () => Promise<boolean>;
  /**
   * Quando false, a falha e reportada mas nao derruba o readiness.
   * Util para dependencias opcionais em determinado servico.
   */
  critical?: boolean;
}

export interface HealthRouterOptions {
  serviceName: string;
  serviceVersion: string;
  dependencies: DependencyCheck[];
  /** Tempo maximo total para avaliar as dependencias no readiness. */
  readinessTimeoutMs?: number;
}

async function withTimeout(promise: Promise<boolean>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Router com os tres endpoints de infraestrutura de todos os servicos.
 *
 * Semantica das probes (ver docs/architecture.md):
 *
 * - GET /health/live  -> LIVENESS. Responde 200 se o processo esta vivo e o
 *   event loop responde. NAO consulta banco, RabbitMQ nem servicos externos.
 *   Verificar dependencias no liveness causaria reinicializacao em cascata:
 *   uma indisponibilidade momentanea do banco mataria todos os pods de todos
 *   os servicos ao mesmo tempo.
 *
 * - GET /health/ready -> READINESS. Consulta as dependencias essenciais e
 *   responde 503 quando o servico nao pode atender trafego. O Kubernetes
 *   remove o pod dos endpoints do Service sem reinicia-lo.
 *
 * - GET /metrics      -> exposicao Prometheus.
 */
export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 2000;
  const startedAt = Date.now();

  router.get('/health/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: options.serviceName,
      version: options.serviceVersion,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  router.get('/health/ready', async (_req: Request, res: Response) => {
    const results = await Promise.all(
      options.dependencies.map(async (dependency) => {
        let healthy = false;
        try {
          healthy = await withTimeout(dependency.check(), readinessTimeoutMs);
        } catch {
          healthy = false;
        }
        dependencyUpGauge.set({ dependency: dependency.name }, healthy ? 1 : 0);
        return {
          name: dependency.name,
          healthy,
          critical: dependency.critical ?? true,
        };
      })
    );

    const ready = results.every((result) => result.healthy || !result.critical);

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: options.serviceName,
      version: options.serviceVersion,
      dependencies: results,
    });
  });

  router.get('/metrics', metricsHandler);

  return router;
}
