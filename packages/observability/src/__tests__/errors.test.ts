import { z } from 'zod';
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
  toErrorResponse,
} from '../errors';

describe('toErrorResponse', () => {
  it('traduz ZodError em 400 com detalhes por campo', () => {
    const schema = z.object({ customerId: z.string().min(1), total: z.number() });
    const result = schema.safeParse({ customerId: '', total: 'x' });
    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }
    const response = toErrorResponse(result.error, 'corr-1');
    expect(response.statusCode).toBe(400);
    expect(response.expected).toBe(true);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.correlationId).toBe('corr-1');
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect((response.body.error.details as unknown[]).length).toBe(2);
  });

  it('preserva statusCode e code de AppError', () => {
    const response = toErrorResponse(new NotFoundError('Pedido', 'abc'), 'corr-2');
    expect(response.statusCode).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.error.message).toContain('abc');
  });

  it.each([
    [new ValidationError('invalido'), 400, 'VALIDATION_ERROR'],
    [new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    [new ConflictError('conflito'), 409, 'CONFLICT'],
    [new ServiceUnavailableError('sem banco'), 503, 'SERVICE_UNAVAILABLE'],
    [new UpstreamTimeoutError('order-service', 5000), 504, 'UPSTREAM_TIMEOUT'],
  ])('mapeia %s corretamente', (error, statusCode, code) => {
    const response = toErrorResponse(error);
    expect(response.statusCode).toBe(statusCode);
    expect(response.body.error.code).toBe(code);
  });

  it('nao vaza mensagem interna de erro desconhecido', () => {
    const response = toErrorResponse(new Error('SELECT falhou: senha do banco invalida'));
    expect(response.statusCode).toBe(500);
    expect(response.expected).toBe(false);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe('Erro interno do servico');
    expect(JSON.stringify(response.body)).not.toContain('senha');
  });

  it('classifica 5xx como nao esperado e 4xx como esperado', () => {
    expect(toErrorResponse(new AppError(500, 'X', 'y')).expected).toBe(false);
    expect(toErrorResponse(new AppError(422, 'X', 'y')).expected).toBe(true);
  });

  it('omite details quando nao informado', () => {
    const response = toErrorResponse(new ConflictError('conflito'));
    expect(response.body.error.details).toBeUndefined();
  });
});
