import { z } from 'zod';
import { baseConfigSchema, loadConfig } from '@loja-veloz/shared-config';

const gatewayConfigSchema = baseConfigSchema.extend({
  SERVICE_NAME: z.string().default('api-gateway'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  ORDER_SERVICE_URL: z.string().url(),
  INVENTORY_SERVICE_URL: z.string().url(),
  PAYMENT_SERVICE_URL: z.string().url(),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).default(5000),

  // Lista separada por virgula. Origens nao listadas sao rejeitadas.
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    ),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  BODY_LIMIT: z.string().default('100kb'),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return loadConfig(gatewayConfigSchema, env, 'api-gateway');
}
