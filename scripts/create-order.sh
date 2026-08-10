#!/usr/bin/env bash
# =============================================================================
# Cria um pedido e acompanha até o estado final. Ferramenta de demonstração.
#
# Uso:
#   bash scripts/create-order.sh                        # fluxo de sucesso
#   bash scripts/create-order.sh sem-estoque            # falha de estoque
#   bash scripts/create-order.sh falha-pagamento        # falha de pagamento
# =============================================================================
set -uo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
CENARIO="${1:-sucesso}"

case "$CENARIO" in
  sucesso)
    CUSTOMER="CUSTOMER-DEMO"
    ITEMS='[{"sku":"SKU-TECLADO-001","quantity":2,"unitPrice":125.25},{"sku":"SKU-MOUSE-002","quantity":1,"unitPrice":79.90}]'
    ESPERADO="CONFIRMED"
    ;;
  sem-estoque)
    CUSTOMER="CUSTOMER-DEMO"
    ITEMS='[{"sku":"SKU-SEM-ESTOQUE","quantity":1,"unitPrice":50.00}]'
    ESPERADO="STOCK_FAILED"
    ;;
  falha-pagamento)
    # O simulador recusa este cliente de forma determinística.
    CUSTOMER="CUSTOMER-PAYMENT-FAIL"
    ITEMS='[{"sku":"SKU-TECLADO-001","quantity":1,"unitPrice":125.25}]'
    ESPERADO="PAYMENT_FAILED"
    ;;
  *)
    echo "Cenário desconhecido: $CENARIO"
    echo "Use: sucesso | sem-estoque | falha-pagamento"
    exit 1
    ;;
esac

CORRELATION="demo-${CENARIO}-$(date +%s)"

echo "Cenário: ${CENARIO} (esperado: ${ESPERADO})"
echo "correlationId: ${CORRELATION}"
echo

RESPONSE=$(curl -s -X POST "${GATEWAY_URL}/api/orders" \
  -H 'content-type: application/json' \
  -H "x-correlation-id: ${CORRELATION}" \
  -d "{\"customerId\":\"${CUSTOMER}\",\"items\":${ITEMS}}")

ORDER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$ORDER_ID" ]; then
  echo "Falha ao criar o pedido:"
  echo "$RESPONSE"
  exit 1
fi

echo "Pedido criado: ${ORDER_ID}"
echo

for i in $(seq 1 30); do
  BODY=$(curl -s "${GATEWAY_URL}/api/orders/${ORDER_ID}")
  STATUS=$(echo "$BODY" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  printf '  [%2ds] %s\n' "$((i * 2))" "$STATUS"

  case "$STATUS" in
    CONFIRMED|STOCK_FAILED|PAYMENT_FAILED) break ;;
  esac
  sleep 2
done

echo
echo "Estado final: ${STATUS}"
if [ "$STATUS" = "$ESPERADO" ]; then
  echo "Corresponde ao esperado para o cenário."
else
  echo "AVISO: esperado ${ESPERADO}."
fi

echo
echo "Onde investigar:"
echo "  Pedido:    curl ${GATEWAY_URL}/api/orders/${ORDER_ID}"
echo "  Pagamento: curl ${GATEWAY_URL}/api/payments/${ORDER_ID}"
echo "  Logs:      Grafana > Explore > Loki > {job=\"docker\"} |= \"${CORRELATION}\""
echo "  Traces:    http://localhost:16686 (buscar por api-gateway)"
