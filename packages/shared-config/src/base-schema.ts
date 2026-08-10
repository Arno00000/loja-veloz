import { z } from 'zod';

/**
 * Conversao de string de ambiente para booleano.
 * Variaveis de ambiente sao sempre texto; aceitar apenas "true"/"false"
 * evita a ambiguidade de valores como "0" ou "no".
 */
export const booleanFromEnv = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((value) => value === true || value === 'true');

export const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

export const nodeEnvSchema = z.enum(['development', 'test', 'production']);

/**
 * Configuracao comum a todos os processos.
 *
 * Principio adotado (12-Factor, fator III): a configuracao vive no ambiente,
 * nunca no codigo. Este schema e a unica fronteira de leitura de `process.env`
 * nas aplicacoes; nenhum modulo de dominio le variaveis diretamente.
 */
export const baseConfigSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  ENVIRONMENT: z.string().min(1).default('development'),
  SERVICE_NAME: z.string().min(1),
  SERVICE_VERSION: z.string().min(1).default('1.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: logLevelSchema.default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  // Observabilidade
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default('http://otel-collector:4318'),
  OTEL_TRACES_ENABLED: booleanFromEnv.default('true'),
  OTEL_SAMPLING_RATIO: z.coerce.number().min(0).max(1).default(1),
});

export type BaseConfig = z.infer<typeof baseConfigSchema>;

/** Schema de configuracao de acesso ao PostgreSQL via Prisma. */
export const databaseConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).startsWith('postgresql://'),
});

/** Schema de configuracao de acesso ao RabbitMQ. */
export const messagingConfigSchema = z.object({
  RABBITMQ_URL: z.string().min(1).startsWith('amqp'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().max(1000).default(10),
  RABBITMQ_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(3),
  RABBITMQ_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5000),
  RABBITMQ_RECONNECT_MIN_MS: z.coerce.number().int().positive().default(1000),
  RABBITMQ_RECONNECT_MAX_MS: z.coerce.number().int().positive().default(30000),
});

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type MessagingConfig = z.infer<typeof messagingConfigSchema>;
