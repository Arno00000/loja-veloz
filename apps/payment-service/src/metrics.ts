import { createCounter, createHistogram } from '@loja-veloz/observability';

export const paymentsProcessedTotal = createCounter({
  name: 'payments_processed_total',
  help: 'Total de pagamentos processados',
  labelNames: ['status'] as const,
});

export const paymentsDuplicateTotal = createCounter({
  name: 'payments_duplicate_total',
  help: 'Total de eventos de pagamento ignorados por ja terem sido processados',
});

export const paymentAuthorizationDurationSeconds = createHistogram({
  name: 'payments_authorization_duration_seconds',
  help: 'Tempo gasto na autorizacao simulada do pagamento',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});
