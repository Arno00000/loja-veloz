# PROJECT_MANIFEST.md

Manifesto de arquivos autorais do projeto **Pedidos Veloz** (Loja Veloz).

## Convenções

**Status permitidos:** `PENDENTE`, `CRIADO`, `REVISADO`, `VALIDADO`.

- `PENDENTE` — planejado, ainda não escrito.
- `CRIADO` — conteúdo integral escrito.
- `REVISADO` — revisado por inspeção quanto a imports, caminhos, nomes e coerência com os demais arquivos.
- `VALIDADO` — verificado por execução de comando no ambiente do usuário.

> **Aviso de honestidade técnica.** Nenhum arquivo é marcado como `VALIDADO` neste documento,
> porque o ambiente de geração não dispôs de terminal Linux funcional nem de acesso a `npm`, `docker`,
> `kubectl` ou `terraform`. Todos os arquivos entregues estão, no máximo, em `REVISADO`
> (validação por inspeção). O `docs/practical-report.md` e a seção "Revisão de consistência"
> do `README.md` registram explicitamente o que está `PENDENTE DE EXECUÇÃO`.

**Arquivos deliberadamente fora do manifesto** (gerados por ferramenta, nunca escritos à mão):
`package-lock.json`, `node_modules/`, `dist/`, `coverage/`, `apps/*/generated/prisma/`,
`apps/*/prisma/migrations/` (geradas por `prisma migrate dev`), `.terraform/`, `*.tfstate`,
volumes Docker e imagens de contêiner.

---

## Estado da entrega

| Parte | Escopo                                | Estado   |
| ----- | ------------------------------------- | -------- |
| 1     | Arquitetura e manifesto               | CRIADO   |
| 2     | Base do monorepo                      | CRIADO   |
| 3     | Pacotes compartilhados                | CRIADO   |
| 4     | API Gateway                           | CRIADO   |
| 5     | Servico de Pedidos                    | CRIADO   |
| 6     | Servico de Estoque                    | CRIADO   |
| 7     | Servico de Pagamentos                 | CRIADO   |
| 8     | Banco e migrations                    | CRIADO   |
| 9     | RabbitMQ (codigo + documentacao)      | CRIADO   |
| 10    | Testes de integracao, smoke e scripts | CRIADO   |
| 11    | Docker Compose                        | CRIADO   |
| 12    | Observabilidade (configuracoes)       | CRIADO   |
| 13    | Kubernetes                            | CRIADO   |
| 14    | CI/CD                                 | CRIADO   |
| 15    | Terraform                             | CRIADO   |
| 16    | Documentacao e ADRs                   | CRIADO   |
| 17    | Relatorios e rastreabilidade          | CRIADO   |
| 18    | Revisao final                         | REVISADO |

> **Nenhuma parte esta `VALIDADO`.** Nenhum comando foi executado durante a
> construcao do projeto. Ver `docs/consistency-review.md` e
> `README.md` § Comandos de validacao.

> A Parte 9 (topologia do RabbitMQ) ja esta **implementada em codigo** em
> `packages/messaging/src/topology.ts`, `connection.ts`, `publisher.ts` e
> `consumer.ts`. O que resta na Parte 9 e a documentacao operacional
> correspondente em `docs/architecture.md` e `docs/runbook.md`.

## Arquivos autorais acrescentados durante a execucao

Arquivos criados que nao constavam no plano inicial, com a justificativa.

