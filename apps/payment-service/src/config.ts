import { z } from 'zod';
import {
  baseConfigSchema,
  booleanFromEnv,
  databaseConfigSchema,
  loadConfig,
  messagingConfigSchema,
} from '@loja-veloz/shared-config';

const paymentConfigSchema = baseConfigSchema
  .merge(databaseConfigSchema)
  .merge(messagingConfigSchema)
  .extend({
    SERVICE_NAME: z.string().default('payment-service'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3003),
    BODY_LIMIT: z.string().default('100kb'),

    /**
     * Recurso academico de demonstracao.
     *
     * Com PAYMENT_SIMULATION_ENABLED=true, pedidos do cliente indicado em
     * PAYMENT_FAIL_CUSTOMER_ID sao SEMPRE recusados. A regra e deterministica
     * de proposito: usar aleatoriedade tornaria os testes instaveis e a
     * demonstracao irreprodutivel.
     *
     * Isto NAO representa comportamento de producao. Com a chave em false, o
     * simulador aprova todos os pagamentos.
     */
    PAYMENT_SIMULATION_ENABLED: booleanFromEnv.default('false'),
    PAYMENT_FAIL_CUSTOMER_ID: z.string().min(1).default('CUSTOMER-PAYMENT-FAIL'),
    /** Latencia artificial para tornar o trace legivel na demonstracao. */
    PAYMENT_PROCESSING_DELAY_MS: z.coerce.number().int().min(0).max(5000).default(0),
  });

export type PaymentServiceConfig = z.infer<typeof paymentConfigSchema>;

export function loadPaymentServiceConfig(
  env: NodeJS.ProcessEnv = process.env
): PaymentServiceConfig {
  return loadConfig(paymentConfigSchema, env, 'payment-service');
}
