import { EVENT_TYPES, type EventType } from '@loja-veloz/shared-types';

/**
 * Topologia do RabbitMQ.
 *
 * Tres exchanges, todos do tipo topic e duraveis:
 *
 *   loja-veloz.events  exchange principal. Produtores publicam aqui usando o
 *                      proprio `eventType` como routing key.
 *   loja-veloz.retry   exchange de reprocessamento. Cada fila de consumo tem
 *                      uma fila espelho `<fila>.retry` com TTL. Ao expirar, a
 *                      mensagem e dead-lettered para o exchange padrao com
 *                      routing key igual ao nome da fila original, retornando
 *                      ao consumidor apos o atraso.
 *   loja-veloz.dlx     dead letter exchange terminal. Mensagens que esgotaram
 *                      as tentativas, ou cujo payload viola o contrato, param
 *                      em `<fila>.dlq` para inspecao manual.
 *
 * O atraso entre tentativas usa o par TTL + dead-letter, recurso nativo do
 * broker. Nao ha dependencia de plugins externos como o delayed message
 * exchange, o que mantem a imagem oficial do RabbitMQ suficiente.
 */
export const EXCHANGES = {
  EVENTS: 'loja-veloz.events',
  RETRY: 'loja-veloz.retry',
  DLX: 'loja-veloz.dlx',
} as const;

export const EXCHANGE_TYPE = 'topic' as const;

export const QUEUES = {
  /** Estoque reage a criacao do pedido tentando reservar os itens. */
  INVENTORY_ORDER_CREATED: 'inventory.order-created',
  /** Pedidos consome o resultado da reserva de estoque. */
  ORDERS_STOCK_RESULT: 'orders.stock-result',
  /** Pagamentos so entra em cena depois que o estoque foi reservado. */
  PAYMENTS_STOCK_RESERVED: 'payments.stock-reserved',
  /** Pedidos consome o resultado do pagamento. */
  ORDERS_PAYMENT_RESULT: 'orders.payment-result',
  /** Estoque devolve as reservas apos falha de pagamento. */
  INVENTORY_STOCK_RELEASE: 'inventory.stock-release',
  /** Trilha de auditoria: nao altera estado, apenas registra e mede. */
  ORDERS_AUDIT: 'orders.audit',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface QueueDefinition {
  name: QueueName;
  /** Routing keys: sempre iguais aos `eventType` do catalogo compartilhado. */
  bindings: readonly EventType[];
  /** Servico dono da fila. Usado apenas para documentacao e logs. */
  owner: 'order-service' | 'inventory-service' | 'payment-service';
}

export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: QUEUES.INVENTORY_ORDER_CREATED,
    bindings: [EVENT_TYPES.ORDER_CREATED],
    owner: 'inventory-service',
  },
  {
    name: QUEUES.ORDERS_STOCK_RESULT,
    bindings: [EVENT_TYPES.STOCK_RESERVED, EVENT_TYPES.STOCK_FAILED],
    owner: 'order-service',
  },
  {
    name: QUEUES.PAYMENTS_STOCK_RESERVED,
    bindings: [EVENT_TYPES.STOCK_RESERVED],
    owner: 'payment-service',
  },
  {
    name: QUEUES.ORDERS_PAYMENT_RESULT,
    bindings: [EVENT_TYPES.PAYMENT_APPROVED, EVENT_TYPES.PAYMENT_FAILED],
    owner: 'order-service',
  },
  {
    name: QUEUES.INVENTORY_STOCK_RELEASE,
    bindings: [EVENT_TYPES.STOCK_RELEASE_REQUESTED],
    owner: 'inventory-service',
  },
  {
    name: QUEUES.ORDERS_AUDIT,
    bindings: [EVENT_TYPES.STOCK_RELEASED],
    owner: 'order-service',
  },
];

export function retryQueueName(queue: QueueName): string {
  return `${queue}.retry`;
}

export function deadLetterQueueName(queue: QueueName): string {
  return `${queue}.dlq`;
}

export function findQueueDefinition(name: string): QueueDefinition | undefined {
  return QUEUE_DEFINITIONS.find((definition) => definition.name === name);
}

/**
 * Contrato minimo de canal usado pela declaracao de topologia.
 * Declarado localmente para que a funcao possa ser exercitada em teste
 * unitario com um duble, sem exigir um broker em execucao.
 */
export interface TopologyChannel {
  assertExchange(
    exchange: string,
    type: string,
    options: { durable: boolean }
  ): Promise<unknown>;
  assertQueue(queue: string, options: Record<string, unknown>): Promise<unknown>;
  bindQueue(queue: string, source: string, pattern: string): Promise<unknown>;
}

export interface AssertTopologyOptions {
  retryDelayMs: number;
  /** Subconjunto de filas a declarar. Por padrao, todas. */
  queues?: readonly QueueDefinition[];
}

/**
 * Declara exchanges, filas, filas de retry, filas mortas e bindings.
 *
 * A operacao e idempotente no broker: declarar duas vezes com os mesmos
 * argumentos e seguro. Todos os servicos declaram a topologia inteira na
 * inicializacao, o que remove a necessidade de um passo de provisionamento
 * separado e garante que a ordem de subida dos conteineres nao importe.
 */
export async function assertTopology(
  channel: TopologyChannel,
  options: AssertTopologyOptions
): Promise<void> {
  await channel.assertExchange(EXCHANGES.EVENTS, EXCHANGE_TYPE, { durable: true });
  await channel.assertExchange(EXCHANGES.RETRY, EXCHANGE_TYPE, { durable: true });
  await channel.assertExchange(EXCHANGES.DLX, EXCHANGE_TYPE, { durable: true });

  const queues = options.queues ?? QUEUE_DEFINITIONS;

  for (const definition of queues) {
    await channel.assertQueue(definition.name, { durable: true });

    for (const binding of definition.bindings) {
      await channel.bindQueue(definition.name, EXCHANGES.EVENTS, binding);
    }

    // Fila de espera: a mensagem fica parada pelo TTL e, ao expirar, o broker
    // a envia ao exchange padrao ("") com routing key igual ao nome da fila
    // original, o que a devolve exatamente ao consumidor que falhou.
    await channel.assertQueue(retryQueueName(definition.name), {
      durable: true,
      messageTtl: options.retryDelayMs,
      deadLetterExchange: '',
      deadLetterRoutingKey: definition.name,
    });
    await channel.bindQueue(retryQueueName(definition.name), EXCHANGES.RETRY, definition.name);

    await channel.assertQueue(deadLetterQueueName(definition.name), { durable: true });
    await channel.bindQueue(deadLetterQueueName(definition.name), EXCHANGES.DLX, definition.name);
  }
}
