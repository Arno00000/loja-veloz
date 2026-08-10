# ADR-012 — HPA com métrica de CPU

**Status:** Aceito · 2026-07-30

## Contexto

A campanha promocional prevê aumento de tráfego. Escalar manualmente exige
alguém acordado no momento certo, com julgamento correto — não é um plano.

A métrica ideal para escalar cada serviço é diferente:

- **API Gateway**: requisições por segundo, ou conexões concorrentes
- **Serviço de Pedidos**: requisições por segundo **e** profundidade das filas
  que consome
- **Estoque e Pagamentos**: essencialmente **profundidade de fila** — eles não
  recebem tráfego HTTP relevante, reagem a eventos

## Decisão

**HPA v2 com utilização de CPU** para os quatro serviços, com limites
distintos:

| Serviço | min | max | alvo |
|---|---|---|---|
| api-gateway | 2 (3 em prod) | 10 (20) | 60% |
| order-service | 2 (3) | 8 (12) | 70% |
| inventory-service | 2 (3) | 8 (12) | 70% |
| payment-service | 2 | 6 | 70% |

Com `behavior` assimétrico: janela de estabilização de 30–60 s na subida e de
**300 s na descida**.

## Alternativas consideradas

| Alternativa | Por que não agora |
|---|---|
| **Sem autoscaling** | Não atende ao requisito de escalar sob demanda |
| **KEDA por profundidade de fila** | **É a solução tecnicamente correta** para os consumidores. Descartado no MVP porque exige instalar e operar mais um controlador, e porque CPU já demonstra o mecanismo. Registrado como evolução prioritária |
| **HPA por métrica customizada do Prometheus** | Exigiria Prometheus Adapter, mais uma peça, e o mesmo esforço do KEDA com menos benefício |
| **VPA** | Ajusta `requests` verticalmente. **Não pode** conviver com HPA sobre o mesmo recurso — ver Riscos |
| **Cluster Autoscaler apenas** | Escala nós, não pods. Complementar, não alternativo |

## Consequências positivas

- Nativo do Kubernetes, sem componente adicional além do Metrics Server
- Reage automaticamente ao pico
- `behavior` assimétrico evita oscilação: sobe rápido, desce devagar
- Piso de 2 réplicas garante que o Rolling Update com `maxUnavailable: 0`
  funcione
- Limites por serviço refletem o gargalo real de cada um

## Consequências negativas

- **CPU é uma métrica ruim para consumidor de fila.** Um acúmulo de mensagens
  não necessariamente aparece como CPU alta; o serviço pode estar esperando
  I/O do banco com CPU baixa e 10.000 mensagens na fila. O sistema escalaria
  **tarde**
- Reação atrasada: a métrica precisa subir, ser coletada, avaliada e só então o
  pod é criado, iniciado e passa no readiness
- Depende do Metrics Server — sem ele, o HPA fica em `<unknown>` e não escala
- **O teto real não é CPU, é o banco.** Cada réplica abre até 10 conexões; 12
  réplicas são 120 conexões só de um serviço. O `max_connections` do PostgreSQL
  é o limite efetivo, e é por isso que `maxReplicas` dos serviços com banco é
  menor que o do Gateway

## Riscos

| Risco | Mitigação |
|---|---|
| Deployment sem `requests.cpu` torna o HPA inoperante | Todos declaram; `LimitRange` define default como rede de segurança |
| Esgotar conexões do PostgreSQL ao escalar | `connection_limit=10` na URL; `maxReplicas` calibrado por esse teto |
| Oscilação (subir e descer em ciclo) | `stabilizationWindowSeconds: 300` na descida |
| Escalar sem capacidade de nó | `ResourceQuota` no namespace; Cluster Autoscaler é evolução |
| **HPA e VPA no mesmo recurso** | **Proibido.** O VPA altera `requests`; o HPA calcula percentual sobre esse valor em movimento. O resultado é oscilação. Este projeto usa apenas HPA, e a proibição está registrada em `hpa.yaml` |
| Duplicidade ao escalar consumidores | Idempotência por `processed_events`: **pré-requisito da escala**, não detalhe |

## Critérios de revisão

Adotar **KEDA** quando: a profundidade da fila crescer sem que a CPU acompanhe
(o sintoma é atraso no processamento com o HPA parado no mínimo), ou o tempo
entre o pico e a escala se mostrar inaceitável.

O KEDA convive com o HPA — ele o gera internamente — então a migração é
incremental: começar pelo Estoque, que é o mais sensível a pico de fila.

Revisar os alvos de utilização com dados reais de carga. Os valores de 60% e
70% são pontos de partida razoáveis, **não medidos**: como registrado em
`docs/limitations-and-roadmap.md`, nenhum teste de carga foi executado.
