import { randomUUID } from 'node:crypto';
import { NotFoundError } from '@loja-veloz/observability';
import { InventoryService } from '../services/inventory.service';
import { InMemoryInventoryRepository, RecordingPublisher, silentLogger } from './fakes';

const ORDER_ID = '5b1f0f6c-2c9a-4f0f-9a6e-0b8f1c2d3e4f';
const CORRELATION = 'corr-estoque-001';

function build(
  seed = [
    { sku: 'SKU-TECLADO-001', availableQuantity: 10 },
    { sku: 'SKU-MOUSE-002', availableQuantity: 5 },
    { sku: 'SKU-SEM-ESTOQUE', availableQuantity: 0 },
    { sku: 'SKU-ESTOQUE-BAIXO', availableQuantity: 2 },
  ]
) {
  const repository = new InMemoryInventoryRepository(seed);
  const publisher = new RecordingPublisher();
  const service = new InventoryService({
    repository,
    publisher: publisher.asPublisher(),
    logger: silentLogger,
  });
  return { repository, publisher, service };
}

function orderCreated(items: Array<{ sku: string; quantity: number }>, eventId = randomUUID()) {
  return {
    eventId,
    eventType: 'order.created',
    orderId: ORDER_ID,
    customerId: 'CUSTOMER-001',
    total: 100,
    items,
    correlationId: CORRELATION,
  };
}

