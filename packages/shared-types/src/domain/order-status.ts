import { z } from 'zod';

/**
 * Estados do pedido. A lista e fechada: qualquer valor fora dela e rejeitado
 * na fronteira (Zod) e na maquina de estados.
 */
export const ORDER_STATUS = {
  PENDING: 'PENDING',
  STOCK_RESERVED: 'STOCK_RESERVED',
  CONFIRMED: 'CONFIRMED',
  STOCK_FAILED: 'STOCK_FAILED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const orderStatusSchema = z.enum([
  ORDER_STATUS.PENDING,
  ORDER_STATUS.STOCK_RESERVED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.STOCK_FAILED,
  ORDER_STATUS.PAYMENT_FAILED,
]);

/**
 * Transicoes permitidas. Estados finais mapeiam para lista vazia.
 *
 * PENDING        -> STOCK_RESERVED | STOCK_FAILED
 * STOCK_RESERVED -> CONFIRMED      | PAYMENT_FAILED
 * CONFIRMED, STOCK_FAILED, PAYMENT_FAILED sao terminais.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    [ORDER_STATUS.PENDING]: [ORDER_STATUS.STOCK_RESERVED, ORDER_STATUS.STOCK_FAILED],
    [ORDER_STATUS.STOCK_RESERVED]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PAYMENT_FAILED],
    [ORDER_STATUS.CONFIRMED]: [],
    [ORDER_STATUS.STOCK_FAILED]: [],
    [ORDER_STATUS.PAYMENT_FAILED]: [],
  });

export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.STOCK_FAILED,
  ORDER_STATUS.PAYMENT_FAILED,
];

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Erro lancado quando uma transicao invalida e tentada. O Serviço de Pedidos
 * traduz este erro em HTTP 409 nas rotas e em descarte controlado nos
 * consumidores (evento fora de ordem ou reprocessado apos estado terminal).
 */
export class InvalidOrderTransitionError extends Error {
  public readonly from: OrderStatus;
  public readonly to: OrderStatus;

  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Transicao invalida de ${from} para ${to}`);
    this.name = 'InvalidOrderTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Ponto unico de validacao das transicoes de estado do pedido.
 * Toda mudanca de status no Serviço de Pedidos passa por aqui.
 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}