| Caminho                                                                 | Parte | Status | Motivo                                                                                                   |
| ----------------------------------------------------------------------- | ----- | ------ | -------------------------------------------------------------------------------------------------------- |
| `.prettierignore`                                                       | 2     | CRIADO | `format:check` falharia sobre codigo gerado e lockfile                                                   |
| `packages/observability/tracing.js`                                     | 3     | CRIADO | Ponto de entrada secundario, para iniciar o OpenTelemetry sem carregar o Express antes da instrumentacao |
| `packages/observability/tracing.d.ts`                                   | 3     | CRIADO | Tipos do ponto de entrada acima                                                                          |
| `apps/api-gateway/src/instrumentation.ts`                               | 4     | CRIADO | Bootstrap de telemetria como primeiro import de `server.ts`                                              |
| `apps/api-gateway/src/upstream.ts`                                      | 4     | CRIADO | Consta como item 065 do plano                                                                            |
| `apps/order-service/src/instrumentation.ts`                             | 5     | CRIADO | Mesmo motivo                                                                                             |
| `apps/order-service/src/__tests__/fakes.ts`                             | 5     | CRIADO | Repositorio e publicador em memoria compartilhados pelas suites                                          |
| `apps/inventory-service/src/instrumentation.ts`                         | 6     | CRIADO | Mesmo motivo                                                                                             |
| `apps/inventory-service/src/repositories/processed-event.repository.ts` | 6     | CRIADO | Guarda de idempotencia, equivalente ao item 083 do Servico de Pedidos                                    |
| `apps/inventory-service/src/__tests__/fakes.ts`                         | 6     | CRIADO | Dubles de teste                                                                                          |
| `apps/payment-service/src/instrumentation.ts`                           | 7     | CRIADO | Mesmo motivo                                                                                             |
| `apps/payment-service/src/repositories/processed-event.repository.ts`   | 7     | CRIADO | Guarda de idempotencia                                                                                   |
| `apps/payment-service/src/__tests__/fakes.ts`                           | 7     | CRIADO | Dubles de teste                                                                                          |
| `apps/order-service/src/seed.ts`                                        | 8     | CRIADO | Seed em `src/` para ser compilado e rodar sem `tsx` na imagem de producao                                |
| `apps/inventory-service/src/seed.ts`                                    | 8     | CRIADO | Idem; `prisma/seed.ts` passou a ser apenas o gancho do `prisma db seed`                                  |
| `.github/dependabot.yml`                                                | 14    | CRIADO | Atualizacao de dependencias, exigida pela secao de seguranca                                             |
| `terraform/environments/production/terraform.tfvars.example`            | 15    | CRIADO | Faltava par do exemplo de staging                                                                        |

**Item removido do plano:** `docker/rabbitmq/enabled_plugins` (item 140). A
imagem `rabbitmq:3.13-management` ja traz o plugin de gerenciamento
habilitado; o arquivo seria inerte. Removido em vez de criado vazio.

**Documentos acrescentados nas Partes 16 a 18:**

| Caminho                           | Parte | Status | Motivo                                                                          |
| --------------------------------- | ----- | ------ | ------------------------------------------------------------------------------- |
| `docs/limitations-and-roadmap.md` | 17    | CRIADO | Limitacoes (secao 46) e melhorias (secao 47) do enunciado, em documento proprio |
| `docs/consistency-review.md`      | 18    | CRIADO | Revisao de consistencia (secao 44), com a tabela item/resultado/evidencia       |

**Item nao criado:** `docker/scripts/migrate-and-start.sh` (item 137). As
migrations passaram a rodar como servicos dedicados no Compose
(`*-migrate`) e como Job no Kubernetes, o que espelha a pratica correta de
producao melhor do que um entrypoint que migra e sobe no mesmo processo.

Arquivos do plano ainda **nao** criados e que serao entregues nas partes
seguintes: itens 135 a 231 das tabelas abaixo.

---

## Parte 1 — Arquitetura e manifesto

| Nº  | Caminho               | Parte | Status | Dependências |
| --- | --------------------- | ----- | ------ | ------------ |
| 001 | `PROJECT_MANIFEST.md` | 1     | CRIADO | —            |

## Parte 2 — Base do monorepo

| Nº  | Caminho              | Parte | Status | Dependências                          |
| --- | -------------------- | ----- | ------ | ------------------------------------- |
| 002 | `package.json`       | 2     | CRIADO | workspaces em `apps/*` e `packages/*` |
| 003 | `tsconfig.base.json` | 2     | CRIADO | —                                     |
| 004 | `.nvmrc`             | 2     | CRIADO | —                                     |
| 005 | `.editorconfig`      | 2     | CRIADO | —                                     |
| 006 | `.gitignore`         | 2     | CRIADO | —                                     |
| 007 | `.dockerignore`      | 2     | CRIADO | —                                     |
| 008 | `.env.example`       | 2     | CRIADO | `docker-compose.yml`                  |
| 009 | `eslint.config.js`   | 2     | CRIADO | 002                                   |
| 010 | `prettier.config.js` | 2     | CRIADO | 002                                   |
| 011 | `Makefile`           | 2     | CRIADO | 002, 138                              |
| 012 | `jest.preset.js`     | 2     | CRIADO | 002                                   |

