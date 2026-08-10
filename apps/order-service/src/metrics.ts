import { createCounter } from '@loja-veloz/observability';

/**
 * Metricas de negocio do Servico de Pedidos.
 *
 * Nenhum label carrega identificador de pedido ou de cliente: os valores
 * possiveis sao poucos e conhecidos de antemao (status e motivos), o que
 * mantem a cardinalidade sob controle.
 */
export const ordersCreatedTotal = createCounter({
  name: 'orders_created_total',
  help: 'Total de pedidos criados',
});

export const ordersConfirmedTotal = createCounter({
  name: 'orders_confirmed_total',
  help: 'Total de pedidos que chegaram ao estado CONFIRMED',
});

export const ordersFailedTotal = createCounter({
  name: 'orders_failed_total',
  help: 'Total de pedidos que terminaram em falha',
  labelNames: ['reason'] as const,
});

export const orderTransitionsTotal = createCounter({
  name: 'orders_state_transitions_total',
  help: 'Total de transicoes de estado aplicadas',
  labelNames: ['from', 'to'] as const,
});

export const orderInvalidTransitionsTotal = createCounter({
  name: 'orders_invalid_transitions_total',
  help: 'Total de transicoes rejeitadas pela maquina de estados',
  labelNames: ['from', 'to'] as const,
});

export const orderEventsIgnoredTotal = createCounter({
  name: 'orders_events_ignored_total',
  help: 'Total de eventos ignorados por duplicidade ou por pedido inexistente',
  labelNames: ['reason'] as const,
});
