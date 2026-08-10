# Matriz de rastreabilidade dos requisitos

Cada requisito acadêmico mapeado para o artefato que o atende, como validá-lo e
o estado atual.

**Legenda de status:**

- `INSPEÇÃO` — arquivo criado e revisado por inspeção
- `PENDENTE` — depende de execução no ambiente do leitor
- `PARCIAL` — atendido com limitação declarada
- `N/A` — deliberadamente fora do escopo, com justificativa

---

## 1. Entregáveis

| #   | Requisito                      | Componente                                 | Como validar                                        | Status                                     |
| --- | ------------------------------ | ------------------------------------------ | --------------------------------------------------- | ------------------------------------------ |
| 1   | Repositório completo           | Todo o `loja-veloz/`                       | `git status`                                        | INSPEÇÃO                                   |
| 2   | Ambiente local funcional       | `docker-compose.yml`                       | `docker compose up --build`                         | PENDENTE                                   |
| 3   | Microsserviços conteinerizados | `apps/*/Dockerfile`                        | `docker compose build`                              | PENDENTE                                   |
| 4   | Manifests Kubernetes           | `kubernetes/base/`, `overlays/`            | `kubectl kustomize kubernetes/overlays/development` | PENDENTE                                   |
| 5   | Pipeline CI/CD                 | `.github/workflows/` (3)                   | push no GitHub                                      | PENDENTE                                   |
| 6   | Observabilidade (3 pilares)    | `observability/`, `packages/observability` | Grafana, Prometheus, Jaeger                         | PENDENTE                                   |
| 7   | Deploy e rollback              | ADR-006, `kubernetes/README.md` §Deploy    | `kubectl rollout undo`                              | INSPEÇÃO                                   |
| 8   | Escalabilidade                 | `kubernetes/base/hpa.yaml`, ADR-012        | `kubectl get hpa -w`                                | PENDENTE                                   |
| 9   | Estrutura Terraform            | `terraform/` (3 módulos, 2 ambientes)      | `terraform validate`                                | PENDENTE                                   |
| 10  | README completo                | `README.md`                                | leitura                                             | INSPEÇÃO                                   |
| 11  | Documentação arquitetural      | `docs/architecture.md`                     | leitura                                             | INSPEÇÃO                                   |
| 12  | Runbook operacional            | `docs/runbook.md`                          | leitura                                             | INSPEÇÃO                                   |
| 13  | Guia de troubleshooting        | `docs/troubleshooting.md` (29 problemas)   | leitura                                             | INSPEÇÃO                                   |
| 14  | Relatório teórico              | `docs/theoretical-report.md`               | leitura                                             | INSPEÇÃO                                   |
| 15  | Relatório prático              | `docs/practical-report.md`                 | leitura                                             | INSPEÇÃO                                   |
| 16  | Referências primárias          | `docs/references.md`                       | acessar URLs                                        | PARCIAL — 3 verificadas, demais marcadas   |
| 17  | Análise de caso público        | `docs/case-study.md`                       | conferir fontes                                     | INSPEÇÃO — fonte verificada em 30/07/2026  |
| 18  | Matriz de rastreabilidade      | este arquivo                               | leitura                                             | INSPEÇÃO                                   |
| —   | Vídeo pitch                    | —                                          | —                                                   | **N/A — excluído por instrução explícita** |

## 2. Arquitetura e microsserviços

| Requisito                               | Componente                                                       | Como validar                | Status   |
| --------------------------------------- | ---------------------------------------------------------------- | --------------------------- | -------- |
| API Gateway sem banco                   | `apps/api-gateway/` — nenhuma dependência de Prisma              | inspecionar `package.json`  | INSPEÇÃO |
| Gateway gera/propaga correlationId      | `packages/observability/src/correlation.ts`                      | `app.test.ts` (3 casos)     | INSPEÇÃO |
| Rate limiting no Gateway                | `apps/api-gateway/src/app.ts`                                    | `app.test.ts`               | INSPEÇÃO |
| Padronização de erros                   | `packages/observability/src/errors.ts`                           | `errors.test.ts` (7 casos)  | INSPEÇÃO |
| Serviço de Pedidos: ciclo completo      | `apps/order-service/src/services/order.service.ts`               | `order.service.test.ts`     | INSPEÇÃO |
| Serviço de Estoque: reserva e liberação | `apps/inventory-service/src/services/inventory.service.ts`       | `inventory.service.test.ts` | INSPEÇÃO |
| Serviço de Pagamentos: simulação        | `apps/payment-service/src/services/payment-gateway.simulator.ts` | `payment.simulator.test.ts` | INSPEÇÃO |

