import { Router, type Request, type Response, type NextFunction } from 'express';
import type { GatewayConfig } from '../config';
import type { UpstreamClient } from '../upstream';

/**
 * Rotas de pedido do Gateway.
 *
 * O Gateway nao acessa banco e nao reimplementa regra de negocio: ele valida
 * o basico, encaminha e repassa a resposta do Serviço de Pedidos preservando
 * o status HTTP. A validacao completa do payload e feita no servico dono do
 * dominio, que e a unica fonte de verdade sobre o formato de um pedido.
 */
export function createOrdersRouter(config: GatewayConfig, upstream: UpstreamClient): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await upstream.request({
        target: 'order-service',
        baseUrl: config.ORDER_SERVICE_URL,
        path: '/orders',
        method: 'POST',
        correlationId: res.locals.correlationId as string,
        body: req.body,
      });
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await upstream.request({
        target: 'order-service',
        baseUrl: config.ORDER_SERVICE_URL,
        path: '/orders',
        method: 'GET',
        correlationId: res.locals.correlationId as string,
        query: {
          page: typeof req.query.page === 'string' ? req.query.page : undefined,
          pageSize: typeof req.query.pageSize === 'string' ? req.query.pageSize : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
        },
      });
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await upstream.request({
        target: 'order-service',
        baseUrl: config.ORDER_SERVICE_URL,
        path: `/orders/${encodeURIComponent(req.params.id ?? '')}`,
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
