# Limitações do MVP e melhorias futuras

## Por que este documento existe

Um projeto que não declara os próprios limites obriga quem o avalia a
descobri-los. Cada item abaixo é uma escolha consciente, com o motivo e a
consequência.

---

## 1. Limitações declaradas

### 1.1 Pagamento simulado

`PaymentGatewaySimulator` substitui uma integração real. Nenhuma chamada
externa, nenhuma conta, nenhum custo — o projeto roda offline.

A decisão é **determinística**: recusa apenas o cliente configurado em
`PAYMENT_FAIL_CUSTOMER_ID`, e o recurso pode ser desligado
(`PAYMENT_SIMULATION_ENABLED=false`). Não há `Math.random` em lugar nenhum:
recusa aleatória tornaria os testes instáveis e a demonstração irreprodutível.

**Consequência:** não há tratamento de timeout de provedor, retentativa de
autorização, estorno, nem conciliação financeira.

### 1.2 Instância PostgreSQL única no ambiente local

Três bancos, três usuários, uma instância. O isolamento de esquema e credencial
está preservado; o de falha e de recursos, não. Detalhado em ADR-004 e em
`database/README.md`.

### 1.3 Ausência de transactional outbox

**A limitação mais relevante do projeto.**

Entre o `COMMIT` no banco e o `ack` do publish existe uma janela em que o
processo pode morrer. Nesse caso o efeito local aconteceu — o pedido está
`PENDING` — mas o evento nunca foi publicado. O pedido fica órfão: nenhum
serviço reagirá a ele.

**Por que não foi implementado:** o outbox exige uma tabela transacional e um
processo de relay confiável, com garantia de ordem e sem duplicar publicação.
Implementá-lo pela metade seria **pior** que assumir a limitação, porque daria
falsa sensação de garantia.

**Como detectar:** pedidos em `PENDING` há mais tempo que o normal. Consulta no
runbook.

**Como corrigir hoje:** republicação manual, descrita no runbook.

### 1.4 RabbitMQ local sem alta disponibilidade

Instância única, sem cluster, sem quorum queues. No overlay de desenvolvimento,
`emptyDir`: reinício do pod apaga as mensagens não consumidas. **Não é
provisionado pelo Terraform** — a decisão de não entregar um `aws_mq_broker`
nunca aplicado está em ADR-010.

### 1.5 Entrega "ao menos uma vez"

O projeto **não promete "exatamente uma vez"**, porque isso não existe em
mensageria distribuída sem cooperação do consumidor. A defesa é a tabela
`processed_events`, gravada na mesma transação do efeito de negócio.

### 1.6 Ausência de service mesh

Sem mTLS entre serviços, sem circuit breaker, sem canary ponderado. Ver
ADR-008.

### 1.7 Ausência de autenticação

**Bloqueador para uso real.** Não há OAuth, OIDC, JWT nem sessão. Qualquer um
pode criar pedido, consultar qualquer pedido e qualquer pagamento. O
`customerId` é informado pelo cliente e não é verificado.

Consequências em cadeia: não há trilha de auditoria confiável (AM-14), e é
possível esgotar estoque com pedidos que nunca serão pagos (AM-03).

### 1.8 Sem expiração de reserva de estoque

Um pedido que fica em `STOCK_RESERVED` e nunca recebe resultado de pagamento
mantém o saldo reservado **indefinidamente**. Não há processo que libere
reservas antigas.

Combinado com 1.7, é uma falha de disponibilidade explorável.

### 1.9 Workloads com estado simplificados no Kubernetes local

PostgreSQL e RabbitMQ do overlay de desenvolvimento são `Deployment` com
`emptyDir`, e não `StatefulSet` com volume persistente. Marcado em
`dependencies-academic.yaml`.

### 1.10 Sem alta disponibilidade real do banco

Em staging, RDS single-AZ. Em produção o código habilita Multi-AZ, **mas nunca
foi aplicado**.

### 1.11 Sem teste de carga

**Nenhuma afirmação de desempenho neste projeto é sustentada por dados
medidos.** Os alvos do HPA (60% e 70%), os `requests` e `limits`, os buckets
dos histogramas e os limiares dos alertas são pontos de partida razoáveis —
não resultados de medição.

### 1.12 Deploy em staging depende de cluster

O `deploy-staging.yml` exige cluster, kubeconfig, namespace, Secret e acesso ao
registry. Os pré-requisitos estão no topo do arquivo, e o workflow **verifica**
namespace e Secret antes de aplicar, falhando com mensagem clara.

### 1.13 Terraform não aplicado

Nenhum `terraform apply` foi executado. O código foi revisado por inspeção.

### 1.14 Nenhum comando foi executado

O ambiente de geração não dispôs de terminal funcional. **Todo o projeto está,
no máximo, validado por inspeção.** Ver `docs/practical-report.md`.