## 3. Isolamento de dados

| Requisito                | Componente                                      | Como validar             | Status                     |
| ------------------------ | ----------------------------------------------- | ------------------------ | -------------------------- |
| Três bancos separados    | `database/postgres-init/01-create-databases.sh` | `psql -c "\l"`           | PENDENTE                   |
| Usuário por serviço      | idem                                            | `psql -c "\du"`          | PENDENTE                   |
| URL de conexão própria   | `.env.example`, `apps/*/.env.example`           | inspeção                 | INSPEÇÃO                   |
| Schema Prisma próprio    | `apps/*/prisma/schema.prisma` (3)               | inspeção                 | INSPEÇÃO                   |
| Migrations próprias      | `apps/*/prisma/migrations/`                     | `npx prisma migrate dev` | **PENDENTE — não geradas** |
| Gateway sem banco        | —                                               | inspeção                 | INSPEÇÃO                   |
| Sem schema compartilhado | 3 arquivos distintos                            | inspeção                 | INSPEÇÃO                   |
| Documentar a limitação   | `database/README.md`, ADR-004                   | leitura                  | INSPEÇÃO                   |

## 4. Modelos de dados

| Entidade             | Arquivo                                  | Campos exigidos                                                      | Status   |
| -------------------- | ---------------------------------------- | -------------------------------------------------------------------- | -------- |
| Order                | `order-service/prisma/schema.prisma`     | id, customerId, status, total, createdAt, updatedAt                  | INSPEÇÃO |
| OrderItem            | idem                                     | id, orderId, sku, quantity, unitPrice                                | INSPEÇÃO |
| InventoryItem        | `inventory-service/prisma/schema.prisma` | sku, availableQuantity, reservedQuantity, createdAt, updatedAt       | INSPEÇÃO |
| InventoryReservation | idem                                     | id, orderId, sku, quantity, status, createdAt, updatedAt             | INSPEÇÃO |
| Payment              | `payment-service/prisma/schema.prisma`   | id, orderId, status, amount, externalReference, createdAt, updatedAt | INSPEÇÃO |
| ProcessedEvent       | nos 3 schemas                            | eventId (único), eventType, processedAt                              | INSPEÇÃO |

## 5. Estados e fluxo

| Requisito                         | Componente                                         | Como validar               | Status   |
| --------------------------------- | -------------------------------------------------- | -------------------------- | -------- |
| 5 estados exatos                  | `packages/shared-types/src/domain/order-status.ts` | `order-status.test.ts`     | INSPEÇÃO |
| 3 fluxos permitidos               | `ALLOWED_TRANSITIONS`                              | 4 casos válidos testados   | INSPEÇÃO |
| Transições inválidas bloqueadas   | `assertTransition`                                 | 8 casos inválidos testados | INSPEÇÃO |
| Validação centralizada no Pedidos | `order.repository.ts` chama `canTransition`        | inspeção                   | INSPEÇÃO |
| Fluxo de 20 passos                | `docs/architecture.md` §4                          | teste de integração        | INSPEÇÃO |
| `stock.released` só audita        | `order-service/src/messaging/consumers.ts`         | `order.service.test.ts`    | INSPEÇÃO |

## 6. Cenários determinísticos

| Requisito                     | Componente                                         | Como validar                              | Status   |
| ----------------------------- | -------------------------------------------------- | ----------------------------------------- | -------- |
| Sem aleatoriedade             | `payment-gateway.simulator.ts` — sem `Math.random` | teste com 50 execuções iguais             | INSPEÇÃO |
| `SKU-SEM-ESTOQUE` com saldo 0 | `inventory-service/src/seed.ts`                    | `GET /api/inventory/SKU-SEM-ESTOQUE`      | INSPEÇÃO |
| `CUSTOMER-PAYMENT-FAIL`       | `PAYMENT_FAIL_CUSTOMER_ID`                         | `scripts/create-order.sh falha-pagamento` | INSPEÇÃO |
| Documentado como demonstração | comentário no simulador, `.env.example`, README    | leitura                                   | INSPEÇÃO |
| Desativável por configuração  | `PAYMENT_SIMULATION_ENABLED`                       | teste unitário cobre os dois modos        | INSPEÇÃO |
| Sem endpoint oculto           | —                                                  | inspeção das rotas                        | INSPEÇÃO |

