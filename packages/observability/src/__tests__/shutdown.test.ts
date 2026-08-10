import { registerGracefulShutdown, closeHttpServer } from '../shutdown';

function fakeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as import('pino').Logger;
}

describe('registerGracefulShutdown', () => {
  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  it('executa os passos na ordem declarada', async () => {
    const order: string[] = [];
    const exit = jest.fn();
    const shutdown = registerGracefulShutdown({
      logger: fakeLogger(),
      timeoutMs: 1000,
      exit,
      steps: [
        { name: 'http', run: async () => void order.push('http') },
        { name: 'consumers', run: async () => void order.push('consumers') },
        { name: 'rabbitmq', run: async () => void order.push('rabbitmq') },
        { name: 'prisma', run: async () => void order.push('prisma') },
      ],
    });

    await shutdown();

    expect(order).toEqual(['http', 'consumers', 'rabbitmq', 'prisma']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('executa o encerramento apenas uma vez', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const logger = fakeLogger();
    const shutdown = registerGracefulShutdown({
      logger,
      timeoutMs: 1000,
      exit,
      steps: [{ name: 'unico', run }],
    });

    await shutdown();
    await shutdown();
    await shutdown();

    expect(run).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('continua os passos seguintes quando um passo falha e sai com codigo 1', async () => {
    const later = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const shutdown = registerGracefulShutdown({
      logger: fakeLogger(),
      timeoutMs: 1000,
      exit,
      steps: [
        { name: 'falha', run: async () => Promise.reject(new Error('canal ja fechado')) },
        { name: 'prisma', run: later },
      ],
    });

    await shutdown();

    expect(later).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('closeHttpServer', () => {
  it('resolve quando o servidor fecha sem erro', async () => {
    const server = { close: (cb: (err?: Error) => void) => cb() };
    await expect(closeHttpServer(server, 500)).resolves.toBeUndefined();
  });

  it('rejeita quando o servidor reporta erro', async () => {
    const server = { close: (cb: (err?: Error) => void) => cb(new Error('nao estava aberto')) };
    await expect(closeHttpServer(server, 500)).rejects.toThrow('nao estava aberto');
  });

  it('rejeita quando o fechamento excede o periodo de graca', async () => {
    const server = { close: () => undefined };
    await expect(closeHttpServer(server, 50)).rejects.toThrow(/nao encerrou/);
  });
});
