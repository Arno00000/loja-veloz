# Runbook operacional — Pedidos Veloz

Procedimentos para quem opera a plataforma. Para sintoma → causa → correção,
ver `docs/troubleshooting.md`.

---

## 1. Subir o ambiente local

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
docker compose up --build -d
docker compose ps
```

Ordem esperada: `postgres` e `rabbitmq` ficam `healthy`; os três serviços
`*-migrate` rodam e terminam com código 0; os quatro serviços sobem; a
observabilidade sobe em paralelo.

Verificação:

```bash
curl http://localhost:8080/health/ready
bash tests/smoke/smoke.sh
```

| Interface | URL | Credencial |
|---|---|---|
| Gateway | http://localhost:8080 | — |
| Grafana | http://localhost:3000 | `admin` / `admin` |
| Prometheus | http://localhost:9090 | — |
| Jaeger | http://localhost:16686 | — |
| RabbitMQ | http://localhost:15672 | ver `.env` |

**Recriar do zero** (apaga todos os dados):

```bash
docker compose down -v && docker compose up --build -d
```

## 2. Demonstrar os três cenários

```bash
bash scripts/create-order.sh                  # CONFIRMED
bash scripts/create-order.sh sem-estoque      # STOCK_FAILED
bash scripts/create-order.sh falha-pagamento  # PAYMENT_FAILED
```

Windows: `pwsh scripts/create-order.ps1 -Cenario falha-pagamento`.

Cada execução imprime o `correlationId`. Para investigar no Grafana:

```logql
{job="docker"} |= "<correlationId>"
```

## 3. Investigar um pedido específico

```bash
curl -s http://localhost:8080/api/orders/<orderId> | jq
curl -s http://localhost:8080/api/payments/<orderId> | jq
```

Depois, na ordem:

1. **Logs** — Grafana > Explore > Loki > `{job="docker"} |= "<orderId>"`
2. **Trace** — clicar no `traceId` de uma linha de log leva ao Jaeger
3. **Banco** — se necessário:

```bash
docker compose exec postgres psql -U orders_user -d orders_db \
  -c "SELECT id, status, total, created_at, updated_at FROM orders WHERE id = '<orderId>';"
```

## 4. Mensagens na DLQ

**Alerta:** `MensagensNaDLQ`. Toda mensagem em DLQ significa que o retry falhou
o número máximo de vezes, ou que o payload violou o contrato.

### 4.1 Identificar

RabbitMQ Management > Queues > filas terminadas em `.dlq`.

Ou por linha de comando:

```bash
docker compose exec rabbitmq rabbitmqctl list_queues name messages | grep dlq
```

### 4.2 Ler sem consumir

Management UI > fila `.dlq` > **Get messages** > `Ack Mode: Nack message
requeue true`.

Os headers dizem o motivo:

| Header | Significado |
|---|---|
| `x-failure-reason: invalid_json` | Conteúdo não é JSON. **Nunca reprocessar** |
| `x-failure-reason: unknown_event_type` | `eventType` fora do catálogo. **Nunca reprocessar** |
| `x-failure-reason: contract_violation` | Payload viola o schema. **Nunca reprocessar** |
| `x-failure-reason: retries_exhausted` | Falha transitória persistente. **Reprocessar após corrigir a causa** |
| `x-failure-reason: non_retryable` | Handler sinalizou que retry não adianta |
| `x-retry-count` | Quantas tentativas houve |
| `x-original-queue` | Fila de origem |

### 4.3 Reprocessar

**Só depois de corrigir a causa.** Reprocessar contra o mesmo problema devolve
a mensagem à DLQ.

Pela Management UI: **Move messages** (plugin shovel), destino
`loja-veloz.events`, routing key igual ao `eventType`.

Sem o plugin: consumir da DLQ e republicar. A idempotência por `eventId`
protege contra efeito duplicado — se o evento já tinha sido aplicado antes da
falha, o reprocessamento é ignorado.

### 4.4 Descartar

Para `invalid_json`, `unknown_event_type` e `contract_violation`, reprocessar
nunca vai funcionar. **Antes de descartar, registrar o conteúdo** — é a
evidência do bug que produziu a mensagem.

```bash
docker compose exec rabbitmq rabbitmqctl purge_queue <fila>.dlq
```

## 5. Pedido preso em PENDING

Sintoma da janela do outbox (limitação 1.3): o pedido foi persistido, mas
`order.created` não foi publicado.

**Detectar:**

```sql
SELECT id, customer_id, total, created_at
  FROM orders
 WHERE status = 'PENDING'
   AND created_at < NOW() - INTERVAL '10 minutes'
 ORDER BY created_at;
