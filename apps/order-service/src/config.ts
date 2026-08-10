import { z } from 'zod';
import {
  baseConfigSchema,
  databaseConfigSchema,
  loadConfig,
  messagingConfigSchema,
} from '@loja-veloz/shared-config';

const orderConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(messagingConfigSchema)
  .extend({
    SERVICE_NAME: z.string().default('order-service'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    BODY_LIMIT: z.string().default('100kb'),
  });

export type OrderServiceConfig = z.infer<typeof orderConfigSchema>;

export function loadOrderServiceConfig(env: NodeJS.ProcessEnv = process.env): OrderServiceConfig {
  return loadConfig(orderConfigSchema, env, 'order-service');
}