describe('consulta de estoque', () => {
  it('devolve o saldo do SKU', async () => {
    const { service } = build();
    const item = await service.getBySku('SKU-TECLADO-001');
    expect(item.availableQuantity).toBe(10);
    expect(item.reservedQuantity).toBe(0);
  });

  it('lanca NotFoundError para SKU inexistente', async () => {
    const { service } = build();
    await expect(service.getBySku('SKU-INEXISTENTE')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('reserva de estoque', () => {
  it('reserva todos os itens e publica stock.reserved', async () => {
    const { service, publisher, repository } = build();

    const result = await service.handleOrderCreated(
      orderCreated([
        { sku: 'SKU-TECLADO-001', quantity: 2 },
        { sku: 'SKU-MOUSE-002', quantity: 1 },
      ])
    );

    expect(result.status).toBe('reserved');
    expect(publisher.typesPublished()).toEqual(['stock.reserved']);

    const teclado = await repository.findBySku('SKU-TECLADO-001');
    expect(teclado?.availableQuantity).toBe(8);
    expect(teclado?.reservedQuantity).toBe(2);
  });

  it('mantem a soma disponivel + reservado constante', async () => {
    const { service, repository } = build();
    const before = await repository.findBySku('SKU-TECLADO-001');
    const totalBefore = (before?.availableQuantity ?? 0) + (before?.reservedQuantity ?? 0);

    await service.handleOrderCreated(orderCreated([{ sku: 'SKU-TECLADO-001', quantity: 3 }]));

    const after = await repository.findBySku('SKU-TECLADO-001');
    const totalAfter = (after?.availableQuantity ?? 0) + (after?.reservedQuantity ?? 0);
    expect(totalAfter).toBe(totalBefore);
  });
});

describe('falha de estoque deterministica', () => {
  it('recusa SKU-SEM-ESTOQUE e publica stock.failed', async () => {
    const { service, publisher } = build();

    const result = await service.handleOrderCreated(
      orderCreated([{ sku: 'SKU-SEM-ESTOQUE', quantity: 1 }])
    );

    expect(result.status).toBe('failed');
    expect(publisher.typesPublished()).toEqual(['stock.failed']);
    expect(publisher.published[0]?.unavailableSkus).toEqual(['SKU-SEM-ESTOQUE']);
  });

  it('recusa quando a quantidade pedida excede o saldo', async () => {
    const { service, publisher } = build();

    const result = await service.handleOrderCreated(
      orderCreated([{ sku: 'SKU-ESTOQUE-BAIXO', quantity: 3 }])
    );

    expect(result.status).toBe('failed');
    expect(publisher.published[0]?.unavailableSkus).toEqual(['SKU-ESTOQUE-BAIXO']);
  });

  it('reserva e tudo-ou-nada: um item indisponivel nao consome os demais', async () => {
    const { service, repository } = build();

    await service.handleOrderCreated(
      orderCreated([
        { sku: 'SKU-TECLADO-001', quantity: 2 },
        { sku: 'SKU-SEM-ESTOQUE', quantity: 1 },
      ])
    );

    const teclado = await repository.findBySku('SKU-TECLADO-001');
    expect(teclado?.availableQuantity).toBe(10);
    expect(teclado?.reservedQuantity).toBe(0);
  });

  it('recusa SKU que nao existe no catalogo', async () => {
    const { service, publisher } = build();
    const result = await service.handleOrderCreated(
      orderCreated([{ sku: 'SKU-FANTASMA', quantity: 1 }])
    );

    expect(result.status).toBe('failed');
    expect(publisher.published[0]?.unavailableSkus).toEqual(['SKU-FANTASMA']);
  });
});

describe('liberacao de reserva', () => {
  it('devolve as quantidades e publica stock.released', async () => {
    const { service, publisher, repository } = build();
    await service.handleOrderCreated(orderCreated([{ sku: 'SKU-TECLADO-001', quantity: 4 }]));

    const result = await service.handleReleaseRequested({
      eventId: randomUUID(),
      eventType: 'stock.release.requested',
      orderId: ORDER_ID,
      correlationId: CORRELATION,
    });

    expect(result.status).toBe('released');
    expect(publisher.typesPublished()).toEqual(['stock.reserved', 'stock.released']);

    const teclado = await repository.findBySku('SKU-TECLADO-001');
    expect(teclado?.availableQuantity).toBe(10);
    expect(teclado?.reservedQuantity).toBe(0);
  });

  it('nao faz nada quando nao existe reserva ativa', async () => {
    const { service, publisher } = build();

    const result = await service.handleReleaseRequested({
      eventId: randomUUID(),
      eventType: 'stock.release.requested',
      orderId: ORDER_ID,
      correlationId: CORRELATION,
    });

    expect(result.status).toBe('ignored');
    expect(result.reason).toBe('nothing_to_release');
    expect(publisher.published).toHaveLength(0);
  });
});

describe('idempotencia', () => {
  it('ignora order.created duplicado sem reservar duas vezes', async () => {
    const { service, publisher, repository } = build();
    const eventId = randomUUID();

    const first = await service.handleOrderCreated(
      orderCreated([{ sku: 'SKU-TECLADO-001', quantity: 3 }], eventId)
    );
    const second = await service.handleOrderCreated(
      orderCreated([{ sku: 'SKU-TECLADO-001', quantity: 3 }], eventId)
    );

    expect(first.status).toBe('reserved');
    expect(second.status).toBe('duplicate');
    expect(publisher.typesPublished()).toEqual(['stock.reserved']);

    const teclado = await repository.findBySku('SKU-TECLADO-001');
    expect(teclado?.availableQuantity).toBe(7);
  });

  it('ignora pedido de liberacao duplicado', async () => {
    const { service, repository } = build();
    await service.handleOrderCreated(orderCreated([{ sku: 'SKU-TECLADO-001', quantity: 2 }]));

    const eventId = randomUUID();
    const first = await service.handleReleaseRequested({
      eventId,
      eventType: 'stock.release.requested',
      orderId: ORDER_ID,
      correlationId: CORRELATION,
    });
    const second = await service.handleReleaseRequested({
      eventId,
      eventType: 'stock.release.requested',
      orderId: ORDER_ID,
      correlationId: CORRELATION,
    });

    expect(first.status).toBe('released');
    expect(second.status).toBe('duplicate');

    const teclado = await repository.findBySku('SKU-TECLADO-001');
    expect(teclado?.availableQuantity).toBe(10);
  });
});

describe('reposicao academica', () => {
  it('incrementa o saldo de um SKU existente', async () => {
    const { service } = build();
    const item = await service.restock('SKU-SEM-ESTOQUE', 5);
    expect(item.availableQuantity).toBe(5);
  });

  it('cria o SKU quando ele ainda nao existe', async () => {
    const { service } = build();
    const item = await service.restock('SKU-NOVO-999', 7, 'Item novo');
    expect(item.sku).toBe('SKU-NOVO-999');
    expect(item.availableQuantity).toBe(7);
  });
});
