import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';

interface CorrelationStore {
  correlationId: string;
}

/**
 * Armazenamento por contexto assincrono.
 *
 * Permite que camadas profundas (repositorios, publicadores de evento)
 * recuperem o correlationId sem receber o objeto Request como parametro,
 * evitando poluir todas as assinaturas de funcao.
 */
const storage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** Gera um identificador de correlacao novo. */
export function newCorrelationId(): string {
  return randomUUID();
}

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Middleware de correlacao.
 *
 * Aceita um `x-correlation-id` vindo do cliente apenas se ele obedecer a um
 * formato restrito; caso contrario gera um novo. Isso impede injecao de
 * conteudo arbitrario em logs a partir de um header controlado pelo usuario.
 *
 * O correlationId identifica a jornada de negocio e e distinto do trace
 * context do OpenTelemetry (`traceparent`), que identifica a arvore de spans.
 * Os dois convivem: o primeiro sobrevive a saltos assincronos de longa duracao
 * e a reprocessamentos; o segundo descreve a execucao distribuida.
 */
export function correlationMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header(CORRELATION_HEADER);
    const correlationId =
      incoming && CORRELATION_ID_PATTERN.test(incoming) ? incoming : newCorrelationId();

    res.locals.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);

    runWithCorrelationId(correlationId, () => next());
  };
}
