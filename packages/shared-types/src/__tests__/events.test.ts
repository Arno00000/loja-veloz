import {
  EVENT_TYPES,
  ALL_EVENT_TYPES,
  EVENT_SCHEMAS,
  isKnownEventType,
  parseEvent,
  safeParseEvent,
} from '../events/registry';
import { EVENT_VERSION_V1 } from '../events/envelope';

const ORDER_ID = '5b1f0f6c-2c9a-4f0f-9a6e-0b8f1c2d3e4f';
const EVENT_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function envelope(eventType: string) {
  return {
    eventId: EVENT_ID,
    eventType,
    eventVersion: EVENT_VERSION_V1,
    occurredAt: '2026-07-30T12:00:00.000Z',
    correlationId: 'corr-0001',
    producer: 'order-service',
  };
}

describe('registro de eventos', () => {
  it('mantem catalogo e schemas alinhados', () => {
    expect(Object.keys(EVENT_SCHEMAS).sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });

  it('reconhece apenas eventos do catalogo', () => {
    expect(isKnownEventType('order.created')).toBe(true);
    expect(isKnownEventType('order.cancelled')).toBe(false);
  });

  it('todas as routing keys usam notacao pontilhada em minusculas', () => {
    for (const eventType of ALL_EVENT_TYPES) {
      expect(eventType).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });
});

describe('order.created', () => {
  const valid = {
    ...envelope(EVENT_TYPES.ORDER_CREATED),
    payload: {
      orderId: ORDER_ID,
      customerId: 'CUSTOMER-001',
      total: 250.5,
      items: [{ sku: 'SKU-TECLADO-001', quantity: 2, unitPrice: 125.25 }],
    },
  };

  it('aceita um evento valido', () => {
    const parsed = parseEvent(EVENT_TYPES.ORDER_CREATED, valid);
    expect(parsed.payload.orderId).toBe(ORDER_ID);
    expect(parsed.eventVersion).toBe(1);
  });

  it('rejeita pedido sem itens', () => {
    const result = safeParseEvent(EVENT_TYPES.ORDER_CREATED, {
      ...valid,
      payload: { ...valid.payload, items: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejeita quantidade zero ou negativa', () => {
    const result = safeParseEvent(EVENT_TYPES.ORDER_CREATED, {
      ...valid,
      payload: { ...valid.payload, items: [{ sku: 'SKU-1', quantity: 0, unitPrice: 10 }] },
    });
    expect(result.success).toBe(false);
  });

  it('rejeita eventId que nao seja UUID', () => {
    const result = safeParseEvent(EVENT_TYPES.ORDER_CREATED, { ...valid, eventId: 'nao-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejeita eventType divergente do schema escolhido', () => {
    const result = safeParseEvent(EVENT_TYPES.ORDER_CREATED, {
      ...valid,
      eventType: 'stock.reserved',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita occurredAt fora do formato ISO 8601 com offset', () => {
    const result = safeParseEvent(EVENT_TYPES.ORDER_CREATED, {
      ...valid,
      occurredAt: '30/07/2026 12:00',
    });
    expect(result.success).toBe(false);
  });
});

describe('eventos de estoque e pagamento', () => {
  it('valida stock.reserved', () => {
    const parsed = parseEvent(EVENT_TYPES.STOCK_RESERVED, {
      ...envelope(EVENT_TYPES.STOCK_RESERVED),
      producer: 'inventory-service',
      payload: {
        orderId: ORDER_ID,
        customerId: 'CUSTOMER-001',
        total: 250.5,
        items: [{ sku: 'SKU-TECLADO-001', quantity: 2 }],
      },
    });
    expect(parsed.payload.items).toHaveLength(1);
  });

  it('valida stock.failed com lista de SKUs indisponiveis', () => {
    const parsed = parseEvent(EVENT_TYPES.STOCK_FAILED, {
      ...envelope(EVENT_TYPES.STOCK_FAILED),
      producer: 'inventory-service',
      payload: {
        orderId: ORDER_ID,
        customerId: 'CUSTOMER-001',
        reason: 'Quantidade insuficiente',
        unavailableSkus: ['SKU-SEM-ESTOQUE'],
      },
    });
    expect(parsed.payload.unavailableSkus).toContain('SKU-SEM-ESTOQUE');
  });

  it('valida payment.approved', () => {
    const parsed = parseEvent(EVENT_TYPES.PAYMENT_APPROVED, {
      ...envelope(EVENT_TYPES.PAYMENT_APPROVED),
      producer: 'payment-service',
      payload: {
        orderId: ORDER_ID,
        paymentId: '9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f',
        amount: 250.5,
        externalReference: 'SIM-REF-0001',
      },
    });
    expect(parsed.payload.externalReference).toBe('SIM-REF-0001');
  });

  it('valida payment.failed', () => {
    const result = safeParseEvent(EVENT_TYPES.PAYMENT_FAILED, {
      ...envelope(EVENT_TYPES.PAYMENT_FAILED),
      producer: 'payment-service',
      payload: {
        orderId: ORDER_ID,
        paymentId: '9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f',
        amount: 250.5,
        reason: 'Cliente de teste com recusa deterministica',
      },
    });
    expect(result.success).toBe(true);
  });

  it('valida stock.release.requested e stock.released', () => {
    expect(
      safeParseEvent(EVENT_TYPES.STOCK_RELEASE_REQUESTED, {
        ...envelope(EVENT_TYPES.STOCK_RELEASE_REQUESTED),
        payload: { orderId: ORDER_ID, reason: 'payment.failed' },
      }).success
    ).toBe(true);

    expect(
      safeParseEvent(EVENT_TYPES.STOCK_RELEASED, {
        ...envelope(EVENT_TYPES.STOCK_RELEASED),
        producer: 'inventory-service',
        payload: { orderId: ORDER_ID, releasedItems: [{ sku: 'SKU-1', quantity: 2 }] },
      }).success
    ).toBe(true);
  });
});
