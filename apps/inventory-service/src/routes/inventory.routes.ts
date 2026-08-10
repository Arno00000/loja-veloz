import { Router } from 'express';
import type { InventoryController } from '../controllers/inventory.controller';

export function createInventoryRoutes(controller: InventoryController): Router {
  const router = Router();

  // A rota de reposicao vem antes de /:sku para que "restock" nao seja
  // interpretado como um SKU.
  router.post('/restock', controller.restock);
  router.get('/:sku', controller.getBySku);

  return router;
}