```

**Antes de concluir que é o outbox**, descartar as causas mais comuns:

1. O Estoque está no ar? `curl http://localhost:8080/health/ready`
2. Há mensagens acumuladas em `inventory.order-created`?
3. Há algo na DLQ dessa fila?

Se a fila está vazia e nada na DLQ, o evento realmente não foi publicado.

**Corrigir:** republicar `order.created` manualmente pela Management UI, com o
payload reconstruído a partir do banco. O `eventId` deve ser **novo** — o
antigo nunca existiu.

**Prevenir:** transactional outbox.

## 6. Reiniciar um serviço

```bash
docker compose restart order-service
docker compose logs -f order-service
```

O graceful shutdown cancela o consumo, termina as mensagens em voo, confirma,
fecha os canais, desconecta o Prisma e finaliza o tracing. **Nenhuma mensagem
em processamento é perdida**, desde que o encerramento caiba em
`SHUTDOWN_TIMEOUT_MS`.

## 7. Deploy no Kubernetes

### 7.1 Acompanhar

```bash
kubectl rollout status deployment/order-service -n loja-veloz --timeout=300s
kubectl get pods -n loja-veloz -w
```

### 7.2 Rollback sem migration

```bash
kubectl rollout history deployment/order-service -n loja-veloz
kubectl rollout undo deployment/order-service -n loja-veloz
kubectl rollout status deployment/order-service -n loja-veloz
```

### 7.3 Rollback com migration

**Não é automático, e é proposital.**

Reverter o Deployment com o schema já alterado coloca código antigo contra
banco novo — o que pode ser pior que o estado atual.

Procedimento:

1. **Parar** e avaliar. Qual o impacto real do problema atual?
2. A migration foi **aditiva** (adicionou coluna ou tabela, sem remover nem
   renomear)? Se sim, o código anterior provavelmente funciona: siga com o
   rollback normal
3. Se foi **destrutiva** (removeu ou renomeou), o rollback do Deployment
   **não** resolve. As opções são: corrigir para frente com um novo release,
   ou restaurar o banco do backup — e, nesse caso, perder os dados escritos
   desde o backup
4. Registrar o incidente e revisar a migration: o padrão *expand and contract*
   existe exatamente para evitar essa situação

## 8. Escala

```bash
kubectl get hpa -n loja-veloz -w
kubectl describe hpa order-service -n loja-veloz
kubectl top pods -n loja-veloz
```

**HPA em `<unknown>`:** Metrics Server ausente ou sem `requests.cpu` no
Deployment.

**Escala manual temporária** (o HPA sobrescreve no próximo ciclo):

```bash
kubectl scale deployment/order-service -n loja-veloz --replicas=6
```

Para segurar o valor, ajuste `minReplicas` no HPA.

**Antes de subir muito o teto:** verifique as conexões do banco. Cada réplica
abre até 10.

```sql
SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;
SHOW max_connections;
```

## 9. Preparação para a campanha

**Uma semana antes:**

- [ ] Executar teste de carga com k6 e calibrar HPA, `requests` e alertas
      (hoje **não existe**; ver limitação 1.11)
- [ ] Conferir `max_connections` contra a soma dos `maxReplicas`
- [ ] Verificar backup do RDS **restaurando** em ambiente separado
- [ ] Elevar `minReplicas` para o piso esperado do pico
- [ ] Confirmar que os alertas chegam a alguém

**No dia:**

- [ ] Congelar deploys
- [ ] Acompanhar o painel "Pedidos Veloz - Visão Geral"
- [ ] Vigiar: taxa de 5xx, p95, profundidade das filas, DLQ, conexões do banco

**Sinais de alerta e ação:**

| Sinal | Provável causa | Ação |
|---|---|---|
| Filas crescendo, CPU baixa | HPA não reage (limitação do ADR-012) | Escalar manualmente |
| Muitos `STOCK_FAILED` | Estoque real esgotado | Repor, se aplicável |
| 5xx subindo no Gateway | Serviço interno degradado | Ver readiness e logs |
| DLQ recebendo mensagens | Erro sistemático | Ver seção 4 |
| Conexões do banco no teto | Réplicas demais | Reduzir `maxReplicas` |

## 10. Encerrar e limpar

```bash
docker compose down -v                       # local, apaga dados
kubectl delete -k kubernetes/overlays/development
cd terraform/environments/staging && terraform destroy
```

**O `terraform destroy` é o único jeito confiável de parar a cobrança.**
Recurso esquecido na AWS continua sendo cobrado.

## 11. Contatos e escalonamento

`[PREENCHER ANTES DE USO REAL]`

Este projeto é acadêmico e não tem plantão definido. Em operação real, esta
seção precisa de: responsável primário, escalonamento, canal de incidente e
janela de manutenção acordada.
