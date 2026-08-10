import amqp, { type Channel, type ConfirmChannel } from 'amqplib';
import type { Logger } from '@loja-veloz/observability';
import { assertTopology } from './topology';
import { brokerConnectionUp, brokerReconnectionsTotal } from './metrics';

/**
 * O tipo devolvido por `amqp.connect` mudou de nome entre versoes da
 * biblioteca (`Connection` e, em versoes mais novas, `ChannelModel`).
 * Derivar o tipo da propria funcao evita quebrar em qualquer uma delas.
 */
type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

export interface RabbitMQClientOptions {
  url: string;
  serviceName: string;
  logger: Logger;
  prefetch: number;
  retryDelayMs: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
}

export type ChannelConsumer = (channel: Channel) => Promise<void>;

/**
 * Cliente RabbitMQ com conexao persistente e reconexao automatica.
 *
 * Decisoes:
 *
 * - Dois canais por processo. Um `ConfirmChannel` para publicacao, para que
 *   cada publish possa aguardar o ack do broker, e um `Channel` comum para
 *   consumo, com `prefetch` limitando quantas mensagens ficam em voo.
 *   Separar os canais impede que um erro de publicacao derrube o consumo.
 *
 * - Reconexao com backoff exponencial e teto. Reconectar em laco apertado
 *   contra um broker fora do ar so agrava a indisponibilidade.
 *
 * - Apos reconectar, a topologia e declarada novamente e todos os
 *   consumidores registrados sao restabelecidos. O servico volta a operar
 *   sozinho, sem intervencao e sem reinicio do pod.
 *
 * - `depends_on` do Compose e `initContainer` do Kubernetes nao substituem
 *   isso: a indisponibilidade pode acontecer a qualquer momento, nao apenas
 *   na partida.
 */
export class RabbitMQClient {
  private connection?: AmqpConnection;
  private publishChannel?: ConfirmChannel;
  private consumeChannel?: Channel;

  private readonly consumers: ChannelConsumer[] = [];
  private readonly consumerTags: string[] = [];

  private connecting = false;
  private closing = false;
  private reconnectDelayMs: number;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private readonly options: RabbitMQClientOptions) {
    this.reconnectDelayMs = options.reconnectMinMs;
  }

  isConnected(): boolean {
    return this.connection !== undefined && this.publishChannel !== undefined;
  }

  getPublishChannel(): ConfirmChannel {
    if (!this.publishChannel) {
      throw new Error('Canal de publicacao indisponivel: cliente RabbitMQ nao conectado');
    }
    return this.publishChannel;
  }

  getConsumeChannel(): Channel {
    if (!this.consumeChannel) {
      throw new Error('Canal de consumo indisponivel: cliente RabbitMQ nao conectado');
    }
    return this.consumeChannel;
  }

  /** Verificacao usada pelo readiness probe. */
  async healthCheck(): Promise<boolean> {
    if (!this.publishChannel) {
      return false;
    }
    try {
      // checkExchange e uma operacao leve que exercita o canal de verdade.
      await this.publishChannel.checkExchange('loja-veloz.events');
      return true;
    } catch {
      return false;
    }
  }

  async connect(): Promise<void> {
    if (this.connecting || this.isConnected()) {
      return;
    }
    this.connecting = true;

    try {
      this.options.logger.info('Conectando ao RabbitMQ');

      const connection = await amqp.connect(this.options.url, {
        clientProperties: { connection_name: this.options.serviceName },
      });
      this.connection = connection;

      connection.on('error', (error: Error) => {
        this.options.logger.error({ err: error }, 'Erro na conexao RabbitMQ');
      });
      connection.on('close', () => {
        brokerConnectionUp.set(0);
        this.publishChannel = undefined;
        this.consumeChannel = undefined;
        this.connection = undefined;
        this.consumerTags.length = 0;
        if (!this.closing) {
          this.options.logger.warn('Conexao RabbitMQ encerrada, agendando reconexao');
          this.scheduleReconnect();
        }
      });

      this.publishChannel = await connection.createConfirmChannel();
      this.publishChannel.on('error', (error: Error) => {
        this.options.logger.error({ err: error }, 'Erro no canal de publicacao');
      });

      this.consumeChannel = await connection.createChannel();
      this.consumeChannel.on('error', (error: Error) => {
        this.options.logger.error({ err: error }, 'Erro no canal de consumo');
      });
      await this.consumeChannel.prefetch(this.options.prefetch);

      await assertTopology(this.publishChannel, { retryDelayMs: this.options.retryDelayMs });

      // Reestabelece consumidores registrados antes da queda.
      for (const register of this.consumers) {
        await register(this.consumeChannel);
      }

      brokerConnectionUp.set(1);
      this.reconnectDelayMs = this.options.reconnectMinMs;
      this.options.logger.info(
        { prefetch: this.options.prefetch, consumers: this.consumers.length },
        'Conectado ao RabbitMQ e topologia declarada'
      );
    } catch (error) {
      brokerConnectionUp.set(0);
      this.options.logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        'Falha ao conectar no RabbitMQ'
      );
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Registra um consumidor. Ele e aplicado imediatamente se ja houver canal,
   * e reaplicado automaticamente a cada reconexao.
   */
  async registerConsumer(register: ChannelConsumer): Promise<void> {
    this.consumers.push(register);
    if (this.consumeChannel) {
      await register(this.consumeChannel);
    }
  }

  trackConsumerTag(tag: string): void {
    this.consumerTags.push(tag);
  }

  /**
   * Cancela o consumo sem fechar a conexao. Primeiro passo do encerramento
   * ordenado: para de receber mensagens novas, mas as que ja estao em
   * processamento chegam ao fim e sao confirmadas.
   */
  async stopConsuming(): Promise<void> {
    if (!this.consumeChannel) {
      return;
    }
    for (const tag of this.consumerTags) {
      try {
        await this.consumeChannel.cancel(tag);
      } catch (error) {
        this.options.logger.warn({ tag, err: error }, 'Falha ao cancelar consumidor');
      }
    }
    this.consumerTags.length = 0;
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    try {
      await this.publishChannel?.close();
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Falha ao fechar canal de publicacao');
    }
    try {
      await this.consumeChannel?.close();
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Falha ao fechar canal de consumo');
    }
    try {
      await this.connection?.close();
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Falha ao fechar conexao RabbitMQ');
    }

    this.publishChannel = undefined;
    this.consumeChannel = undefined;
    this.connection = undefined;
    brokerConnectionUp.set(0);
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) {
      return;
    }

    const delay = this.reconnectDelayMs;
    this.options.logger.warn({ delayMs: delay }, 'Nova tentativa de conexao ao RabbitMQ agendada');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      brokerReconnectionsTotal.inc();
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();

    // Backoff exponencial com teto configuravel.
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.options.reconnectMaxMs);
  }
}