## 7. Contrato de eventos

| Requisito                        | Componente                                                | Status   |
| -------------------------------- | --------------------------------------------------------- | -------- |
| Envelope `DomainEvent`           | `packages/shared-types/src/events/envelope.ts`            | INSPEÇÃO |
| Tipos em `packages/shared-types` | idem                                                      | INSPEÇÃO |
| 9 eventos implementados          | `events/registry.ts`                                      | INSPEÇÃO |
| Schema Zod por evento            | `order-events.ts`, `stock-events.ts`, `payment-events.ts` | INSPEÇÃO |
| Versão inicial 1                 | `EVENT_VERSION_V1`                                        | INSPEÇÃO |
| Testes de validação              | `events.test.ts` (14 casos)                               | INSPEÇÃO |

## 8. RabbitMQ

| Requisito                                    | Componente                                 | Status                 |
| -------------------------------------------- | ------------------------------------------ | ---------------------- |
| Exchange `loja-veloz.events` topic durável   | `packages/messaging/src/topology.ts`       | INSPEÇÃO               |
| DLX `loja-veloz.dlx`                         | idem                                       | INSPEÇÃO               |
| 5 filas mínimas (+1 de auditoria)            | `QUEUE_DEFINITIONS`                        | INSPEÇÃO               |
| Routing keys = nomes de evento               | teste `topology.test.ts` verifica          | INSPEÇÃO               |
| Conexões persistentes, reconexão com backoff | `connection.ts`                            | INSPEÇÃO               |
| Mensagens e filas duráveis                   | `publisher.ts`, `topology.ts`              | INSPEÇÃO               |
| Acknowledgement manual                       | `consumer.ts` — `noAck: false`             | INSPEÇÃO               |
| `prefetch`                                   | `RABBITMQ_PREFETCH`                        | INSPEÇÃO               |
| Publisher confirms                           | `createConfirmChannel` + callback          | INSPEÇÃO               |
| Idempotência por `eventId`                   | `processed_events` transacional            | INSPEÇÃO               |
| Retry limitado                               | `decideFailureRoute`, teto de 20 no schema | `retry-policy.test.ts` | INSPEÇÃO |
| DLQ                                          | `deadLetterQueueName`                      | INSPEÇÃO               |
| Logs de publish/consume/retry/DLQ            | `publisher.ts`, `consumer.ts`              | INSPEÇÃO               |
| Sem retry infinito                           | teste dedicado comprova                    | INSPEÇÃO               |
| Explicar "ao menos uma vez"                  | `idempotency.ts`, `architecture.md` §6     | INSPEÇÃO               |
| Outbox como melhoria, não parcial            | `limitations-and-roadmap.md` §1.3          | INSPEÇÃO               |

## 9. Endpoints

| Endpoint                                                                      | Arquivo                                | Teste                      | Status   |
| ----------------------------------------------------------------------------- | -------------------------------------- | -------------------------- | -------- |
| `GET /health/live` (4×)                                                       | `packages/observability/src/health.ts` | 4 suítes                   | INSPEÇÃO |
| `GET /health/ready` (4×)                                                      | idem                                   | 4 suítes                   | INSPEÇÃO |
| `GET /metrics` (4×)                                                           | `metrics.ts`                           | 2 suítes                   | INSPEÇÃO |
| `POST /api/orders`                                                            | `api-gateway/routes/orders.routes.ts`  | `app.test.ts`              | INSPEÇÃO |
| `GET /api/orders`                                                             | idem                                   | `app.test.ts`              | INSPEÇÃO |
| `GET /api/orders/:id`                                                         | idem                                   | `app.test.ts`              | INSPEÇÃO |
| `GET /api/inventory/:sku`                                                     | `inventory.routes.ts`                  | `app.test.ts`              | INSPEÇÃO |
| `GET /api/payments/:orderId`                                                  | `payments.routes.ts`                   | `app.test.ts`              | INSPEÇÃO |
| `POST /orders`, `GET /orders`, `GET /orders/:id`                              | `order-service/routes/`                | `order.routes.test.ts`     | INSPEÇÃO |
| `GET /inventory/:sku`, `POST /inventory/restock`                              | `inventory-service/routes/`            | `inventory.routes.test.ts` | INSPEÇÃO |
| `GET /payments/:orderId`                                                      | `payment-service/routes/`              | `payment.routes.test.ts`   | INSPEÇÃO |
| Restock protegido e desabilitável                                             | `inventory.controller.ts`              | 5 casos                    | INSPEÇÃO |
| Validação Zod, 404, 409, paginação, limite de body, timeout, CORS, rate limit | ver seções acima                       | testes correspondentes     | INSPEÇÃO |

