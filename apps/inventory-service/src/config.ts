import { z } from 'zod';
import {
  baseConfigSchema,
  booleanFromEnv,
  databaseConfigSchema,
  loadConfig,
  messagingConfigSchema,
} from '@loja-veloz/shared-config';

const inventoryConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(messagingConfigSchema)
  .extend({
    SERVICE_NAME: z.string().default('inventory-service'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    BODY_LIMIT: z.string().default('100kb'),

    // Endpoint academico de reposicao de estoque. Deve ser desligado em
    // producao: em um sistema real, reposicao vem de um processo de compras,
    // nao de uma chamada HTTP protegida por chave estatica.
    INVENTORY_RESTOCK_ENABLED: booleanFromEnv.default('false'),
    INVENTORY_ADMIN_KEY: z.string().min(8).optional(),
  })
  .refine(
    (config) => !config.INVENTORY_RESTOCK_ENABLED || Boolean(config.INVENTORY_ADMIN_KEY),
    {
      message:
        'INVENTORY_ADMIN_KEY e obrigatorio quando INVENTORY_RESTOCK_ENABLED=true',
      path: ['INVENTORY_ADMIN_KEY'],
    }
  );

export type InventoryServiceConfig = z.infer<typeof inventoryConfigSchema>;

export function loadInventoryServiceConfig(
  env: NodeJS.ProcessEnv = process.env
): InventoryServiceConfig {
  return loadConfig(inventoryConfigSchema, env, 'inventory-service');
}
