import { ZodError } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

/**
 * Formato unico de erro devolvido por todos os servicos.
 * O Gateway repassa este mesmo formato ao cliente externo.
 */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  /** Erros esperados de negocio nao poluem o log de erro do servico. */
  public readonly expected: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: unknown; expected?: boolean } = {}
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.expected = options.expected ?? statusCode < 500;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier: string) {
    super(404, 'RESOURCE_NOT_FOUND', `${resource} nao encontrado: ${identifier}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, { details });
    this.name = 'ValidationError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT', message, { details });
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Credencial ausente ou invalida') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, { details });
    this.name = 'ServiceUnavailableError';
  }
}

export class UpstreamTimeoutError extends AppError {
  constructor(target: string, timeoutMs: number) {
    super(504, 'UPSTREAM_TIMEOUT', `Tempo limite de ${timeoutMs}ms excedido ao chamar ${target}`);
    this.name = 'UpstreamTimeoutError';
  }
}

/** Converte qualquer erro em uma resposta HTTP padronizada. */
export function toErrorResponse(
  error: unknown,
  correlationId?: string
): { statusCode: number; body: ErrorResponseBody; expected: boolean } {
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      expected: true,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Payload invalido',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          correlationId,
        },
      },
    };
  }

  const httpError =
    typeof error === 'object' && error !== null
      ? (error as { type?: unknown; status?: unknown; statusCode?: unknown })
      : undefined;

  if (
    httpError?.type === 'entity.too.large' ||
    httpError?.status === 413 ||
    httpError?.statusCode === 413
  ) {
    return {
      statusCode: 413,
      expected: true,
      body: {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Corpo da requisicao excede o limite permitido',
          correlationId,
        },
      },
    };
  }

  if (error instanceof AppError) {
    const body: ErrorResponseBody = {
      error: { code: error.code, message: error.message, correlationId },
    };
    if (error.details !== undefined) {
      body.error.details = error.details;
    }
    return { statusCode: error.statusCode, body, expected: error.expected };
  }

  // Erros nao previstos nunca vazam stack trace ou mensagem interna ao cliente.
  return {
    statusCode: 500,
    expected: false,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno do servico',
        correlationId,
      },
    },
  };
}

/**
 * Middleware final de erro. Deve ser registrado depois de todas as rotas.
 * A assinatura de quatro parametros e obrigatoria para o Express reconhecer
 * o handler como tratador de erro.
 */
export function errorHandler(logger: Logger) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const correlationId = res.locals.correlationId as string | undefined;
    const { statusCode, body, expected } = toErrorResponse(error, correlationId);

    const logPayload = {
      correlationId,
      statusCode,
      method: req.method,
      route: req.route?.path ?? req.path,
      errorCode: body.error.code,
    };

    if (expected) {
      logger.warn(logPayload, body.error.message);
    } else {
      logger.error(
        { ...logPayload, err: error instanceof Error ? error : new Error(String(error)) },
        'Erro nao tratado'
      );
    }

    if (res.headersSent) {
      return;
    }
    res.status(statusCode).json(body);
  };
}

/** Handler 404 para rotas nao registradas. */
export function notFoundHandler() {
  return (req: Request, res: Response): void => {
    res.status(404).json({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Rota nao encontrada: ${req.method} ${req.path}`,
        correlationId: res.locals.correlationId as string | undefined,
      },
    });
  };
}