## 10. Healthchecks e shutdown

| Requisito                       | Componente                      | Status   |
| ------------------------------- | ------------------------------- | -------- |
| Liveness sem dependências       | `health.ts` + teste explícito   | INSPEÇÃO |
| Readiness com dependências, 503 | `health.ts` + teste             | INSPEÇÃO |
| Startup probe tolerante         | `kubernetes/base/*.yaml` — 90 s | INSPEÇÃO |
| SIGTERM e SIGINT                | `shutdown.ts`                   | INSPEÇÃO |
| 8 passos de encerramento        | `server.ts` dos 4 serviços      | INSPEÇÃO |
| Execução única                  | `shuttingDown` + teste dedicado | INSPEÇÃO |

## 11. Docker e Compose

| Requisito                                      | Componente                                                 | Status   |
| ---------------------------------------------- | ---------------------------------------------------------- | -------- |
| Dockerfile por aplicação                       | `apps/*/Dockerfile` (4)                                    | INSPEÇÃO |
| Multi-stage, `node:22-bookworm-slim`           | idem                                                       | INSPEÇÃO |
| Usuário não-root                               | `USER node`                                                | INSPEÇÃO |
| Healthcheck sem curl/wget                      | `node -e "fetch(...)"`                                     | INSPEÇÃO |
| Contexto de build documentado                  | cabeçalho de cada Dockerfile                               | INSPEÇÃO |
| Prisma Client gerado no build                  | estágio `build`                                            | INSPEÇÃO |
| 12 serviços no Compose                         | `docker-compose.yml`                                       | INSPEÇÃO |
| Redes, volumes, healthchecks, restart, limites | idem                                                       | INSPEÇÃO |
| `docker-compose.test.yml`                      | arquivo próprio                                            | INSPEÇÃO |
| Bancos não expostos                            | só Gateway, Grafana, Prometheus, RabbitMQ UI, Jaeger, OTel | INSPEÇÃO |

## 12. Observabilidade

| Requisito                                  | Componente                                    | Status   |
| ------------------------------------------ | --------------------------------------------- | -------- |
| 13 métricas exigidas                       | `packages/*/metrics.ts` + `apps/*/metrics.ts` | INSPEÇÃO |
| Sem labels de alta cardinalidade           | `normalizeRoute`, regra documentada           | INSPEÇÃO |
| Logs JSON com 9 campos                     | `logger.ts` + `mixin`                         | INSPEÇÃO |
| Sem dado sensível em log                   | `redact` + `redactConfig`                     | INSPEÇÃO |
| Tracing dos 7 pontos                       | auto-instrumentação + `withSpan`              | INSPEÇÃO |
| `traceparent` e `correlationId` propagados | `injectTraceContext` em HTTP e AMQP           | INSPEÇÃO |
| Distinção explicada                        | `observability/README.md`                     | INSPEÇÃO |
| Alloy por socket do Docker                 | `config.alloy`                                | INSPEÇÃO |
| Helm values versionados                    | `kubernetes/helm-values/` (4)                 | INSPEÇÃO |

## 13. Kubernetes

