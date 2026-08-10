import { randomUUID } from 'node:crypto';
import { ORDER_STATUS } from '@loja-veloz/shared-types';
import { NotFoundError } from '@loja-veloz/observability';
import { OrderService, calculateTotal } from '../services/order.service';
import { InMemoryOrderRepository, RecordingPublisher, silentLogger } from './fakes';

const CORRELATION = 'corr-teste-001';

function build() {
  const repository = new InMemoryOrderRepository();
  const publisher = new RecordingPublisher();
  const service = new OrderService({
    repository,
    publisher: publisher.asPublisher(),
    logger: silentLogger,
  });
  return { repository, publisher, service };
}

const validInput = {
  customerId: 'CUSTOMER-001',
  items: [
    { sku: 'SKU-TECLADO-001', quantity: 2, unitPrice: 125.25 },
    { sku: 'SKU-MOUSE-002', quantity: 1, unitPrice: 79.9 },
  ],
};

describe('calculateTotal', () => {
  it('soma em centavos para evitar erro de ponto flutuante', () => {
    expect(calculateTotal([{ quantity: 3, unitPrice: 0.1 }])).toBe(0.3);
    expect(calculateTotal([{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }])).toBe(
      0.3
    );
  });

  it('multiplica preco unitario pela quantidade', () => {
    expect(calculateTotal(validInput.items)).toBe(330.4);
  });

  it('retorna zero para lista vazia', () => {
    expect(calculateTotal([])).toBe(0);
  });
});

