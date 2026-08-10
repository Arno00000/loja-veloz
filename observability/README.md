# Observabilidade

## Os três pilares e o que cada um responde

| Pilar | Ferramenta | Pergunta que responde |
|---|---|---|
| Métricas | Prometheus + Grafana | *Está acontecendo?* Quantos pedidos, qual a taxa de erro, qual a latência |
| Logs | Loki + Alloy | *O que aconteceu neste caso?* Detalhe de uma execução específica |
| Traces | Jaeger + OTel Collector | *Onde demorou?* Caminho da requisição entre serviços |

Nenhum dos três substitui os outros. Métrica não diz por que um pedido
específico falhou; log não mostra a árvore de chamadas; trace não serve para
alertar sobre tendência.

## Fluxo da telemetria

```
Aplicações  ──/metrics (pull)──────────────────►  Prometheus  ──►  Grafana
            ──stdout (JSON)──►  Alloy  ──push──►  Loki        ──►  Grafana
            ──OTLP/HTTP──────►  OTel Collector ──►  Jaeger    ──►  Grafana
```

As aplicações não conhecem Jaeger nem Loki. Elas escrevem em stdout e enviam
OTLP para um endpoint único. Trocar o backend é mudança de configuração de
infraestrutura, não de código.

## correlationId e trace context não são a mesma coisa

Este é o ponto mais confundido do projeto, e a distinção é deliberada.

**`correlationId`** identifica a *jornada de negócio*: um pedido, do `POST` até
o estado final. É gerado pelo Gateway (ou aceito do cliente, se tiver formato
seguro), viaja em `x-correlation-id` no HTTP e nos headers da mensagem AMQP.
Sobrevive a saltos assíncronos longos e a reprocessamentos — se um evento for
reentregue horas depois, ele carrega o mesmo `correlationId`.

**Trace context** (`traceparent`, padrão W3C) identifica uma *árvore de spans*
de execução distribuída. É gerenciado pelo OpenTelemetry, tem amostragem, e
descreve uma execução concreta com tempos.

Os dois convivem porque respondem a perguntas diferentes: "me mostre tudo que
aconteceu com o pedido X" (correlationId, busca em log) versus "onde foram os
800 ms desta requisição" (trace).

Ambos aparecem em toda linha de log: `correlationId`, `traceId` e `spanId` são
injetados automaticamente pelo logger quando há span ativo.

## Navegação entre os três

O Grafana está provisionado com correlação nos dois sentidos:

- **Log → trace**: o campo `traceId` no JSON do log vira link para o Jaeger
  (`derivedFields` na datasource do Loki).
- **Trace → log**: a partir de um span, o Grafana monta uma consulta no Loki
  filtrando pelo mesmo `traceId` (`tracesToLogsV2` na datasource do Jaeger).

Roteiro típico de diagnóstico:

1. Alerta ou painel indica taxa de falha alta
2. Painel "Erros e avisos recentes" mostra as linhas de log
3. Clique no `traceId` de uma linha → trace completo no Jaeger
4. O trace mostra em qual serviço e em qual operação o tempo foi gasto

## Cardinalidade: a regra que não se quebra

Labels do Prometheus são **apenas** dimensões de baixa cardinalidade: `service`,
`route` (padrão registrado, nunca a URL concreta), `status_code`, `queue`,
`event_type`, `reason`.

**Nunca** viram label: `orderId`, `customerId`, `eventId`, `correlationId`,
`traceId`, URL com identificador embutido.

Motivo: cada combinação distinta de labels cria uma série temporal. Usar
`orderId` como label significa uma série por pedido — o Prometheus consome
memória sem limite e eventualmente morre. Essa informação de alta cardinalidade
pertence a logs e traces, que são projetados para isso.

A normalização de rota está em `packages/observability/src/http-observability.ts`
(`normalizeRoute`): `/orders/<uuid>` vira `/orders/:id`, e requisições sem rota
registrada (404) viram `unmatched`.

## Métricas disponíveis

**HTTP** (todos os serviços): `http_requests_total`,
`http_request_duration_seconds`, `http_errors_total`, `dependency_up`

**Mensageria**: `messaging_messages_published_total`,
`messaging_publish_failures_total`, `messaging_messages_consumed_total`,
`messaging_consume_failures_total`, `messaging_retries_total`,
`messaging_dead_lettered_total`, `messaging_duplicate_messages_total`,
`messaging_processing_duration_seconds`, `messaging_broker_connection_up`,
`messaging_broker_reconnections_total`

**Pedidos**: `orders_created_total`, `orders_confirmed_total`,
`orders_failed_total{reason}`, `orders_state_transitions_total{from,to}`,
`orders_invalid_transitions_total`, `orders_events_ignored_total`

**Estoque**: `inventory_reservations_total`,
`inventory_reservation_failures_total`, `inventory_releases_total`,
`inventory_restock_operations_total`, `inventory_skus_out_of_stock`

**Pagamentos**: `payments_processed_total{status}`, `payments_duplicate_total`,
`payments_authorization_duration_seconds`

Além dessas, `collectDefaultMetrics` do prom-client expõe CPU, memória, event
loop lag e handles do processo Node.

## Por que Alloy lê o socket do Docker

Os logs em JSON dos contêineres ficam em `/var/lib/docker/containers/` **no
host**. Em Docker Desktop (Windows e macOS) esse caminho vive dentro de uma VM
e não é acessível de forma estável a partir de um contêiner. A API do Docker,
exposta pelo socket, funciona igual nas três plataformas.

O socket é montado somente leitura, mas **acesso ao socket do Docker equivale a
acesso privilegiado ao host**. Isso é aceitável em ambiente local de
desenvolvimento e inaceitável em produção. No Kubernetes a coleta é outra, com
ServiceAccount e RBAC próprios — ver `kubernetes/helm-values/alloy.values.yaml`.

## Acessos locais

| Interface | URL | Credencial |
|---|---|---|
| Grafana | http://localhost:3000 | `admin` / `admin` |
| Prometheus | http://localhost:9090 | — |
| Jaeger | http://localhost:16686 | — |
| RabbitMQ Management | http://localhost:15672 | ver `.env` |

Credenciais de desenvolvimento, descartáveis. Em produção o Grafana usaria
OIDC e nenhuma dessas interfaces seria exposta publicamente.

## Consultas úteis

**LogQL — tudo sobre um pedido:**

```logql
{job="docker"} |= "5b1f0f6c-2c9a-4f0f-9a6e-0b8f1c2d3e4f"
```

**LogQL — erros de um serviço:**

```logql
{job="docker", service="order-service", level="error"} | json
```

**PromQL — taxa de erro por serviço:**

```promql
sum by (service) (rate(http_errors_total{status_class="5xx"}[5m]))
  / sum by (service) (rate(http_requests_total[5m]))
```

**PromQL — taxa de confirmação de pedidos:**

```promql
sum(rate(orders_confirmed_total[15m])) / sum(rate(orders_created_total[15m]))
```

## Limitações do MVP

- Sem Alertmanager: as regras existem e ficam visíveis em Prometheus > Alerts,
  mas não há roteamento de notificação
- Retenção curta: 7 dias no Prometheus e no Loki, armazenamento local
- Amostragem de traces em 100% — adequado para demonstração, inviável sob
  tráfego real (o ajuste é `OTEL_SAMPLING_RATIO`)
- Sem RED/USE method formalizado por serviço
- Sem SLO nem error budget definidos
