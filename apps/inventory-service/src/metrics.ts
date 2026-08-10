import { createCounter, createGauge } from '@loja-veloz/observability';

export const stockReservationsTotal = createCounter({
  name: 'inventory_reservations_total',
  help: 'Total de reservas de estoque concluidas com sucesso',
});

export const stockReservationFailuresTotal = createCounter({
  name: 'inventory_reservation_failures_total',
  help: 'Total de tentativas de reserva recusadas',
  labelNames: ['reason'] as const,
});

export const stockReleasesTotal = createCounter({
  name: 'inventory_releases_total',
  help: 'Total de liberacoes de reserva apos falha de pagamento',
});

export const restockOperationsTotal = createCounter({
  name: 'inventory_restock_operations_total',
  help: 'Total de reposicoes realizadas pelo endpoint academico',
});

export const inventoryEventsIgnoredTotal = createCounter({
  name: 'inventory_events_ignored_total',
  help: 'Total de eventos ignorados por idempotencia ou ausencia de reserva',
  labelNames: ['reason'] as const,
});

/**
 * Numero de SKUs distintos com saldo zerado. Gauge de baixa cardinalidade:
 * um unico valor, sem label por SKU. Detalhe por SKU pertence a consulta ao
 * banco, nao ao Prometheus.
 */
export const skusOutOfStock = createGauge({
  name: 'inventory_skus_out_of_stock',
  help: 'Quantidade de SKUs com saldo disponivel igual a zero',
});