describe('criacao de pedido', () => {
  it('persiste em PENDING e publica order.created', async () => {
    const { service, publisher } = build();
    const order = await service.createOrder(validInput, CORRELATION);

    expect(order.status).toBe(ORDER_STATUS.PENDING);
    expect(order.total).toBe(330.4);
    expect(order.items).toHaveLength(2);
    expect(publisher.typesPublished()).toEqual(['order.created']);
    expect(publisher.published[0]?.correlationId).toBe(CORRELATION);
  });

  it('recupera o pedido criado por id', async () => {
    const { service } = build();
    const created = await service.createOrder(validInput, CORRELATION);
    const found = await service.getOrder(created.id);
    expect(found.id).toBe(created.id);
  });

  it('lanca NotFoundError para pedido inexistente', async () => {
    const { service } = build();
    await expect(service.getOrder(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('pagina a listagem e permite filtrar por status', async () => {
    const { service } = build();
    for (let i = 0; i < 5; i += 1) {
      await service.createOrder(validInput, CORRELATION);
    }

    const page1 = await service.listOrders({ page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    const filtered = await service.listOrders({
      page: 1,
      pageSize: 10,
      status: ORDER_STATUS.CONFIRMED,
    });
    expect(filtered.data).toHaveLength(0);
    expect(filtered.pagination.totalPages).toBe(0);
  });
});

describe('fluxo de sucesso', () => {
  it('PENDING -> STOCK_RESERVED -> CONFIRMED e publica order.confirmed', async () => {
    const { service, publisher } = build();
    const order = await service.createOrder(validInput, CORRELATION);

    const reserved = await service.handleStockReserved(randomUUID(), order.id, CORRELATION);
    expect(reserved.status).toBe('applied');
    expect((await service.getOrder(order.id)).status).toBe(ORDER_STATUS.STOCK_RESERVED);

    const confirmed = await service.handlePaymentApproved(randomUUID(), order.id, CORRELATION);
    expect(confirmed.status).toBe('applied');
    expect((await service.getOrder(order.id)).status).toBe(ORDER_STATUS.CONFIRMED);

    expect(publisher.typesPublished()).toEqual(['order.created', 'order.confirmed']);
  });
});

describe('falha de estoque', () => {
  it('PENDING -> STOCK_FAILED e publica order.failed', async () => {
    const { service, publisher } = build();
    const order = await service.createOrder(validInput, CORRELATION);

    const result = await service.handleStockFailed(
      randomUUID(),
      order.id,
      'Quantidade insuficiente para SKU-SEM-ESTOQUE',
      CORRELATION
    );

    expect(result.status).toBe('applied');
    expect((await service.getOrder(order.id)).status).toBe(ORDER_STATUS.STOCK_FAILED);
    expect(publisher.typesPublished()).toEqual(['order.created', 'order.failed']);
    expect(publisher.published[1]?.reason).toContain('SKU-SEM-ESTOQUE');
  });

  it('nao pede liberacao de estoque quando a falha foi do proprio estoque', async () => {
    const { service, publisher } = build();
    const order = await service.createOrder(validInput, CORRELATION);
    await service.handleStockFailed(randomUUID(), order.id, 'sem estoque', CORRELATION);

    expect(publisher.typesPublished()).not.toContain('stock.release.requested');
  });
});

describe('falha de pagamento', () => {
  it('STOCK_RESERVED -> PAYMENT_FAILED, publica order.failed e pede liberacao', async () => {
    const { service, publisher } = build();
    const order = await service.createOrder(validInput, CORRELATION);
    await service.handleStockReserved(randomUUID(), order.id, CORRELATION);

    const result = await service.handlePaymentFailed(
      randomUUID(),
      order.id,
      'Cliente de teste com recusa deterministica',
      CORRELATION
    );

    expect(result.status).toBe('applied');
    expect((await service.getOrder(order.id)).status).toBe(ORDER_STATUS.PAYMENT_FAILED);
    expect(publisher.typesPublished()).toEqual([
      'order.created',
      'order.failed',
      'stock.release.requested',
    ]);
  });

  it('o estado final permanece PAYMENT_FAILED apos a liberacao do estoque', async () => {
    const { service } = build();
    const order = await service.createOrder(validInput, CORRELATION);
    await service.handleStockReserved(randomUUID(), order.id, CORRELATION);
    await service.handlePaymentFailed(randomUUID(), order.id, 'recusado', CORRELATION);

    // stock.released e consumido apenas pela trilha de auditoria e nao chama
    // nenhuma transicao, entao o estado nao muda.
    expect((await service.getOrder(order.id)).status).toBe(ORDER_STATUS.PAYMENT_FAILED);
  });
});

describe('idempotencia', () => {
  it('ignora o mesmo eventId entregue duas vezes', async () => {
    const { service, repository } = build();
    const order = await service.createOrder(validInput, CORRELATION);
    const eventId = randomUUID();

    const first = await service.handleStockReserved(eventId, order.id, CORRELATION);
    const second = await service.handleStockReserved(eventId, order.id, CORRELATION);

    expect(first.status).toBe('applied');
    expect(second.status).toBe('duplicate');
    expect((await service.getOrder(order.id)).status).toBe(ORDER_STATUS.STOCK_RESERVED);
    expect(repository.processedEventCount).toBe(1);
  });

  it('nao publica o evento de saida duas vezes em entrega duplicada', async () => {
    const { service, publisher } = build();
    const order = await service.createOrder(validInput, CORRELATION);
    await service.handleStockReserved(randomUUID(), order.id, CORRELATION);

    const eventId = randomUUID();
    await service.handlePaymentApproved(eventId, order.id, CORRELATION);
    await service.handlePaymentApproved(eventId, order.id, CORRELATION);

    const confirmations = publisher.typesPublished().filter((type) => type === 'order.confirmed');
    expect(confirmations).toHaveLength(1);
  });
});

describe('eventos fora de ordem e anomalias', () => {
  it('rejeita pagamento aprovado antes da reserva de estoque', async () => {
    const { service, publisher } = build();
    const order = await service.createOrder(validInput, CORRELATION);

    const result = await service.handlePaymentApproved(randomUUID(), order.id, CORRELATION);

    expect(result.status).toBe('ignored');
    expect(result.reason).toBe('invalid_transition');
    expect((await service.getOrder(order.id)).status).toBe(ORDER_STATUS.PENDING);
    expect(publisher.typesPublished()).toEqual(['order.created']);
  });

  it('rejeita nova transicao a partir de um estado terminal', async () => {
    const { service } = build();
    const order = await service.createOrder(validInput, CORRELATION);
    await service.handleStockFailed(randomUUID(), order.id, 'sem estoque', CORRELATION);

    const result = await service.handleStockReserved(randomUUID(), order.id, CORRELATION);

    expect(result.status).toBe('ignored');
    expect(result.reason).toBe('invalid_transition');
    expect((await service.getOrder(order.id)).status).toBe(ORDER_STATUS.STOCK_FAILED);
  });

  it('absorve evento para pedido inexistente sem lancar', async () => {
    const { service } = build();
    const result = await service.handleStockReserved(randomUUID(), randomUUID(), CORRELATION);

    expect(result.status).toBe('ignored');
    expect(result.reason).toBe('order_not_found');
  });
});