| Recurso                           | Arquivo                              | Status   |
| --------------------------------- | ------------------------------------ | -------- |
| Namespace com PSS                 | `base/namespace.yaml`                | INSPEÇÃO |
| Deployments (4) e Services (4)    | `base/*.yaml`                        | INSPEÇÃO |
| ConfigMap                         | `base/configmap-app.yaml`            | INSPEÇÃO |
| ServiceAccounts                   | `base/serviceaccounts.yaml`          | INSPEÇÃO |
| NetworkPolicies                   | `base/networkpolicies.yaml`          | INSPEÇÃO |
| HPA, PDB                          | `base/hpa.yaml`, `base/pdb.yaml`     | INSPEÇÃO |
| ResourceQuota, LimitRange         | `base/limitrange-resourcequota.yaml` | INSPEÇÃO |
| Ingress                           | `base/ingress.yaml`                  | INSPEÇÃO |
| Kustomize base + 3 overlays       | `base/`, `overlays/`                 | INSPEÇÃO |
| Dependências acadêmicas marcadas  | `dependencies-academic.yaml`         | INSPEÇÃO |
| securityContext completo          | 4 Deployments                        | INSPEÇÃO |
| Recursos justificados por serviço | valores distintos + comentário       | INSPEÇÃO |
| Réplicas: 2+ em produção          | overlay de produção usa 3            | INSPEÇÃO |

## 14. Deploy e escala

| Requisito                                            | Componente                         | Status   |
| ---------------------------------------------------- | ---------------------------------- | -------- |
| Rolling Update configurado                           | `maxSurge: 1`, `maxUnavailable: 0` | INSPEÇÃO |
| Probes, grace period, PDB                            | base + overlays                    | INSPEÇÃO |
| Comandos de rollout                                  | `kubernetes/README.md`             | INSPEÇÃO |
| Explicar escolha e limitações                        | ADR-006                            | INSPEÇÃO |
| Canary como evolução, sem falsificar                 | ADR-006 §Alternativas              | INSPEÇÃO |
| HPA v2 com CPU                                       | `base/hpa.yaml`                    | INSPEÇÃO |
| Min, max, alvo, scale-up/down, stabilization         | idem                               | INSPEÇÃO |
| Explicar Metrics Server, VPA, conexões, idempotência | ADR-012                            | INSPEÇÃO |
| KEDA como evolução                                   | ADR-012, roadmap                   | INSPEÇÃO |
| VPA não usado com HPA                                | proibição registrada               | INSPEÇÃO |

## 15. Configuração e segredos

| Requisito                              | Componente                                    | Status   |
| -------------------------------------- | --------------------------------------------- | -------- |
| Diferenciar config e segredo           | `configmap-app.yaml` vs `secret.example.yaml` | INSPEÇÃO |
| `secret.example.yaml` com placeholders | arquivo                                       | INSPEÇÃO |
| Secret real no `.gitignore`            | `.gitignore` + verificação no CI              | INSPEÇÃO |
| Comando `kubectl create secret`        | cabeçalho do exemplo, READMEs                 | INSPEÇÃO |
| Base64 ≠ criptografia                  | declarado em 3 lugares                        | INSPEÇÃO |
| Evoluções (ESO, SOPS, Sealed Secrets)  | roadmap §2.1                                  | INSPEÇÃO |

## 16. CI/CD

| Requisito                            | Componente                             | Status   |
| ------------------------------------ | -------------------------------------- | -------- |
| `ci.yml` com 14 passos               | `.github/workflows/ci.yml`             | INSPEÇÃO |
| `images.yml` com matriz e Trivy      | `.github/workflows/images.yml`         | INSPEÇÃO |
| `deploy-staging.yml` com environment | `.github/workflows/deploy-staging.yml` | INSPEÇÃO |
| Pré-requisitos documentados          | cabeçalho do workflow                  | INSPEÇÃO |
| Permissões mínimas                   | `permissions` por workflow             | INSPEÇÃO |
| `GITHUB_TOKEN` para GHCR             | `images.yml`                           | INSPEÇÃO |
| Tags por SHA e semântica             | `docker/metadata-action`               | INSPEÇÃO |
| Explicar por que não só `latest`     | resumo do `images.yml`                 | INSPEÇÃO |
| `<USUARIO_GITHUB>` consistente       | manifests e `.env.example`             | INSPEÇÃO |

## 17. Terraform

