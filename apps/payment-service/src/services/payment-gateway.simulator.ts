import { randomUUID } from 'node:crypto';

export interface SimulatorOptions {
  /** Quando false, o simulador aprova todos os pagamentos. */
  simulationEnabled: boolean;
  /** Cliente cujos pedidos sao sempre recusados, para demonstracao. */
  failCustomerId: string;
  /** Latencia artificial, em milissegundos. */
  processingDelayMs: number;
}

export type SimulationResult =
  | { approved: true; externalReference: string }
  | { approved: false; reason: string };

export const DEMO_FAILURE_REASON =
  'Pagamento recusado pelo simulador: cliente de demonstracao com recusa deterministica';

/**
 * Simulador de provedor de pagamento.
 *
 * Substitui uma integracao real (Stripe, Mercado Pago, PagSeguro) sem exigir
 * conta, credencial ou chamada externa paga. O projeto inteiro roda offline.
 *
 * A decisao e DETERMINISTICA: nao ha `Math.random` em lugar nenhum. Uma
 * recusa aleatoria tornaria os testes de integracao instaveis e a
 * demonstracao impossivel de reproduzir. A unica regra de recusa e a
 * comparacao com `failCustomerId`, e ela pode ser desligada por configuracao.
 *
 * Isto e um recurso de demonstracao, nao um modelo de risco de credito.
 */
export class PaymentGatewaySimulator {
  constructor(private readonly options: SimulatorOptions) {}

  async authorize(params: { orderId: string; customerId: string; amount: number }): Promise<
    SimulationResult
  > {
    if (this.options.processingDelayMs > 0) {
      await delay(this.options.processingDelayMs);
    }

    if (this.options.simulationEnabled && params.customerId === this.options.failCustomerId) {
      return { approved: false, reason: DEMO_FAILURE_REASON };
    }

    return {
      approved: true,
      // Formato estavel e previsivel, imitando o identificador que um
      // provedor externo devolveria.
      externalReference: `SIM-${randomUUID()}`,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}