## Parte 3 — Pacotes compartilhados

| Nº  | Caminho                                                    | Parte | Status | Dependências  |
| --- | ---------------------------------------------------------- | ----- | ------ | ------------- |
| 013 | `packages/shared-types/package.json`                       | 3     | CRIADO | 002           |
| 014 | `packages/shared-types/tsconfig.json`                      | 3     | CRIADO | 003           |
| 015 | `packages/shared-types/jest.config.js`                     | 3     | CRIADO | 012           |
| 016 | `packages/shared-types/src/index.ts`                       | 3     | CRIADO | 017–023       |
| 017 | `packages/shared-types/src/events/envelope.ts`             | 3     | CRIADO | zod           |
| 018 | `packages/shared-types/src/events/order-events.ts`         | 3     | CRIADO | 017           |
| 019 | `packages/shared-types/src/events/stock-events.ts`         | 3     | CRIADO | 017           |
| 020 | `packages/shared-types/src/events/payment-events.ts`       | 3     | CRIADO | 017           |
| 021 | `packages/shared-types/src/events/registry.ts`             | 3     | CRIADO | 018–020       |
| 022 | `packages/shared-types/src/domain/order-status.ts`         | 3     | CRIADO | zod           |
| 023 | `packages/shared-types/src/domain/pagination.ts`           | 3     | CRIADO | zod           |
| 024 | `packages/shared-types/src/__tests__/order-status.test.ts` | 3     | CRIADO | 022           |
| 025 | `packages/shared-types/src/__tests__/events.test.ts`       | 3     | CRIADO | 021           |
| 026 | `packages/shared-config/package.json`                      | 3     | CRIADO | 002           |
| 027 | `packages/shared-config/tsconfig.json`                     | 3     | CRIADO | 003           |
| 028 | `packages/shared-config/jest.config.js`                    | 3     | CRIADO | 012           |
| 029 | `packages/shared-config/src/index.ts`                      | 3     | CRIADO | 030, 031      |
| 030 | `packages/shared-config/src/base-schema.ts`                | 3     | CRIADO | zod           |
| 031 | `packages/shared-config/src/load-config.ts`                | 3     | CRIADO | 030           |
| 032 | `packages/shared-config/src/__tests__/load-config.test.ts` | 3     | CRIADO | 031           |
| 033 | `packages/observability/package.json`                      | 3     | CRIADO | 002           |
| 034 | `packages/observability/tsconfig.json`                     | 3     | CRIADO | 003           |
| 035 | `packages/observability/jest.config.js`                    | 3     | CRIADO | 012           |
| 036 | `packages/observability/src/index.ts`                      | 3     | CRIADO | 037–046       |
| 037 | `packages/observability/src/logger.ts`                     | 3     | CRIADO | pino          |
| 038 | `packages/observability/src/tracing.ts`                    | 3     | CRIADO | opentelemetry |
| 039 | `packages/observability/src/metrics.ts`                    | 3     | CRIADO | prom-client   |
| 040 | `packages/observability/src/correlation.ts`                | 3     | CRIADO | 037           |
| 041 | `packages/observability/src/http-observability.ts`         | 3     | CRIADO | 037, 039, 040 |
| 042 | `packages/observability/src/health.ts`                     | 3     | CRIADO | express       |
| 043 | `packages/observability/src/errors.ts`                     | 3     | CRIADO | zod           |
| 044 | `packages/observability/src/shutdown.ts`                   | 3     | CRIADO | 037           |
| 045 | `packages/observability/src/__tests__/errors.test.ts`      | 3     | CRIADO | 043           |
| 046 | `packages/observability/src/__tests__/shutdown.test.ts`    | 3     | CRIADO | 044           |
| 047 | `packages/messaging/package.json`                          | 3     | CRIADO | 002           |
| 048 | `packages/messaging/tsconfig.json`                         | 3     | CRIADO | 003           |
| 049 | `packages/messaging/jest.config.js`                        | 3     | CRIADO | 012           |
| 050 | `packages/messaging/src/index.ts`                          | 3     | CRIADO | 051–056       |
| 051 | `packages/messaging/src/topology.ts`                       | 3     | CRIADO | 016           |
| 052 | `packages/messaging/src/connection.ts`                     | 3     | CRIADO | amqplib, 036  |
| 053 | `packages/messaging/src/publisher.ts`                      | 3     | CRIADO | 052, 016      |
| 054 | `packages/messaging/src/consumer.ts`                       | 3     | CRIADO | 052, 051      |
| 055 | `packages/messaging/src/idempotency.ts`                    | 3     | CRIADO | —             |
| 056 | `packages/messaging/src/metrics.ts`                        | 3     | CRIADO | prom-client   |
| 057 | `packages/messaging/src/__tests__/topology.test.ts`        | 3     | CRIADO | 051           |
| 058 | `packages/messaging/src/__tests__/retry-policy.test.ts`    | 3     | CRIADO | 054           |

