/**
 * Testes de integração do fluxo de pedidos.
 *
 * Exercitam a stack REAL definida em docker-compose.test.yml: PostgreSQL,
 * RabbitMQ e os quatro serviços. Nenhum mock — o objetivo é justamente
 * validar aquilo que os testes unitários não conseguem: a travessia de
 * processo, o roteamento no broker e o efeito no banco.
 *
 * Pré-requisito:
 *   docker compose -f docker-compose.test.yml up --build -d --wait
 *
 * Determinismo: os cenários de falha usam SKU-SEM-ESTOQUE (saldo 0 no seed) e
 * CUSTOMER-PAYMENT-FAIL (recusa configurada). Nenhuma aleatoriedade.
 */
import {
  get,
  post,
  waitFor,
  waitForOrderStatus,
  waitForStack,
  type OrderResponse,
} from './helpers/http';

const SKU_OK = 'SKU-TECLADO-001';
const SKU_OK_2 = 'SKU-MOUSE-002';
const SKU_SEM_ESTOQUE = 'SKU-SEM-ESTOQUE';
const CLIENTE_OK = 'CUSTOMER-INTEGRACAO';
const CLIENTE_RECUSA = 'CUSTOMER-PAYMENT-FAIL';

interface InventoryResponse {
  sku: string;
  availableQuantity: number;
  reservedQuantity: number;
}

interface PaymentResponse {
  orderId: string;
  status: string;
  amount: number;
  failureReason: string | null;
}

function orderBody(customerId: string, items: Array<{ sku: string; quantity: number }>) {
  return {
    customerId,
    items: items.map((item) => ({ ...item, unitPrice: 100 })),
  };
}

beforeAll(async () => {
  await waitForStack();
}, 130000);

describe('1. Saúde da stack', () => {
  it('liveness do Gateway responde 200', async () => {
    const response = await get('/health/live');
    expect(response.status).toBe(200);
  });

  it('readiness do Gateway responde 200 com tudo no ar', async () => {
    const response = await get('/health/ready');
    expect(response.status).toBe(200);
  });

  it('o seed determinístico foi aplicado', async () => {
    const ok = await get<InventoryResponse>(`/api/inventory/${SKU_OK}`);
    expect(ok.status).toBe(200);
    expect(ok.body.availableQuantity).toBeGreaterThan(0);

    const semEstoque = await get<InventoryResponse>(`/api/inventory/${SKU_SEM_ESTOQUE}`);
    expect(semEstoque.status).toBe(200);
    expect(semEstoque.body.availableQuantity).toBe(0);
  });
});

describe('2. Fluxo de sucesso: PENDING -> STOCK_RESERVED -> CONFIRMED', () => {
  it('cria o pedido e o leva até CONFIRMED', async () => {
    const before = await get<InventoryResponse>(`/api/inventory/${SKU_OK}`);
    const disponivelAntes = before.body.availableQuantity;

    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_OK, [
        { sku: SKU_OK, quantity: 2 },
        { sku: SKU_OK_2, quantity: 1 },
      ])
    );

    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');
    expect(created.body.total).toBe(300);

    const final = await waitForOrderStatus(created.body.id, 'CONFIRMED');
    expect(final.status).toBe('CONFIRMED');

    // O estoque saiu de disponível e permaneceu reservado: pedido confirmado
    // não devolve quantidade.
    const after = await get<InventoryResponse>(`/api/inventory/${SKU_OK}`);
    expect(after.body.availableQuantity).toBe(disponivelAntes - 2);
    expect(after.body.reservedQuantity).toBeGreaterThanOrEqual(2);
  });

  it('registra o pagamento aprovado', async () => {
    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_OK, [{ sku: SKU_OK, quantity: 1 }])
    );
    await waitForOrderStatus(created.body.id, 'CONFIRMED');

    const payment = await get<PaymentResponse>(`/api/payments/${created.body.id}`);
    expect(payment.status).toBe(200);
    expect(payment.body.status).toBe('APPROVED');
    expect(payment.body.amount).toBe(100);
  });

  it('o pedido aparece na listagem', async () => {
    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_OK, [{ sku: SKU_OK, quantity: 1 }])
    );

    const list = await get<{ data: OrderResponse[]; pagination: { total: number } }>(
      `/api/orders?customerId=${CLIENTE_OK}&pageSize=100`
    );

    expect(list.status).toBe(200);
    expect(list.body.data.some((order) => order.id === created.body.id)).toBe(true);
  });

  it('propaga o correlationId enviado pelo cliente', async () => {
    const correlationId = `integracao-${Date.now()}`;
    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_OK, [{ sku: SKU_OK, quantity: 1 }]),
      correlationId
    );

    expect(created.headers.get('x-correlation-id')).toBe(correlationId);
  });
});

describe('3. Falha de estoque: PENDING -> STOCK_FAILED', () => {
  it('recusa o pedido de SKU sem saldo', async () => {
    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_OK, [{ sku: SKU_SEM_ESTOQUE, quantity: 1 }])
    );

    expect(created.status).toBe(201);
    const final = await waitForOrderStatus(created.body.id, 'STOCK_FAILED');
    expect(final.status).toBe('STOCK_FAILED');
  });

  it('não gera pagamento quando o estoque falha', async () => {
    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_OK, [{ sku: SKU_SEM_ESTOQUE, quantity: 1 }])
    );
    await waitForOrderStatus(created.body.id, 'STOCK_FAILED');

    const payment = await get(`/api/payments/${created.body.id}`);
    expect(payment.status).toBe(404);
  });

  it('reserva é tudo-ou-nada: item indisponível não consome os demais', async () => {
    const before = await get<InventoryResponse>(`/api/inventory/${SKU_OK}`);

    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_OK, [
        { sku: SKU_OK, quantity: 1 },
        { sku: SKU_SEM_ESTOQUE, quantity: 1 },
      ])
    );
    await waitForOrderStatus(created.body.id, 'STOCK_FAILED');

    const after = await get<InventoryResponse>(`/api/inventory/${SKU_OK}`);
    expect(after.body.availableQuantity).toBe(before.body.availableQuantity);
  });
});

