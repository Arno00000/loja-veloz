import { z } from 'zod';

export class ConfigurationError extends Error {
  public readonly issues: string[];

  constructor(serviceHint: string, issues: string[]) {
    super(`Configuracao invalida em ${serviceHint}:\n` + issues.map((i) => `  - ${i}`).join('\n'));
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

/**
 * Le e valida a configuracao do processo uma unica vez, na inicializacao.
 *
 * Falhar rapido e proposital: um processo com configuracao invalida nunca
 * deve subir e comecar a receber trafego. O Kubernetes vai registrar o
 * CrashLoopBackOff e o motivo aparece integralmente no log de saida.
 *
 * A mensagem de erro lista os campos ausentes ou invalidos, mas nunca imprime
 * os valores lidos, para nao vazar credenciais em logs.
 */
export function loadConfig<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  source: NodeJS.ProcessEnv = process.env,
  serviceHint = 'processo'
): z.infer<TSchema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(raiz)';
      return `${path}: ${issue.message}`;
    });
    throw new ConfigurationError(serviceHint, issues);
  }

  return result.data;
}

/**
 * Mascara valores sensiveis antes de qualquer registro em log.
 * Preserva o esquema e o host de URLs de conexao para facilitar diagnostico,
 * removendo usuario e senha.
 */
export function redactConnectionString(value: string): string {
  try {
    const url = new URL(value);
    const auth = url.username ? '***:***@' : '';
    return `${url.protocol}//${auth}${url.host}${url.pathname}`;
  } catch {
    return '***';
  }
}

export const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|key|authorization|url)/i;

/**
 * Produz uma copia da configuracao segura para log, substituindo qualquer
 * chave cujo nome sugira segredo.
 */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = value.includes('://') ? redactConnectionString(value) : '***';
      continue;
    }
    output[key] = value;
  }
  return output;
}