## Parte 4 — API Gateway

| Nº  | Caminho                                           | Parte | Status | Dependências  |
| --- | ------------------------------------------------- | ----- | ------ | ------------- |
| 059 | `apps/api-gateway/package.json`                   | 4     | CRIADO | 013, 026, 033 |
| 060 | `apps/api-gateway/tsconfig.json`                  | 4     | CRIADO | 003           |
| 061 | `apps/api-gateway/jest.config.js`                 | 4     | CRIADO | 012           |
| 062 | `apps/api-gateway/.env.example`                   | 4     | CRIADO | 008           |
| 063 | `apps/api-gateway/Dockerfile`                     | 4     | CRIADO | 007, 059      |
| 064 | `apps/api-gateway/src/config.ts`                  | 4     | CRIADO | 029           |
| 065 | `apps/api-gateway/src/upstream.ts`                | 4     | CRIADO | 064, 043      |
| 066 | `apps/api-gateway/src/app.ts`                     | 4     | CRIADO | 064–070       |
| 067 | `apps/api-gateway/src/server.ts`                  | 4     | CRIADO | 066, 038, 044 |
| 068 | `apps/api-gateway/src/routes/orders.routes.ts`    | 4     | CRIADO | 065           |
| 069 | `apps/api-gateway/src/routes/inventory.routes.ts` | 4     | CRIADO | 065           |
| 070 | `apps/api-gateway/src/routes/payments.routes.ts`  | 4     | CRIADO | 065           |
| 071 | `apps/api-gateway/src/__tests__/app.test.ts`      | 4     | CRIADO | 066           |

## Parte 5 — Serviço de Pedidos

| Nº  | Caminho                                                             | Parte | Status | Dependências       |
| --- | ------------------------------------------------------------------- | ----- | ------ | ------------------ |
| 072 | `apps/order-service/package.json`                                   | 5     | CRIADO | 013, 026, 033, 047 |
| 073 | `apps/order-service/tsconfig.json`                                  | 5     | CRIADO | 003                |
| 074 | `apps/order-service/jest.config.js`                                 | 5     | CRIADO | 012                |
| 075 | `apps/order-service/.env.example`                                   | 5     | CRIADO | 008                |
| 076 | `apps/order-service/Dockerfile`                                     | 5     | CRIADO | 007, 072, 077      |
| 077 | `apps/order-service/prisma/schema.prisma`                           | 5     | CRIADO | —                  |
| 078 | `apps/order-service/prisma/seed.ts`                                 | 5     | CRIADO | 077                |
| 079 | `apps/order-service/src/config.ts`                                  | 5     | CRIADO | 029                |
| 080 | `apps/order-service/src/db/prisma.ts`                               | 5     | CRIADO | 077                |
| 081 | `apps/order-service/src/schemas/order.schema.ts`                    | 5     | CRIADO | zod                |
| 082 | `apps/order-service/src/repositories/order.repository.ts`           | 5     | CRIADO | 080                |
| 083 | `apps/order-service/src/repositories/processed-event.repository.ts` | 5     | CRIADO | 080                |
| 084 | `apps/order-service/src/services/order.service.ts`                  | 5     | CRIADO | 082, 022, 086      |
| 085 | `apps/order-service/src/metrics.ts`                                 | 5     | CRIADO | prom-client        |
| 086 | `apps/order-service/src/messaging/publishers.ts`                    | 5     | CRIADO | 053                |
| 087 | `apps/order-service/src/messaging/consumers.ts`                     | 5     | CRIADO | 054, 084           |
| 088 | `apps/order-service/src/controllers/order.controller.ts`            | 5     | CRIADO | 084, 081           |
| 089 | `apps/order-service/src/routes/order.routes.ts`                     | 5     | CRIADO | 088                |
| 090 | `apps/order-service/src/app.ts`                                     | 5     | CRIADO | 089, 041, 042      |
| 091 | `apps/order-service/src/server.ts`                                  | 5     | CRIADO | 090, 087, 044      |
| 092 | `apps/order-service/src/__tests__/order.service.test.ts`            | 5     | CRIADO | 084                |
| 093 | `apps/order-service/src/__tests__/order.routes.test.ts`             | 5     | CRIADO | 090                |

