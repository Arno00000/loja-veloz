import {
  AppError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
  CORRELATION_HEADER,
  injectTraceContext,
  type Logger,
} from '@loja-veloz/observability';

export interface UpstreamRequest {
  /** Nome curto do destino, usado em log e mensagem de erro. */
  target: string;
  baseUrl: string;
  path: string;
  method: 'GET' | 'POST';
  correlationId: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export interface UpstreamResponse {
  statusCode: number;
  body: unknown;
}

export interface UpstreamClientOptions {
  timeoutMs: number;
  logger: Logger;
}

/**
 * Cliente HTTP para os servicos internos.
 *
 * Usa o `fetch` global do Node 22, o que evita mais uma dependencia externa.
 *
 * Tratamentos obrigatorios implementados aqui:
 * - timeout por requisicao com AbortSignal, para que uma dependencia lenta
 *   nao consuma indefinidamente conexoes do Gateway;
 * - conexao recusada (servico fora do ar) traduzida em 503;
 * - respostas de erro do servico interno repassadas com o mesmo status e o
 *   mesmo formato de corpo, sem reescrever a semantica;
 * - propagacao de `x-correlation-id` e do trace context W3C.
 */
export class UpstreamClient {
  constructor(private readonly options: UpstreamClientOptions) {}

  async request(request: UpstreamRequest): Promise<UpstreamResponse> {
    const url = new URL(request.path, request.baseUrl);
    if (request.query) {
      for (const [key, value] of Object.entries(request.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers: Record<string, string> = injectTraceContext({
      [CORRELATION_HEADER]: request.correlationId,
      accept: 'application/json',
    });

    let payload: string | undefined;
    if (request.body !== undefined) {
      payload = JSON.stringify(request.body);
      headers['content-type'] = 'application/json';
    }

    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });

      const text = await response.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          // Resposta que nao e JSON indica servico interno em estado invalido.
          throw new ServiceUnavailableError(`Resposta nao-JSON recebida de ${request.target}`);
        }
      }

      this.options.logger.debug(
        {
          target: request.target,
          method: request.method,
          path: request.path,
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
          correlationId: request.correlationId,
        },
        'Chamada a servico interno concluida'
      );

      return { statusCode: response.status, body };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const durationMs = Date.now() - startedAt;
      const name = error instanceof Error ? error.name : 'UnknownError';

      this.options.logger.error(
        {
          target: request.target,
          method: request.method,
          path: request.path,
          durationMs,
          correlationId: request.correlationId,
          err: error instanceof Error ? error : new Error(String(error)),
        },
        'Falha na chamada a servico interno'
      );

      // AbortSignal.timeout produz um erro com name TimeoutError.
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new UpstreamTimeoutError(request.target, this.options.timeoutMs);
      }

      // Conexao recusada, DNS inexistente e afins chegam como TypeError com
      // uma cause do tipo Error do sistema.
      throw new ServiceUnavailableError(`Servico ${request.target} indisponivel`, {
        target: request.target,
      });
    }
  }
}
