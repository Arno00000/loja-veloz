/**
 * Seed do Servico de Pedidos.
 *
 * O dominio de pedidos nao precisa de dados iniciais: pedidos nascem das
 * requisicoes HTTP. Este arquivo existe para tornar isso explicito e para
 * dar um ponto unico de verificacao da conexao logo apos as migrations.
 *
 * Fica em `src/` para ser compilado e poder rodar na imagem de producao com
 * `node dist/seed.js`, sem depender do tsx.
 */
import { PrismaClient } from '../generated/prisma';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const orders = await prisma.order.count();
    const processedEvents = await prisma.processedEvent.count();
    // eslint-disable-next-line no-console
    console.error(
      `[seed][order-service] conexao verificada. pedidos=${orders} eventos_processados=${processedEvents}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[seed][order-service] falhou:', error);
    process.exitCode = 1;
  });
}