### 1.15 Outras

- `processed_events` cresce indefinidamente; falta rotina de expurgo
- Sem Alertmanager: as regras existem, o roteamento não
- Sem SLO nem error budget
- Sem teste de contrato (Pact) entre produtor e consumidor
- Sem paginação por cursor — offset degrada em tabelas grandes
- Valores monetários trafegam como `number`; o correto em sistema financeiro é
  inteiro em centavos de ponta a ponta
- Sem i18n: mensagens de erro apenas em português

---

## 2. Melhorias futuras

### 2.1 Segurança — prioridade máxima

| Melhoria                                            | Resolve                                   | Esforço |
| --------------------------------------------------- | ----------------------------------------- | ------- |
| **OAuth 2.0 + OpenID Connect**                      | 1.7, AM-04, AM-14                         | Alto    |
| **Expiração de reserva de estoque**                 | 1.8, AM-03                                | Baixo   |
| **External Secrets Operator** + AWS Secrets Manager | AM-08                                     | Médio   |
| **Sealed Secrets** ou **SOPS**                      | Versionar segredo com segurança em GitOps | Baixo   |
| **mTLS** via service mesh                           | AM-06                                     | Alto    |
| `sslmode=require` e AMQPS                           | AM-06 parcialmente, com esforço baixo     | Baixo   |
| **gitleaks** no pipeline                            | AM-07                                     | Baixo   |
| **SBOM** (Syft) e **Cosign**                        | AM-09                                     | Médio   |
| **OPA Gatekeeper** ou **Kyverno**                   | Política de admissão                      | Médio   |
| **AWS WAF + Shield**                                | AM-02                                     | Médio   |

### 2.2 Confiabilidade

**Transactional outbox** — resolve 1.3. O padrão:

1. Na mesma transação que altera o pedido, gravar o evento em uma tabela
   `outbox`
2. Um processo de relay lê a tabela, publica no broker e marca como publicado
3. Se o processo morrer, o relay republica na volta — daí a idempotência ser
   pré-requisito

**Saga com compensação explícita** — hoje a compensação é implícita
(`stock.release.requested`). Uma Saga formal daria visibilidade do progresso e
permitiria compensação parcial.

**Chaos engineering** — derrubar RabbitMQ e PostgreSQL no meio do fluxo e
verificar a recuperação. Hoje isso é manual, no runbook.

**Banco por serviço em instâncias separadas** — resolve 1.2 e 1.10, sem mudar
código.

**RabbitMQ gerenciado** (Amazon MQ) ou operador oficial com quorum queues —
resolve 1.4.

### 2.3 Escala e deploy

| Melhoria                                | Resolve                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| **KEDA** por profundidade de fila       | Métrica de escala correta para consumidores (ADR-012)                       |
| **Argo CD**                             | Deploy no modelo pull; cluster deixa de aceitar credencial externa          |
| **Argo Rollouts** ou **Flagger**        | Canary ponderado real (ADR-006)                                             |
| **Cluster Autoscaler** ou **Karpenter** | Escala de nós                                                               |
| **k6**                                  | Teste de carga — resolve 1.11 e permite calibrar tudo que hoje é estimativa |

### 2.4 Observabilidade

- **Alertmanager** com roteamento real
- **SLO e error budget** formais
- **Grafana Tempo** no lugar do Jaeger em memória
- Amostragem por cauda (_tail-based_): amostrar 100% dos traces com erro e uma
  fração dos bem-sucedidos
- **Exemplars**: ligar um ponto de histograma diretamente ao trace daquela
  requisição

### 2.5 Operação

- Expurgo de `processed_events`
- **Backups e disaster recovery** com RPO e RTO declarados e **testados** —
  backup nunca restaurado não é backup
- Paginação por cursor
- Valores monetários em centavos inteiros
- Proteção de branch e revisão obrigatória
- Actions fixadas por SHA

### 2.6 Produto

- Cancelamento de pedido pelo cliente
- Consulta de pedidos por cliente autenticado
- Notificação (e-mail ou webhook) na mudança de estado
- Catálogo de produtos como domínio próprio
- Frete como domínio próprio

---

## 3. Ordem sugerida

**Antes de qualquer uso real:**

1. Autenticação e autorização (1.7)
2. Expiração de reserva (1.8)
3. Executar e registrar toda a validação pendente (1.14)

**Primeiras quatro semanas seguintes:**

4. Transactional outbox (1.3)
5. External Secrets Operator
6. Teste de carga com k6 (1.11) — calibra HPA, recursos e alertas com dados
7. Alertmanager

**Trimestre seguinte:**

8. KEDA
9. Banco por serviço + RabbitMQ gerenciado
10. Argo CD
11. Service mesh, se os critérios de ADR-008 forem atingidos
