# =============================================================================
# Smoke tests em PowerShell — equivalente a smoke.sh para quem usa Windows
# sem WSL. A sintaxe é genuinamente diferente (Invoke-RestMethod trata erro
# HTTP como exceção, ao contrário do curl), o que justifica a versão separada.
#
# Uso:
#   pwsh tests/smoke/smoke.ps1
#   $env:GATEWAY_URL="http://localhost:8080"; pwsh tests/smoke/smoke.ps1
# =============================================================================

$ErrorActionPreference = 'Continue'

$GatewayUrl = if ($env:GATEWAY_URL) { $env:GATEWAY_URL } else { 'http://localhost:8080' }
$TimeoutSeconds = if ($env:SMOKE_TIMEOUT) { [int]$env:SMOKE_TIMEOUT } else { 60 }

$script:Passed = 0
$script:Failed = 0

function Write-Pass($Message) {
    Write-Host "  [OK]    $Message"
    $script:Passed++
}

function Write-Fail($Message) {
    Write-Host "  [FALHA] $Message" -ForegroundColor Red
    $script:Failed++
}

function Get-HttpStatus($Uri, $Method = 'GET', $Body = $null) {
    try {
        $params = @{ Uri = $Uri; Method = $Method; TimeoutSec = 15; SkipHttpErrorCheck = $true }
        if ($Body) {
            $params.Body = $Body
            $params.ContentType = 'application/json'
        }
        $response = Invoke-WebRequest @params
        return $response.StatusCode
    } catch {
        return 0
    }
}

function Test-Status($Description, $Expected, $Actual) {
    if ($Actual -eq $Expected) {
        Write-Pass "$Description (HTTP $Actual)"
    } else {
        Write-Fail "$Description (esperado $Expected, recebido $Actual)"
    }
}

Write-Host "Smoke tests contra $GatewayUrl`n"

# --- 1. Disponibilidade ------------------------------------------------------
Write-Host '1. Disponibilidade'
Test-Status 'liveness do Gateway' 200 (Get-HttpStatus "$GatewayUrl/health/live")
Test-Status 'readiness do Gateway' 200 (Get-HttpStatus "$GatewayUrl/health/ready")

try {
    $metrics = Invoke-WebRequest -Uri "$GatewayUrl/metrics" -TimeoutSec 15
    if ($metrics.Content -match 'http_requests_total') {
        Write-Pass 'endpoint de métricas expõe http_requests_total'
    } else {
        Write-Fail 'endpoint de métricas não respondeu como esperado'
    }
} catch {
    Write-Fail 'endpoint de métricas inacessível'
}

# --- 2. Estoque --------------------------------------------------------------
Write-Host "`n2. Estoque"
Test-Status 'consulta de SKU existente' 200 (Get-HttpStatus "$GatewayUrl/api/inventory/SKU-TECLADO-001")
Test-Status 'SKU inexistente devolve 404' 404 (Get-HttpStatus "$GatewayUrl/api/inventory/SKU-QUE-NAO-EXISTE")

# --- 3. Fluxo de pedido ------------------------------------------------------
Write-Host "`n3. Fluxo de pedido"

$orderBody = @{
    customerId = 'CUSTOMER-SMOKE'
    items      = @(@{ sku = 'SKU-TECLADO-001'; quantity = 1; unitPrice = 100 })
} | ConvertTo-Json -Depth 5

$orderId = $null
try {
    $created = Invoke-RestMethod -Uri "$GatewayUrl/api/orders" -Method Post `
        -ContentType 'application/json' -Body $orderBody -TimeoutSec 15
    $orderId = $created.id
    Write-Pass "pedido criado (id $orderId)"
} catch {
    Write-Fail "criação de pedido falhou: $($_.Exception.Message)"
    Write-Host "`nResultado: $script:Passed passaram, $script:Failed falharam"
    exit 1
}

Write-Host "  ... aguardando o estado final (até ${TimeoutSeconds}s)"
$finalStatus = 'PENDING'
$elapsed = 0
while ($elapsed -lt $TimeoutSeconds) {
    try {
        $order = Invoke-RestMethod -Uri "$GatewayUrl/api/orders/$orderId" -TimeoutSec 10
        $finalStatus = $order.status
        if ($finalStatus -in @('CONFIRMED', 'STOCK_FAILED', 'PAYMENT_FAILED')) { break }
    } catch { }
    Start-Sleep -Seconds 2
    $elapsed += 2
}

if ($finalStatus -eq 'CONFIRMED') {
    Write-Pass "pedido chegou a CONFIRMED em ~${elapsed}s"
} else {
    Write-Fail "pedido terminou em '$finalStatus' após ${elapsed}s (esperado CONFIRMED)"
}

Test-Status 'pagamento registrado para o pedido' 200 (Get-HttpStatus "$GatewayUrl/api/payments/$orderId")

# --- 4. Validação ------------------------------------------------------------
Write-Host "`n4. Validação de entrada"
Test-Status 'payload inválido devolve 400' 400 (Get-HttpStatus "$GatewayUrl/api/orders" 'POST' '{"customerId":""}')
Test-Status 'pedido inexistente devolve 404' 404 (Get-HttpStatus "$GatewayUrl/api/orders/00000000-0000-4000-8000-000000000000")

Write-Host "`nResultado: $script:Passed passaram, $script:Failed falharam"

if ($script:Failed -gt 0) { exit 1 }
exit 0
