import type { Logger } from 'pino';

export interface ShutdownStep {
  name: string;
  run: () => Promise<void>;
}

export interface ShutdownOptions {
  logger: Logger;
  /** Tempo maximo total do encerramento antes de sair a forca. */
  timeoutMs: number;
  /** Executados na ordem informada. */
  steps: ShutdownStep[];
  /** Injetavel para permitir teste sem encerrar o processo do Jest. */
  exit?: (code: number) => void;
}

/**
 * Encerramento ordenado do processo.
 *
 * Ordem adotada, do mais externo para o mais interno:
 *   1. parar de aceitar novas conexoes HTTP;
 *   2. concluir requisicoes em andamento dentro do limite;
 *   3. cancelar o consumo de novas mensagens;
 *   4. encerrar canais do RabbitMQ;
 *   5. encerrar a conexao do RabbitMQ;
 *   6. desconectar o Prisma;
 *   7. finalizar o SDK de tracing;
 *   8. registrar o encerramento.
 *
 * Fechar o servidor HTTP antes das dependencias evita que uma requisicao
 * ainda em curso encontre o pool do banco ja fechado.
 *
 * O guarda `shuttingDown` garante execucao unica: em Kubernetes e comum
 * receber SIGTERM e, logo depois, um segundo sinal.
 */
export function registerGracefulShutdown(options: ShutdownOptions): () => Promise<void> {
  const { logger, timeoutMs, steps } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn({ signal }, 'Sinal de encerramento ignorado: shutdown ja em andamento');
      return;
    }
    shuttingDown = true;
    logger.info({ signal, timeoutMs }, 'Iniciando encerramento ordenado');

    // Rede de seguranca: se algum passo travar, o processo ainda termina.
    const forceTimer = setTimeout(() => {
      logger.error({ timeoutMs }, 'Tempo limite de encerramento excedido, saindo a forca');
      exit(1);
    }, timeoutMs);
    forceTimer.unref();

    let failed = false;
    for (const step of steps) {
      try {
        await step.run();
        logger.info({ step: step.name }, 'Passo de encerramento concluido');
      } catch (error) {
        failed = true;
        logger.error(
          { step: step.name, err: error instanceof Error ? error : new Error(String(error)) },
          'Falha em passo de encerramento'
        );
      }
    }

    clearTimeout(forceTimer);
    logger.info({ signal, failed }, 'Encerramento concluido');
    exit(failed ? 1 : 0);
  };

  const handle = (signal: NodeJS.Signals) => {
    void shutdown(signal);
  };

  process.on('SIGTERM', handle);
  process.on('SIGINT', handle);

  // Erros nao capturados devem derrubar o processo de forma controlada,
  // e nao deixar a aplicacao em estado indefinido.
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Promise rejeitada sem tratamento');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'Excecao nao capturada');
    void shutdown('uncaughtException');
  });

  return () => shutdown('manual');
}

/**
 * Fecha um servidor HTTP e aguarda o encerramento das conexoes ativas.
 * `server.close` para de aceitar novas conexoes imediatamente e chama o
 * callback quando as requisicoes em andamento terminam.
 */
export function closeHttpServer(
  server: { close: (cb: (err?: Error) => void) => void },
  gracePeriodMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Servidor HTTP nao encerrou em ${gracePeriodMs}ms`));
    }, gracePeriodMs);
    timer.unref();

    server.close((error) => {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
