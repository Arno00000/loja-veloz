/**
 * Utilitários dos testes de integração.
 *
 * Estes testes falam com a stack real via HTTP: PostgreSQL, RabbitMQ e os
 * quatro serviços em execução. Nenhum mock. É essa a diferença entre eles e
 * os testes unitários — validar a integração com mock não validaria nada.
 */

export const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:18080';

export interface HttpResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export async function httpRequest<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; correlationId?: string; headers?: Record<string, string> } = {}
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.correlationId) {
    headers['x-correlation-id'] = options.correlationId;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(15000),
  });

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, body: body as T, headers: response.headers };
}

export const get = <T = unknown>(path: string, correlationId?: string) =>
  httpRequest<T>('GET', path, correlationId ? { correlationId } : {});

export const post = <T = unknown>(path: string, body: unknown, correlationId?: string) =>
  httpRequest<T>('POST', path, correlationId ? { body, correlationId } : { body });

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Espera até que uma condição se cumpra, com intervalo fixo e prazo máximo.
 *
 * Necessário porque o fluxo é assíncrono: o POST devolve 201 imediatamente e
 * o estado final só chega depois de a cadeia de eventos percorrer três
 * serviços. Usar `sleep` fixo tornaria o teste lento no melhor caso e instável
 * no pior; o polling termina assim que a condição é satisfeita.
 */
export async function waitFor<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;

  while (Date.now() < deadline) {
    last = await probe();
    if (predicate(last)) {
      return last;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Tempo esgotado (${timeoutMs}ms) aguardando: ${options.description ?? 'condição'}. ` +
      `Último valor observado: ${JSON.stringify(last)}`
  );
}

export interface OrderResponse {
  id: string;
  customerId: string;
  status: string;
  total: number;
  items: Array<{ sku: string; quantity: number; unitPrice: number }>;
}

export async function waitForOrderStatus(
  orderId: string,
  expected: string | string[],
  timeoutMs = 30000
): Promise<OrderResponse> {
  const expectedList = Array.isArray(expected) ? expected : [expected];

  const result = await waitFor(
    () => get<OrderResponse>(`/api/orders/${orderId}`),
    (response) => response.status === 200 && expectedList.includes(response.body.status),
    { timeoutMs, description: `pedido ${orderId} em ${expectedList.join(' ou ')}` }
  );

  return result.body;
}

/** Aguarda o Gateway responder readiness antes de iniciar a suíte. */
export async function waitForStack(timeoutMs = 120000): Promise<void> {
  await waitFor(
    async () => {
      try {
        return await get('/health/ready');
      } catch {
        return { status: 0, body: null, headers: new Headers() };
      }
    },
    (response) => response.status === 200,
    { timeoutMs, intervalMs: 2000, description: 'stack pronta em /health/ready' }
  );
}
