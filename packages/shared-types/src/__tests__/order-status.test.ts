import {
  ORDER_STATUS,
  ALLOWED_TRANSITIONS,
  canTransition,
  assertTransition,
  isTerminalStatus,
  InvalidOrderTransitionError,
  orderStatusSchema,
  type OrderStatus,
} from '../domain/order-status';

describe('maquina de estados do pedido', () => {
  const validTransitions: Array<[OrderStatus, OrderStatus]> = [
    [ORDER_STATUS.PENDING, ORDER_STATUS.STOCK_RESERVED],
    [ORDER_STATUS.PENDING, ORDER_STATUS.STOCK_FAILED],
    [ORDER_STATUS.STOCK_RESERVED, ORDER_STATUS.CONFIRMED],
    [ORDER_STATUS.STOCK_RESERVED, ORDER_STATUS.PAYMENT_FAILED],
  ];

  it.each(validTransitions)('permite %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const invalidTransitions: Array<[OrderStatus, OrderStatus]> = [
    [ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED],
    [ORDER_STATUS.PENDING, ORDER_STATUS.PAYMENT_FAILED],
    [ORDER_STATUS.PENDING, ORDER_STATUS.PENDING],
    [ORDER_STATUS.STOCK_RESERVED, ORDER_STATUS.STOCK_FAILED],
    [ORDER_STATUS.STOCK_RESERVED, ORDER_STATUS.PENDING],
    [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PAYMENT_FAILED],
    [ORDER_STATUS.STOCK_FAILED, ORDER_STATUS.STOCK_RESERVED],
    [ORDER_STATUS.PAYMENT_FAILED, ORDER_STATUS.CONFIRMED],
  ];

  it.each(invalidTransitions)('rejeita %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidOrderTransitionError);
  });

  it('expoe from e to no erro de transicao invalida', () => {
    try {
      assertTransition(ORDER_STATUS.CONFIRMED, ORDER_STATUS.PENDING);
      throw new Error('deveria ter lancado');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOrderTransitionError);
      const typed = error as InvalidOrderTransitionError;
      expect(typed.from).toBe(ORDER_STATUS.CONFIRMED);
      expect(typed.to).toBe(ORDER_STATUS.PENDING);
    }
  });

  it('trata CONFIRMED, STOCK_FAILED e PAYMENT_FAILED como terminais', () => {
    expect(isTerminalStatus(ORDER_STATUS.CONFIRMED)).toBe(true);
    expect(isTerminalStatus(ORDER_STATUS.STOCK_FAILED)).toBe(true);
    expect(isTerminalStatus(ORDER_STATUS.PAYMENT_FAILED)).toBe(true);
    expect(isTerminalStatus(ORDER_STATUS.PENDING)).toBe(false);
    expect(isTerminalStatus(ORDER_STATUS.STOCK_RESERVED)).toBe(false);
  });

  it('nao permite saida de estados terminais', () => {
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.CONFIRMED]).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.STOCK_FAILED]).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS[ORDER_STATUS.PAYMENT_FAILED]).toHaveLength(0);
  });

  it('valida o enum de status pela fronteira Zod', () => {
    expect(orderStatusSchema.safeParse('PENDING').success).toBe(true);
    expect(orderStatusSchema.safeParse('CANCELLED').success).toBe(false);
    expect(orderStatusSchema.safeParse('pending').success).toBe(false);
  });
});
