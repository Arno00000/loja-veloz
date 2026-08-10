import { Router, type Request, type Response, type NextFunction } from 'express';
import type { GatewayConfig } from '../config';
import type { UpstreamClient } from '../upstream';

export function createPaymentsRouter(config: GatewayConfig, upstream: UpstreamClient): Router {
  const router = Router();

  router.get('/:orderId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await upstream.request({
        target: 'payment-service',
        baseUrl: config.PAYMENT_SERVICE_URL,
        path: `/payments/${encodeURIComponent(req.params.orderId ?? '')}`,
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
