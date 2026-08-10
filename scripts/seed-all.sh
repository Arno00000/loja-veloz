#!/usr/bin/env bash
# =============================================================================
# Aplica migrations e popula o catálogo determinístico de estoque.
#
# Uso local (fora do Compose), com as três DATABASE_URL apontando para
# localhost — ver os arquivos apps/*/.env.example:
#
#   bash scripts/seed-all.sh
#
# No Docker Compose isto NÃO é necessário: os serviços *-migrate já fazem
# migrations e seed automaticamente na subida.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

echo "1/3 Gerando o Prisma Client dos três serviços..."
npm run prisma:generate

echo
echo "2/3 Aplicando migrations..."
# `migrate deploy` só aplica migrations já versionadas. Se ainda não existem,
# crie a inicial com: cd apps/<serviço> && npx prisma migrate dev --name init
npm run prisma:migrate:deploy

echo
echo "3/3 Populando o catálogo de estoque..."
npm run seed -w @loja-veloz/inventory-service

echo
echo "Concluído. SKUs de demonstração disponíveis:"
echo "  SKU-TECLADO-001    100 unidades"
echo "  SKU-MOUSE-002      150 unidades"
echo "  SKU-MONITOR-003     40 unidades"
echo "  SKU-HEADSET-004     60 unidades"
echo "  SKU-WEBCAM-005      25 unidades"
echo "  SKU-ESTOQUE-BAIXO    2 unidades  (cenário de saldo insuficiente)"
echo "  SKU-SEM-ESTOQUE      0 unidades  (cenário de falha de estoque)"