## Parte 6 — Serviço de Estoque

| Nº  | Caminho                                                           | Parte | Status | Dependências       |
| --- | ----------------------------------------------------------------- | ----- | ------ | ------------------ |
| 094 | `apps/inventory-service/package.json`                             | 6     | CRIADO | 013, 026, 033, 047 |
| 095 | `apps/inventory-service/tsconfig.json`                            | 6     | CRIADO | 003                |
| 096 | `apps/inventory-service/jest.config.js`                           | 6     | CRIADO | 012                |
| 097 | `apps/inventory-service/.env.example`                             | 6     | CRIADO | 008                |
| 098 | `apps/inventory-service/Dockerfile`                               | 6     | CRIADO | 007, 094, 099      |
| 099 | `apps/inventory-service/prisma/schema.prisma`                     | 6     | CRIADO | —                  |
| 100 | `apps/inventory-service/prisma/seed.ts`                           | 6     | CRIADO | 099                |
| 101 | `apps/inventory-service/src/config.ts`                            | 6     | CRIADO | 029                |
| 102 | `apps/inventory-service/src/db/prisma.ts`                         | 6     | CRIADO | 099                |
| 103 | `apps/inventory-service/src/schemas/inventory.schema.ts`          | 6     | CRIADO | zod                |
| 104 | `apps/inventory-service/src/repositories/inventory.repository.ts` | 6     | CRIADO | 102                |
| 105 | `apps/inventory-service/src/services/inventory.service.ts`        | 6     | CRIADO | 104, 106           |
| 106 | `apps/inventory-service/src/metrics.ts`                           | 6     | CRIADO | prom-client        |
| 107 | `apps/inventory-service/src/messaging/publishers.ts`              | 6     | CRIADO | 053                |
| 108 | `apps/inventory-service/src/messaging/consumers.ts`               | 6     | CRIADO | 054, 105           |
| 109 | `apps/inventory-service/src/controllers/inventory.controller.ts`  | 6     | CRIADO | 105                |
| 110 | `apps/inventory-service/src/routes/inventory.routes.ts`           | 6     | CRIADO | 109                |
| 111 | `apps/inventory-service/src/app.ts`                               | 6     | CRIADO | 110                |
| 112 | `apps/inventory-service/src/server.ts`                            | 6     | CRIADO | 111, 108           |
| 113 | `apps/inventory-service/src/__tests__/inventory.service.test.ts`  | 6     | CRIADO | 105                |
| 114 | `apps/inventory-service/src/__tests__/inventory.routes.test.ts`   | 6     | CRIADO | 111                |

## Parte 7 — Serviço de Pagamentos

| Nº  | Caminho                                                          | Parte | Status | Dependências       |
| --- | ---------------------------------------------------------------- | ----- | ------ | ------------------ |
| 115 | `apps/payment-service/package.json`                              | 7     | CRIADO | 013, 026, 033, 047 |
| 116 | `apps/payment-service/tsconfig.json`                             | 7     | CRIADO | 003                |
| 117 | `apps/payment-service/jest.config.js`                            | 7     | CRIADO | 012                |
| 118 | `apps/payment-service/.env.example`                              | 7     | CRIADO | 008                |
| 119 | `apps/payment-service/Dockerfile`                                | 7     | CRIADO | 007, 115, 120      |
| 120 | `apps/payment-service/prisma/schema.prisma`                      | 7     | CRIADO | —                  |
| 121 | `apps/payment-service/src/config.ts`                             | 7     | CRIADO | 029                |
| 122 | `apps/payment-service/src/db/prisma.ts`                          | 7     | CRIADO | 120                |
| 123 | `apps/payment-service/src/repositories/payment.repository.ts`    | 7     | CRIADO | 122                |
| 124 | `apps/payment-service/src/services/payment-gateway.simulator.ts` | 7     | CRIADO | 121                |
| 125 | `apps/payment-service/src/services/payment.service.ts`           | 7     | CRIADO | 123, 124           |
| 126 | `apps/payment-service/src/metrics.ts`                            | 7     | CRIADO | prom-client        |
| 127 | `apps/payment-service/src/messaging/publishers.ts`               | 7     | CRIADO | 053                |
| 128 | `apps/payment-service/src/messaging/consumers.ts`                | 7     | CRIADO | 054, 125           |
| 129 | `apps/payment-service/src/controllers/payment.controller.ts`     | 7     | CRIADO | 125                |
| 130 | `apps/payment-service/src/routes/payment.routes.ts`              | 7     | CRIADO | 129                |
| 131 | `apps/payment-service/src/app.ts`                                | 7     | CRIADO | 130                |
| 132 | `apps/payment-service/src/server.ts`                             | 7     | CRIADO | 131, 128           |
| 133 | `apps/payment-service/src/__tests__/payment.simulator.test.ts`   | 7     | CRIADO | 124                |
| 134 | `apps/payment-service/src/__tests__/payment.routes.test.ts`      | 7     | CRIADO | 131                |

