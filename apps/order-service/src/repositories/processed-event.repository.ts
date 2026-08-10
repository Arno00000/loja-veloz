import type { IdempotencyStore } from '@loja-veloz/messaging';
import type { PrismaClient } from '../db/prisma';

/**
 * Guarda previa de idempotencia consultada pelo consumidor antes de invocar o
 * handler. Evita trabalho repetido quando a duplicata e obvia.
 *
 * A garantia forte nao esta aqui: ela vem do INSERT em processed_events feito
 * dentro da mesma transacao que altera o pedido, em
 * PrismaOrderRepository.applyEvent. Esta consulta e apenas um atalho.
 */
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly prisma: PrismaClient) {}

  async wasProcessed(eventId: string): Promise<boolean> {
    const found = await this.prisma.processedEvent.findUnique({ where: { eventId } });
    return found !== null;
  }

  async markProcessed(eventId: string, eventType: string): Promise<void> {
    await this.prisma.processedEvent.create({ data: { eventId, eventType } });
  }
}