describe('4. Falha de pagamento: STOCK_RESERVED -> PAYMENT_FAILED + liberação', () => {
  it('recusa o cliente de demonstração e devolve o estoque', async () => {
    const before = await get<InventoryResponse>(`/api/inventory/${SKU_OK}`);

    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_RECUSA, [{ sku: SKU_OK, quantity: 3 }])
    );
    expect(created.status).toBe(201);

    const final = await waitForOrderStatus(created.body.id, 'PAYMENT_FAILED');
    expect(final.status).toBe('PAYMENT_FAILED');

    // O estoque volta ao saldo original: stock.release.requested foi
    // publicado e o Estoque devolveu a reserva.
    const { body: after } = await waitFor(
      () => get<InventoryResponse>(`/api/inventory/${SKU_OK}`),
      (response) => response.body.availableQuantity === before.body.availableQuantity,
      { timeoutMs: 30000, description: 'estoque devolvido após falha de pagamento' }
    );

    expect(after.availableQuantity).toBe(before.body.availableQuantity);
  });

  it('registra o pagamento recusado com o motivo', async () => {
    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_RECUSA, [{ sku: SKU_OK, quantity: 1 }])
    );
    await waitForOrderStatus(created.body.id, 'PAYMENT_FAILED');

    const payment = await get<PaymentResponse>(`/api/payments/${created.body.id}`);
    expect(payment.status).toBe(200);
    expect(payment.body.status).toBe('FAILED');
    expect(payment.body.failureReason).toBeTruthy();
  });

  it('o estado final permanece PAYMENT_FAILED após stock.released', async () => {
    const created = await post<OrderResponse>(
      '/api/orders',
      orderBody(CLIENTE_RECUSA, [{ sku: SKU_OK, quantity: 1 }])
    );
    await waitForOrderStatus(created.body.id, 'PAYMENT_FAILED');

    // stock.released alimenta apenas a trilha de auditoria; se ele alterasse
    // o estado, este teste falharia.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const again = await get<OrderResponse>(`/api/orders/${created.body.id}`);
    expect(again.body.status).toBe('PAYMENT_FAILED');
  });
});

describe('5. Validação e erros', () => {
  it.each([
    ['sem customerId', { items: [{ sku: SKU_OK, quantity: 1, unitPrice: 10 }] }],
    ['sem itens', { customerId: CLIENTE_OK, items: [] }],
    [
      'quantidade zero',
      { customerId: CLIENTE_OK, items: [{ sku: SKU_OK, quantity: 0, unitPrice: 10 }] },
    ],
    [
      'preço negativo',
      { customerId: CLIENTE_OK, items: [{ sku: SKU_OK, quantity: 1, unitPrice: -1 }] },
    ],
  ])('rejeita payload inválido: %s', async (_label, body) => {
    const response = await post('/api/orders', body);
    expect(response.status).toBe(400);
  });

  it('responde 404 para pedido inexistente', async () => {
    const response = await get('/api/orders/00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
  });

  it('responde 400 para id de pedido malformado', async () => {
    const response = await get('/api/orders/nao-e-uuid');
    expect(response.status).toBe(400);
  });

  it('responde 404 para SKU inexistente', async () => {
    const response = await get('/api/inventory/SKU-QUE-NAO-EXISTE');
    expect(response.status).toBe(404);
  });

  it('não expõe a rota de reposição pelo Gateway', async () => {
    const response = await post('/api/inventory/restock', { sku: SKU_OK, quantity: 10 });
    expect(response.status).toBe(404);
  });
});

describe('6. Idempotência sob concorrência', () => {
  it('pedidos simultâneos não vendem além do saldo', async () => {
    // SKU-ESTOQUE-BAIXO tem saldo 2 no seed. Cinco pedidos de 1 unidade
    // disparados juntos: no máximo 2 podem ser confirmados.
    const requests = Array.from({ length: 5 }, () =>
      post<OrderResponse>(
        '/api/orders',
        orderBody(CLIENTE_OK, [{ sku: 'SKU-ESTOQUE-BAIXO', quantity: 1 }])
      )
    );

    const created = await Promise.all(requests);
    expect(created.every((response) => response.status === 201)).toBe(true);

    const finals = await Promise.all(
      created.map((response) =>
        waitForOrderStatus(
          response.body.id,
          ['STOCK_RESERVED', 'CONFIRMED', 'STOCK_FAILED', 'PAYMENT_FAILED'],
          45000
        )
      )
    );

    const comReserva = finals.filter((order) =>
      ['STOCK_RESERVED', 'CONFIRMED', 'PAYMENT_FAILED'].includes(order.status)
    );
    const semEstoque = finals.filter((order) => order.status === 'STOCK_FAILED');

    expect(comReserva.length).toBeLessThanOrEqual(2);
    expect(comReserva.length + semEstoque.length).toBe(5);

    const inventory = await get<InventoryResponse>('/api/inventory/SKU-ESTOQUE-BAIXO');
    // O saldo nunca fica negativo: é o UPDATE condicional que garante isso.
    expect(inventory.body.availableQuantity).toBeGreaterThanOrEqual(0);
  });
});
