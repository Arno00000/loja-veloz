import { z } from 'zod';
import { baseConfigSchema, messagingConfigSchema, booleanFromEnv } from '../base-schema';
import {
  loadConfig,
  ConfigurationError,
  redactConnectionString,
  redactConfig,
} from '../load-config';

const validBaseEnv = {
  SERVICE_NAME: 'order-service',
  PORT: '3001',
} as unknown as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('aplica os valores padrao do schema base', () => {
    const config = loadConfig(baseConfigSchema, validBaseEnv, 'order-service');
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.PORT).toBe(3001);
    expect(config.OTEL_TRACES_ENABLED).toBe(true);
  });

  it('falha quando uma variavel obrigatoria esta ausente', () => {
    expect(() => loadConfig(baseConfigSchema, { PORT: '3001' }, 'order-service')).toThrow(
      ConfigurationError
    );
  });

  it('lista todas as variaveis invalidas de uma vez', () => {
    try {
      loadConfig(baseConfigSchema, { PORT: 'nao-numero' }, 'order-service');
      throw new Error('deveria ter lancado');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const typed = error as ConfigurationError;
      expect(typed.issues.length).toBeGreaterThanOrEqual(2);
      expect(typed.message).toContain('order-service');
    }
  });

  it('rejeita porta fora do intervalo valido', () => {
    expect(() =>
      loadConfig(baseConfigSchema, { SERVICE_NAME: 'x', PORT: '70000' }, 'x')
    ).toThrow(ConfigurationError);
  });

  it('rejeita LOG_LEVEL desconhecido', () => {
    expect(() =>
      loadConfig(baseConfigSchema, { ...validBaseEnv, LOG_LEVEL: 'verbose' }, 'x')
    ).toThrow(ConfigurationError);
  });

  it('nao expoe valores lidos na mensagem de erro', () => {
    const schema = z.object({ SECRET_TOKEN: z.string().min(50) });
    try {
      loadConfig(schema, { SECRET_TOKEN: 'valor-secreto-curto' }, 'x');
      throw new Error('deveria ter lancado');
    } catch (error) {
      expect((error as ConfigurationError).message).not.toContain('valor-secreto-curto');
    }
  });
});

describe('schema de mensageria', () => {
  it('exige URL amqp', () => {
    expect(() => loadConfig(messagingConfigSchema, { RABBITMQ_URL: 'http://x' })).toThrow(
      ConfigurationError
    );
  });

  it('aplica prefetch e politica de retry padrao', () => {
    const config = loadConfig(messagingConfigSchema, {
      RABBITMQ_URL: 'amqp://user:pass@rabbitmq:5672',
    });
    expect(config.RABBITMQ_PREFETCH).toBe(10);
    expect(config.RABBITMQ_MAX_RETRIES).toBe(3);
    expect(config.RABBITMQ_RETRY_DELAY_MS).toBe(5000);
  });

  it('nao aceita retry infinito por configuracao', () => {
    expect(() =>
      loadConfig(messagingConfigSchema, {
        RABBITMQ_URL: 'amqp://rabbitmq:5672',
        RABBITMQ_MAX_RETRIES: '999',
      })
    ).toThrow(ConfigurationError);
  });
});

describe('booleanFromEnv', () => {
  it('converte apenas literais explicitos', () => {
    expect(booleanFromEnv.parse('true')).toBe(true);
    expect(booleanFromEnv.parse('false')).toBe(false);
    expect(booleanFromEnv.safeParse('1').success).toBe(false);
    expect(booleanFromEnv.safeParse('yes').success).toBe(false);
  });
});

describe('mascaramento de dados sensiveis', () => {
  it('remove usuario e senha de uma connection string', () => {
    const redacted = redactConnectionString(
      'postgresql://orders_user:senha@postgres:5432/orders_db'
    );
    expect(redacted).toBe('postgresql://***:***@postgres:5432/orders_db');
    expect(redacted).not.toContain('senha');
  });

  it('devolve mascara total para valores nao parseaveis', () => {
    expect(redactConnectionString('valor-qualquer')).toBe('***');
  });

  it('mascara chaves sensiveis mantendo as demais', () => {
    const redacted = redactConfig({
      SERVICE_NAME: 'order-service',
      PORT: 3001,
      INVENTORY_ADMIN_KEY: 'admin_dev_only',
      RABBITMQ_URL: 'amqp://user:pass@rabbitmq:5672/lojaveloz',
    });
    expect(redacted.SERVICE_NAME).toBe('order-service');
    expect(redacted.PORT).toBe(3001);
    expect(redacted.INVENTORY_ADMIN_KEY).toBe('***');
    expect(redacted.RABBITMQ_URL).toBe('amqp://***:***@rabbitmq:5672/lojaveloz');
    expect(String(redacted.RABBITMQ_URL)).not.toContain('pass');
  });
});
