// Client gerado por `npx prisma generate` em
// apps/inventory-service/generated/prisma (ver prisma/schema.prisma).
import { PrismaClient } from '../../generated/prisma';

export type { PrismaClient };

let client: PrismaClient | undefined;

export function getPrismaClient(databaseUrl: string): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
      log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
    });
  }
  return client;
}

export async function checkDatabase(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
