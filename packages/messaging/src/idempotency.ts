/**
 * Contrato de idempotencia dos consumidores.
 *
 * O RabbitMQ oferece entrega "ao menos uma vez". Um mesmo `eventId` pode
 * chegar mais de uma vez: reconexao apos falha de rede, redelivery depois de
 * um nack, ou retry apos um erro transitorio que na verdade ja tinha aplicado
 * o efeito no banco. Nao existe "exatamente uma vez" nesse desenho.
 *
 * A defesa e registrar `eventId` em uma tabela com chave unica e ignorar o
 * evento quando ele ja consta ali.
 *
 * Duas formas de uso, em ordem de robustez:
 *
 * 1. Transacional (preferida). O handler grava o `ProcessedEvent` dentro da
 *    MESMA transacao que aplica o efeito de negocio. Se a transacao falhar,
 *    nada acontece; se o evento chegar de novo, a violacao da chave unica
 *    identifica a duplicata. E o que os servicos deste projeto fazem.
 *
 * 2. Guarda previa (complementar). O consumidor consulta `wasProcessed` antes
 *    de chamar o handler. Isso evita trabalho desnecessario, mas sozinho tem
 *    uma janela de corrida entre a consulta e a gravacao, e por isso nunca
 *    substitui a forma 1.
 */
export interface IdempotencyStore {
  wasProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string, eventType: string): Promise<void>;
}

/**
 * Implementacao em memoria, usada apenas em testes unitarios.
 * Nao serve para producao: nao sobrevive a reinicio e nao e compartilhada
 * entre replicas.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly processed = new Map<string, string>();

  async wasProcessed(eventId: string): Promise<boolean> {
    return this.processed.has(eventId);
  }

  async markProcessed(eventId: string, eventType: string): Promise<void> {
    this.processed.set(eventId, eventType);
  }

  get size(): number {
    return this.processed.size;
  }

  clear(): void {
    this.processed.clear();
  }
}

/**
 * Codigo de erro do PostgreSQL para violacao de restricao unica.
 * Usado pelos servicos para converter a colisao de `eventId` em
 * "evento duplicado" em vez de erro generico.
 */
export const PG_UNIQUE_VIOLATION = 'P2002';
