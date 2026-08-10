import type { IdempotencyStore } from '@loja-veloz/messaging';
import type { PrismaClient } from '../db/prisma';

/**
 * Guarda previa de idempotencia. A garantia forte vem do INSERT em
 * processed_events dentro da transacao de registro do pagamento, em
 * PrismaPaymentRepository.record.
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
