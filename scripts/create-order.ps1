# =============================================================================
# Cria um pedido e acompanha até o estado final. Versão PowerShell.
#
# Uso:
#   pwsh scripts/create-order.ps1
#   pwsh scripts/create-order.ps1 -Cenario sem-estoque
#   pwsh scripts/create-order.ps1 -Cenario falha-pagamento
# =============================================================================
param(
    [ValidateSet('sucesso', 'sem-estoque', 'falha-pagamento')]
    [string]$Cenario = 'sucesso'
)

$GatewayUrl = if ($env:GATEWAY_URL) { $env:GATEWAY_URL } else { 'http://localhost:8080' }

switch ($Cenario) {
    'sucesso' {
        $customer = 'CUSTOMER-DEMO'
        $items = @(
            @{ sku = 'SKU-TECLADO-001'; quantity = 2; unitPrice = 125.25 },
            @{ sku = 'SKU-MOUSE-002'; quantity = 1; unitPrice = 79.90 }
        )
        $esperado = 'CONFIRMED'
    }
    'sem-estoque' {
        $customer = 'CUSTOMER-DEMO'
        $items = @(@{ sku = 'SKU-SEM-ESTOQUE'; quantity = 1; unitPrice = 50.00 })
        $esperado = 'STOCK_FAILED'
    }
    'falha-pagamento' {
        $customer = 'CUSTOMER-PAYMENT-FAIL'
        $items = @(@{ sku = 'SKU-TECLADO-001'; quantity = 1; unitPrice = 125.25 })
        $esperado = 'PAYMENT_FAILED'
    }
}

$correlation = "demo-$Cenario-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

Write-Host "Cenário: $Cenario (esperado: $esperado)"
Write-Host "correlationId: $correlation`n"

$body = @{ customerId = $customer; items = $items } | ConvertTo-Json -Depth 5

try {
    $created = Invoke-RestMethod -Uri "$GatewayUrl/api/orders" -Method Post `
        -ContentType 'application/json' -Body $body `
        -Headers @{ 'x-correlation-id' = $correlation } -TimeoutSec 15
} catch {
    Write-Host "Falha ao criar o pedido: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$orderId = $created.id
Write-Host "Pedido criado: $orderId`n"

$status = 'PENDING'
for ($i = 1; $i -le 30; $i++) {
    try {
        $order = Invoke-RestMethod -Uri "$GatewayUrl/api/orders/$orderId" -TimeoutSec 10
        $status = $order.status
    } catch { }

    Write-Host ("  [{0,2}s] {1}" -f ($i * 2), $status)
    if ($status -in @('CONFIRMED', 'STOCK_FAILED', 'PAYMENT_FAILED')) { break }
    Start-Sleep -Seconds 2
}

Write-Host "`nEstado final: $status"
if ($status -eq $esperado) {
    Write-Host 'Corresponde ao esperado para o cenário.'
} else {
    Write-Host "AVISO: esperado $esperado." -ForegroundColor Yellow
}

Write-Host "`nOnde investigar:"
Write-Host "  Pedido:    $GatewayUrl/api/orders/$orderId"
Write-Host "  Pagamento: $GatewayUrl/api/payments/$orderId"
Write-Host "  Logs:      Grafana > Explore > Loki > {job=`"docker`"} |= `"$correlation`""
Write-Host '  Traces:    http://localhost:16686'