## Parte 8 — Banco de dados

| Nº  | Caminho                                         | Parte | Status | Dependências  |
| --- | ----------------------------------------------- | ----- | ------ | ------------- |
| 135 | `database/postgres-init/01-create-databases.sh` | 8     | CRIADO | 138           |
| 136 | `database/README.md`                            | 8     | CRIADO | 135           |
| 137 | `docker/scripts/migrate-and-start.sh`           | 8     | CRIADO | 076, 098, 119 |

## Parte 11 — Docker

| Nº  | Caminho                           | Parte | Status | Dependências                     |
| --- | --------------------------------- | ----- | ------ | -------------------------------- |
| 138 | `docker-compose.yml`              | 11    | CRIADO | 063, 076, 098, 119, 135, 141–147 |
| 139 | `docker-compose.test.yml`         | 11    | CRIADO | 135                              |
| 140 | `docker/rabbitmq/enabled_plugins` | 11    | CRIADO | 138                              |

## Parte 12 — Observabilidade

| Nº  | Caminho                                                          | Parte | Status | Dependências |
| --- | ---------------------------------------------------------------- | ----- | ------ | ------------ |
| 141 | `observability/prometheus/prometheus.yml`                        | 12    | CRIADO | 138          |
| 142 | `observability/otel-collector/otel-collector-config.yml`         | 12    | CRIADO | 138          |
| 143 | `observability/loki/loki-config.yml`                             | 12    | CRIADO | 138          |
| 144 | `observability/alloy/config.alloy`                               | 12    | CRIADO | 138, 143     |
| 145 | `observability/grafana/provisioning/datasources/datasources.yml` | 12    | CRIADO | 138          |
| 146 | `observability/grafana/provisioning/dashboards/dashboards.yml`   | 12    | CRIADO | 147          |
| 147 | `observability/grafana/dashboards/pedidos-veloz-overview.json`   | 12    | CRIADO | 141          |
| 148 | `observability/prometheus/alert-rules.yml`                       | 12    | CRIADO | 141          |
| 149 | `observability/README.md`                                        | 12    | CRIADO | 141–148      |

## Parte 13 — Kubernetes

