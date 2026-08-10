// O Prisma Client e gerado em apps/order-service/generated/prisma pelo
// comando `npx prisma generate` (ver package.json, script prisma:generate).
// O diretorio esta no .gitignore: e artefato de build, nao codigo autoral.
//
// O caminho relativo funciona tanto em src/ quanto em dist/ porque os dois
// tem a mesma profundidade a partir da raiz do servico:
//   src/db/prisma.ts   -> ../../generated/prisma
//   dist/db/prisma.js  -> ../../generated/prisma
import { PrismaClient } from '../../generated/prisma';

export type { PrismaClient };

let client: PrismaClient | undefined;

export function getPrismaClient(databaseUrl: string): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
      // Erros do Prisma sao registrados pelo logger da aplicacao, em JSON.
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }
  return client;
}

/**
 * Verificacao usada pelo readiness probe.
 * `SELECT 1` e barato e exercita a conexao de verdade, ao contrario de
 * apenas checar se o objeto do client existe.
 */
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
