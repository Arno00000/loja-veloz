/**
 * Seed do catalogo de estoque.
 *
 * Fica em `src/` de proposito: assim ele e compilado para `dist/seed.js` e
 * pode ser executado na imagem de producao com `node dist/seed.js`, sem
 * exigir o `tsx` (que e dependencia de desenvolvimento e nao existe na
 * imagem final). O arquivo `prisma/seed.ts` apenas aponta para este, para
 * manter o gancho `prisma db seed` funcionando em desenvolvimento.
 *
 * Os dados sao DETERMINISTICOS: nenhum valor aleatorio. E isso que permite
 * que os cenarios de demonstracao e os testes de integracao produzam sempre
 * o mesmo resultado.
 *
 * Cenarios cobertos:
 * - SKUs com saldo suficiente, usados no fluxo de sucesso;
 * - SKU-SEM-ESTOQUE com saldo ZERO, para forcar stock.failed;
 * - SKU-ESTOQUE-BAIXO com saldo 2, para demonstrar recusa quando o pedido
 *   pede mais do que existe.
 *
 * O seed e idempotente: o update fixa a quantidade em vez de incrementar,
 * entao reexecutar devolve o ambiente ao estado conhecido.
 */
import { PrismaClient } from '../generated/prisma';

export const SEED_ITEMS = [
  { sku: 'SKU-TECLADO-001', description: 'Teclado mecanico ABNT2', availableQuantity: 100 },
  { sku: 'SKU-MOUSE-002', description: 'Mouse optico 1600 DPI', availableQuantity: 150 },
  { sku: 'SKU-MONITOR-003', description: 'Monitor 24 polegadas', availableQuantity: 40 },
  { sku: 'SKU-HEADSET-004', description: 'Headset com microfone', availableQuantity: 60 },
  { sku: 'SKU-WEBCAM-005', description: 'Webcam 1080p', availableQuantity: 25 },
  { sku: 'SKU-SEM-ESTOQUE', description: 'Item sem saldo para demonstracao', availableQuantity: 0 },
  { sku: 'SKU-ESTOQUE-BAIXO', description: 'Item com saldo reduzido', availableQuantity: 2 },
] as const;

export async function runSeed(prisma: PrismaClient): Promise<number> {
  for (const item of SEED_ITEMS) {
    await prisma.inventoryItem.upsert({
      where: { sku: item.sku },
      create: {
        sku: item.sku,
        description: item.description,
        availableQuantity: item.availableQuantity,
        reservedQuantity: 0,
      },
      update: {
        description: item.description,
        availableQuantity: item.availableQuantity,
        reservedQuantity: 0,
      },
    });
  }
  return SEED_ITEMS.length;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const applied = await runSeed(prisma);
    // Saida em stderr para nao poluir stdout, reservado aos logs estruturados.
    // eslint-disable-next-line no-console
    console.error(`[seed][inventory-service] ${applied} SKUs aplicados.`);
  } finally {
    await prisma.$disconnect();
  }
}

// Executa apenas quando chamado diretamente, e nao quando importado por
// prisma/seed.ts ou por um teste.
if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[seed][inventory-service] falhou:', error);
    process.exitCode = 1;
  });
}
