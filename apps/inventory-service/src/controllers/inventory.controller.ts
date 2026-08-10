import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError, NotFoundError } from '@loja-veloz/observability';
import type { InventoryService } from '../services/inventory.service';
import { restockSchema, skuParamSchema } from '../schemas/inventory.schema';
import type { InventoryServiceConfig } from '../config';

export class InventoryController {
  constructor(
    private readonly service: InventoryService,
    private readonly config: InventoryServiceConfig
  ) {}

  getBySku = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sku } = skuParamSchema.parse(req.params);
      const item = await this.service.getBySku(sku);

      res.status(200).json({
        sku: item.sku,
        description: item.description,
        availableQuantity: item.availableQuantity,
        reservedQuantity: item.reservedQuantity,
        updatedAt: item.updatedAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Endpoint academico de reposicao.
   *
   * Protegido por chave estatica e desligado por padrao. Isso NAO e um modelo
   * de autenticacao adequado a producao: nao ha rotacao, nao ha identidade e
   * a chave viaja em todo request. Em producao a reposicao viria de um
   * processo de compras, e a autenticacao seria OAuth 2.0 / OIDC.
   * Ver docs/threat-model.md.
   */
  restock = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.config.INVENTORY_RESTOCK_ENABLED) {
        throw new NotFoundError('Rota', 'POST /inventory/restock');
      }

      const providedKey = req.header('x-admin-key');
      if (!providedKey || providedKey !== this.config.INVENTORY_ADMIN_KEY) {
        throw new UnauthorizedError('Chave de administracao ausente ou invalida');
      }

      const input = restockSchema.parse(req.body);
      const item = await this.service.restock(input.sku, input.quantity, input.description);

      res.status(200).json({
        sku: item.sku,
        availableQuantity: item.availableQuantity,
        reservedQuantity: item.reservedQuantity,
      });
    } catch (error) {
      next(error);
    }
  };
}