| Nº  | Caminho                                                      | Parte | Status | Dependências |
| --- | ------------------------------------------------------------ | ----- | ------ | ------------ |
| 150 | `kubernetes/base/namespace.yaml`                             | 13    | CRIADO | —            |
| 151 | `kubernetes/base/serviceaccounts.yaml`                       | 13    | CRIADO | 150          |
| 152 | `kubernetes/base/configmap-app.yaml`                         | 13    | CRIADO | 150          |
| 153 | `kubernetes/base/secret.example.yaml`                        | 13    | CRIADO | 150          |
| 154 | `kubernetes/base/api-gateway.yaml`                           | 13    | CRIADO | 151–153      |
| 155 | `kubernetes/base/order-service.yaml`                         | 13    | CRIADO | 151–153      |
| 156 | `kubernetes/base/inventory-service.yaml`                     | 13    | CRIADO | 151–153      |
| 157 | `kubernetes/base/payment-service.yaml`                       | 13    | CRIADO | 151–153      |
| 158 | `kubernetes/base/hpa.yaml`                                   | 13    | CRIADO | 154–157      |
| 159 | `kubernetes/base/pdb.yaml`                                   | 13    | CRIADO | 154–157      |
| 160 | `kubernetes/base/networkpolicies.yaml`                       | 13    | CRIADO | 150          |
| 161 | `kubernetes/base/ingress.yaml`                               | 13    | CRIADO | 154          |
| 162 | `kubernetes/base/limitrange-resourcequota.yaml`              | 13    | CRIADO | 150          |
| 163 | `kubernetes/base/kustomization.yaml`                         | 13    | CRIADO | 150–162      |
| 164 | `kubernetes/overlays/development/kustomization.yaml`         | 13    | CRIADO | 163          |
| 165 | `kubernetes/overlays/development/patch-development.yaml`     | 13    | CRIADO | 164          |
| 166 | `kubernetes/overlays/development/dependencies-academic.yaml` | 13    | CRIADO | 164          |
| 167 | `kubernetes/overlays/staging/kustomization.yaml`             | 13    | CRIADO | 163          |
| 168 | `kubernetes/overlays/staging/patch-staging.yaml`             | 13    | CRIADO | 167          |
| 169 | `kubernetes/overlays/production/kustomization.yaml`          | 13    | CRIADO | 163          |
| 170 | `kubernetes/overlays/production/patch-production.yaml`       | 13    | CRIADO | 169          |
| 171 | `kubernetes/helm-values/kube-prometheus-stack.values.yaml`   | 13    | CRIADO | —            |
| 172 | `kubernetes/helm-values/loki.values.yaml`                    | 13    | CRIADO | —            |
| 173 | `kubernetes/helm-values/alloy.values.yaml`                   | 13    | CRIADO | —            |
| 174 | `kubernetes/helm-values/jaeger.values.yaml`                  | 13    | CRIADO | —            |
| 175 | `kubernetes/README.md`                                       | 13    | CRIADO | 150–174      |

## Parte 14 — CI/CD

| Nº  | Caminho                                | Parte | Status | Dependências       |
| --- | -------------------------------------- | ----- | ------ | ------------------ |
| 176 | `.github/workflows/ci.yml`             | 14    | CRIADO | 002, 138, 163      |
| 177 | `.github/workflows/images.yml`         | 14    | CRIADO | 063, 076, 098, 119 |
| 178 | `.github/workflows/deploy-staging.yml` | 14    | CRIADO | 167, 177           |
| 179 | `.github/dependabot.yml`               | 14    | CRIADO | —                  |

## Parte 15 — Terraform

| Nº  | Caminho                                                      | Parte | Status | Dependências |
| --- | ------------------------------------------------------------ | ----- | ------ | ------------ |
| 180 | `terraform/README.md`                                        | 15    | CRIADO | 181–198      |
| 181 | `terraform/modules/network/main.tf`                          | 15    | CRIADO | —            |
| 182 | `terraform/modules/network/variables.tf`                     | 15    | CRIADO | —            |
| 183 | `terraform/modules/network/outputs.tf`                       | 15    | CRIADO | 181          |
| 184 | `terraform/modules/eks/main.tf`                              | 15    | CRIADO | 183          |
| 185 | `terraform/modules/eks/variables.tf`                         | 15    | CRIADO | —            |
| 186 | `terraform/modules/eks/outputs.tf`                           | 15    | CRIADO | 184          |
| 187 | `terraform/modules/database/main.tf`                         | 15    | CRIADO | 183          |
| 188 | `terraform/modules/database/variables.tf`                    | 15    | CRIADO | —            |
| 189 | `terraform/modules/database/outputs.tf`                      | 15    | CRIADO | 187          |
| 190 | `terraform/environments/staging/main.tf`                     | 15    | CRIADO | 181–189      |
| 191 | `terraform/environments/staging/variables.tf`                | 15    | CRIADO | —            |
| 192 | `terraform/environments/staging/outputs.tf`                  | 15    | CRIADO | 190          |
| 193 | `terraform/environments/staging/terraform.tfvars.example`    | 15    | CRIADO | 191          |
| 194 | `terraform/environments/staging/backend.tf.example`          | 15    | CRIADO | —            |
| 195 | `terraform/environments/production/main.tf`                  | 15    | CRIADO | 181–189      |
| 196 | `terraform/environments/production/variables.tf`             | 15    | CRIADO | —            |
| 197 | `terraform/environments/production/outputs.tf`               | 15    | CRIADO | 195          |
| 198 | `terraform/environments/production/terraform.tfvars.example` | 15    | CRIADO | 196          |

