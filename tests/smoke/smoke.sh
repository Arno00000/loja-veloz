#!/usr/bin/env bash
# =============================================================================
# Smoke tests — verificação rápida de que o essencial funciona após um deploy.
#
# Não substitui os testes de integração: valida o caminho crítico em poucos
# segundos, para decidir se um deploy fica de pé ou volta.
#
# Uso:
#   bash tests/smoke/smoke.sh
#   GATEWAY_URL=http://localhost:8080 bash tests/smoke/smoke.sh
#
# Código de saída 0 = tudo passou; 1 = alguma verificação falhou.
# É esse código que o workflow de deploy usa para decidir o rollback.
# =============================================================================
set -uo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
TIMEOUT="${SMOKE_TIMEOUT:-60}"

PASSED=0
FAILED=0

pass() { echo "  [OK]    $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  [FALHA] $1"; FAILED=$((FAILED + 1)); }

check_status() {
  local description="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$description (HTTP $actual)"
  else
    fail "$description (esperado $expected, recebido $actual)"
  fi
}

echo "Smoke tests contra ${GATEWAY_URL}"
echo

# --- 1. Disponibilidade ------------------------------------------------------
echo "1. Disponibilidade"

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${GATEWAY_URL}/health/live" || echo "000")
check_status "liveness do Gateway" "200" "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${GATEWAY_URL}/health/ready" || echo "000")
check_status "readiness do Gateway" "200" "$status"

if curl -s --max-time 10 "${GATEWAY_URL}/metrics" | grep -q "http_requests_total"; then
  pass "endpoint de métricas expõe http_requests_total"
else
  fail "endpoint de métricas não respondeu como esperado"
fi

# --- 2. Consulta de estoque --------------------------------------------------
echo
echo "2. Estoque"

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "${GATEWAY_URL}/api/inventory/SKU-TECLADO-001" || echo "000")
check_status "consulta de SKU existente" "200" "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "${GATEWAY_URL}/api/inventory/SKU-QUE-NAO-EXISTE" || echo "000")
check_status "SKU inexistente devolve 404" "404" "$status"

# --- 3. Criação de pedido ----------------------------------------------------
echo
echo "3. Fluxo de pedido"

CORRELATION="smoke-$(date +%s)"
RESPONSE=$(curl -s --max-time 15 -X POST "${GATEWAY_URL}/api/orders" \
  -H 'content-type: application/json' \
  -H "x-correlation-id: ${CORRELATION}" \
  -d '{"customerId":"CUSTOMER-SMOKE","items":[{"sku":"SKU-TECLADO-001","quantity":1,"unitPrice":100}]}' \
  || echo '{}')

ORDER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$ORDER_ID" ]; then
  pass "pedido criado (id ${ORDER_ID})"
else
  fail "criação de pedido não devolveu id. Resposta: ${RESPONSE}"
  echo
  echo "Resultado: ${PASSED} passaram, ${FAILED} falharam"
  exit 1
fi

# O fluxo é assíncrono: aguarda o pedido sair de PENDING.
echo "  ... aguardando o estado final (até ${TIMEOUT}s)"
FINAL_STATUS=""
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  BODY=$(curl -s --max-time 10 "${GATEWAY_URL}/api/orders/${ORDER_ID}" || echo '{}')
  FINAL_STATUS=$(echo "$BODY" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  case "$FINAL_STATUS" in
    CONFIRMED|STOCK_FAILED|PAYMENT_FAILED) break ;;
  esac
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [ "$FINAL_STATUS" = "CONFIRMED" ]; then
  pass "pedido chegou a CONFIRMED em ~${ELAPSED}s"
else
  fail "pedido terminou em '${FINAL_STATUS:-PENDING}' após ${ELAPSED}s (esperado CONFIRMED)"
fi

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "${GATEWAY_URL}/api/payments/${ORDER_ID}" || echo "000")
check_status "pagamento registrado para o pedido" "200" "$status"

# --- 4. Validação ------------------------------------------------------------
echo
echo "4. Validação de entrada"

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "${GATEWAY_URL}/api/orders" \
  -H 'content-type: application/json' -d '{"customerId":""}' || echo "000")
check_status "payload inválido devolve 400" "400" "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "${GATEWAY_URL}/api/orders/00000000-0000-4000-8000-000000000000" || echo "000")
check_status "pedido inexistente devolve 404" "404" "$status"

# --- Resultado ---------------------------------------------------------------
echo
echo "Resultado: ${PASSED} passaram, ${FAILED} falharam"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
