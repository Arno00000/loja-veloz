import { Router } from 'express';
import type { OrderController } from '../controllers/order.controller';

export function createOrderRoutes(controller: OrderController): Router {
  const router = Router();

  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);

  return router;
}
