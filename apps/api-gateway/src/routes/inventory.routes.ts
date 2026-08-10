import { Router, type Request, type Response, type NextFunction } from 'express';
import type { GatewayConfig } from '../config';
import type { UpstreamClient } from '../upstream';

/**
 * Consulta publica de estoque.
 *
 * O endpoint academico de reposicao (POST /inventory/restock) nao e exposto
 * pelo Gateway de proposito: ele existe apenas no Serviço de Estoque, dentro
 * da rede interna, protegido por chave de administracao.
 */
export function createInventoryRouter(config: GatewayConfig, upstream: UpstreamClient): Router {
  const router = Router();

  router.get('/:sku', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await upstream.request({
        target: 'inventory-service',
        baseUrl: config.INVENTORY_SERVICE_URL,
        path: `/inventory/${encodeURIComponent(req.params.sku ?? '')}`,
        method: 'GET',
        correlationId: res.locals.correlationId as string,
      });
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