| Requisito                             | Componente                       | Status   |
| ------------------------------------- | -------------------------------- | -------- |
| Provider, versões, variáveis, outputs | `environments/*/`                | INSPEÇÃO |
| VPC, sub-redes, IAM, SG               | `modules/network`, `modules/eks` | INSPEÇÃO |
| EKS + node group                      | `modules/eks`                    | INSPEÇÃO |
| RDS PostgreSQL                        | `modules/database`               | INSPEÇÃO |
| Backend remoto de exemplo             | `backend.tf.example`             | INSPEÇÃO |
| Sem chaves AWS                        | inspeção                         | INSPEÇÃO |
| Comandos documentados                 | `terraform/README.md`            | INSPEÇÃO |
| Custos explicados, NAT desligado      | `README.md` + variável           | INSPEÇÃO |
| Não afirmar `apply`                   | declarado no topo do README      | INSPEÇÃO |

## 18. Testes

| Cenário exigido                      | Onde                                             | Status   |
| ------------------------------------ | ------------------------------------------------ | -------- |
| 1. Criação com sucesso               | unitário + integração                            | INSPEÇÃO |
| 2. Consulta do pedido                | unitário + integração                            | INSPEÇÃO |
| 3. Falha de estoque                  | unitário + integração                            | INSPEÇÃO |
| 4. Falha de pagamento                | unitário + integração                            | INSPEÇÃO |
| 5. Liberação de estoque              | unitário + integração                            | INSPEÇÃO |
| 6. Evento duplicado                  | 3 suítes unitárias                               | INSPEÇÃO |
| 7. Payload inválido                  | 7 variações unitárias + 4 de integração          | INSPEÇÃO |
| 8. Pedido inexistente                | unitário + integração                            | INSPEÇÃO |
| 9. Healthcheck                       | 4 suítes + smoke                                 | INSPEÇÃO |
| 10. Indisponibilidade de dependência | readiness 503, timeout 504, conexão recusada 503 | INSPEÇÃO |
| Determinismo                         | sem `Math.random`; cenários por seed             | INSPEÇÃO |
| Sem internet, sem serviço pago       | stack local                                      | INSPEÇÃO |
| Integração sem mock                  | `docker-compose.test.yml`                        | INSPEÇÃO |

## 19. Segurança

Todos os 21 itens exigidos estão mapeados em `docs/threat-model.md`, com
controle e risco residual. Destaques com **risco residual alto declarado**:
ausência de autenticação (AM-04), ausência de expiração de reserva (AM-03),
ausência de trilha de auditoria (AM-14).

## 20. Documentação

| Arquivo                      | Status   |
| ---------------------------- | -------- |
| `README.md`                  | INSPEÇÃO |
| `docs/architecture.md`       | INSPEÇÃO |
| `docs/runbook.md`            | INSPEÇÃO |
| `docs/troubleshooting.md`    | INSPEÇÃO |
| `docs/threat-model.md`       | INSPEÇÃO |
| `docs/case-study.md`         | INSPEÇÃO |
| `docs/references.md`         | PARCIAL  |
| `docs/theoretical-report.md` | INSPEÇÃO |
| `docs/practical-report.md`   | INSPEÇÃO |
| 12 ADRs                      | INSPEÇÃO |
| 9 diagramas Mermaid          | INSPEÇÃO |

---

## Requisitos não atendidos integralmente

Declarados por honestidade:

| Requisito                             | Estado          | Justificativa                                                                                                         |
| ------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Migrations Prisma versionadas         | **Não geradas** | São geradas por ferramenta com banco no ar; fabricá-las à mão violaria a regra de não inventar artefato gerado        |
| `package-lock.json`                   | **Não gerado**  | Deve vir de `npm install`; lockfile fabricado seria inválido                                                          |
| Referências verificadas               | 3 de ~30        | Sem acesso irrestrito à web; as demais estão marcadas como pendentes em vez de apresentadas como verificadas          |
| Validação por execução                | Nenhuma         | Ambiente sem terminal funcional; registrado no relatório prático                                                      |
| `docker/scripts/migrate-and-start.sh` | Substituído     | Migrations viraram serviços dedicados no Compose e Job no Kubernetes — prática melhor que entrypoint que migra e sobe |
| `docker/rabbitmq/enabled_plugins`     | Removido        | A imagem `3.13-management` já traz o plugin; o arquivo seria inerte                                                   |
| Vídeo pitch                           | Excluído        | Instrução explícita do enunciado                                                                                      |