## Parte 10 — Testes de integração, smoke e scripts

| Nº  | Caminho                                            | Parte | Status | Dependências |
| --- | -------------------------------------------------- | ----- | ------ | ------------ |
| 199 | `tests/integration/jest.config.js`                 | 10    | CRIADO | 012          |
| 200 | `tests/integration/order-flow.integration.test.ts` | 10    | CRIADO | 138, 201     |
| 201 | `tests/integration/helpers/http.ts`                | 10    | CRIADO | —            |
| 202 | `tests/smoke/smoke.sh`                             | 10    | CRIADO | 138          |
| 203 | `tests/smoke/smoke.ps1`                            | 10    | CRIADO | 138          |
| 204 | `tests/README.md`                                  | 10    | CRIADO | 199–203      |
| 205 | `scripts/seed-all.sh`                              | 10    | CRIADO | 078, 100     |
| 206 | `scripts/create-order.sh`                          | 10    | CRIADO | 138          |
| 207 | `scripts/create-order.ps1`                         | 10    | CRIADO | 138          |

## Partes 16 e 17 — Documentação e relatórios

| Nº  | Caminho                                            | Parte | Status | Dependências   |
| --- | -------------------------------------------------- | ----- | ------ | -------------- |
| 208 | `README.md`                                        | 16    | CRIADO | todo o projeto |
| 209 | `docs/architecture.md`                             | 16    | CRIADO | 210            |
| 210 | `docs/diagrams/README.md`                          | 16    | CRIADO | —              |
| 211 | `docs/runbook.md`                                  | 16    | CRIADO | 138, 163       |
| 212 | `docs/troubleshooting.md`                          | 16    | CRIADO | todo o projeto |
| 213 | `docs/threat-model.md`                             | 16    | CRIADO | —              |
| 214 | `docs/case-study.md`                               | 16    | CRIADO | 215            |
| 215 | `docs/references.md`                               | 16    | CRIADO | —              |
| 216 | `docs/theoretical-report.md`                       | 17    | CRIADO | 215            |
| 217 | `docs/practical-report.md`                         | 17    | CRIADO | 215            |
| 218 | `docs/traceability-matrix.md`                      | 17    | CRIADO | todo o projeto |
| 219 | `docs/limitations-and-roadmap.md`                  | 17    | CRIADO | —              |
| 220 | `docs/adr/ADR-001-monorepo-npm-workspaces.md`      | 16    | CRIADO | —              |
| 221 | `docs/adr/ADR-002-microsservicos.md`               | 16    | CRIADO | —              |
| 222 | `docs/adr/ADR-003-rabbitmq.md`                     | 16    | CRIADO | —              |
| 223 | `docs/adr/ADR-004-bancos-logicamente-separados.md` | 16    | CRIADO | —              |
| 224 | `docs/adr/ADR-005-kubernetes.md`                   | 16    | CRIADO | —              |
| 225 | `docs/adr/ADR-006-rolling-update.md`               | 16    | CRIADO | —              |
| 226 | `docs/adr/ADR-007-opentelemetry.md`                | 16    | CRIADO | —              |
| 227 | `docs/adr/ADR-008-sem-service-mesh.md`             | 16    | CRIADO | —              |
| 228 | `docs/adr/ADR-009-github-actions-ghcr.md`          | 16    | CRIADO | —              |
| 229 | `docs/adr/ADR-010-terraform-aws.md`                | 16    | CRIADO | —              |
| 230 | `docs/adr/ADR-011-kustomize.md`                    | 16    | CRIADO | —              |
| 231 | `docs/adr/ADR-012-hpa-cpu.md`                      | 16    | CRIADO | —              |

---

## Regra de conclusão

O projeto **não** deve ser declarado concluído enquanto qualquer linha desta tabela estiver com
status `PENDENTE`. A passagem de `CRIADO` para `REVISADO` ocorre na Parte 18 (revisão final).
A passagem para `VALIDADO` só pode ser feita pelo usuário, executando os comandos listados em
`README.md` § "Comandos de validação" e registrando o resultado em `docs/practical-report.md`.
