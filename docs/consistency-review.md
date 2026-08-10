# Revisão de consistência — Parte 18

Revisão final cruzando nomes, caminhos, portas e contratos entre todos os
arquivos do projeto.

## Legenda

- `VALIDADO POR EXECUÇÃO` — comando realmente executado, resultado observado
- `VALIDADO POR INSPEÇÃO` — conferido lendo e cruzando arquivos
- `PENDENTE DE EXECUÇÃO` — depende do ambiente do leitor

**Nenhum item deste projeto está `VALIDADO POR EXECUÇÃO`.** O ambiente de
geração não dispôs de terminal funcional.

---

## 1. Itens verificados

| Item verificado                                                | Resultado       | Evidência                                                                                                                  |
| -------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Todas as 6 filas declaradas têm consumidor registrado          | OK              | Busca por `QUEUES.*` em `apps/`: 6 ocorrências, uma por fila de `QUEUE_DEFINITIONS`                                        |
| Os 4 serviços usam o ponto de entrada dedicado do tracing      | OK              | Busca por `@loja-veloz/observability/tracing`: 4 arquivos `instrumentation.ts` + `tracing.js`                              |
| `instrumentation` é o primeiro import de todo `server.ts`      | OK              | Inspeção dos 4 arquivos                                                                                                    |
| Routing keys idênticas aos `eventType`                         | OK              | `topology.ts` usa apenas constantes de `EVENT_TYPES`; teste `topology.test.ts` verifica contra `ALL_EVENT_TYPES`           |
| 9 eventos no catálogo, todos com schema Zod                    | OK              | `EVENT_SCHEMAS` cobre `ALL_EVENT_TYPES`; teste compara as duas listas                                                      |
| Portas coerentes entre código, Compose e Kubernetes            | OK              | 8080/3001/3002/3003 em `config.ts`, `docker-compose.yml`, `configmap-app.yaml`, Deployments e Dockerfiles                  |
| Nomes de banco e usuário coerentes                             | OK              | `01-create-databases.sh`, `.env.example`, `apps/*/.env.example`, `secret.example.yaml`                                     |
| Variáveis de ambiente declaradas em schema                     | OK              | Todo `process.env` passa por `loadConfig`; nenhuma leitura direta em módulo de domínio                                     |
| Nenhum import para arquivo inexistente                         | OK por inspeção | Cruzamento manual dos imports relativos                                                                                    |
| Scripts referenciados nos workflows existem                    | OK              | `tests/smoke/smoke.sh`, `npm run test:integration` → `tests/integration/jest.config.js`                                    |
| Nenhum Secret real versionado                                  | OK              | Só `secret.example.yaml` com `SUBSTITUIR_*`; `.gitignore` cobre `secret.yaml`, `.env`, `*.tfstate`, `terraform.tfvars`     |
| Imagens seguem o padrão `<USUARIO_GITHUB>`                     | OK              | `kustomization.yaml` (base e overlays), `.env.example`, workflows                                                          |
| Sem `Math.random` no código de produção                        | OK              | Simulador decide apenas por comparação de `customerId`                                                                     |
| Retry infinito impossível                                      | OK              | `RABBITMQ_MAX_RETRIES` com teto 20 no schema; teste dedicado percorre até a DLQ                                            |
| Liveness não consulta dependência                              | OK              | `health.ts`: `/health/live` não recebe `dependencies`; teste explícito                                                     |
| Nenhum controle de segurança desligado em serviço da aplicação | OK              | As 2 exceções (`readOnlyRootFilesystem: false`) são Postgres e RabbitMQ do overlay de desenvolvimento, marcadas no arquivo |

## 2. Correções feitas durante a revisão

| #   | Problema encontrado                                                                                                             | Correção                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | `PaymentFailedEvent` inferido do schema de _payload_ em vez do de _evento_                                                      | Corrigido para `paymentFailedEventSchema`                                        |
| 2   | `eslint.config.js` com um global inválido e indentação quebrada                                                                 | Substituído por `URL`                                                            |
| 3   | Teste de `redactConfig` dependia do `pathname` de URL sem caminho, cujo comportamento varia                                     | Trocado por URL com vhost explícito                                              |
| 4   | `publisher.ts` reexportava `EVENT_TYPES`, criando ambiguidade no índice do pacote                                               | Reexport removido                                                                |
| 5   | Patch do overlay de desenvolvimento tocava em `containers` com nome genérico — **acrescentaria** um contêiner em vez de alterar | Separado: patch estratégico só para `replicas`/`strategy`; recursos por JSON6902 |
| 6   | `prisma` era devDependency; a imagem final não conseguiria rodar `migrate deploy`                                               | Movido para `dependencies` nos 3 serviços                                        |
| 7   | Seeds em `prisma/seed.ts` exigiriam `tsx`, ausente na imagem de produção                                                        | Movidos para `src/seed.ts`; `prisma/seed.ts` virou gancho de uma linha           |
| 8   | Teste de integração usava `import()` dinâmico no meio do caso                                                                   | `waitFor` importado no topo                                                      |
| 9   | `docker/rabbitmq/enabled_plugins` seria inerte (a imagem `management` já traz o plugin)                                         | Removido do plano em vez de criado vazio                                         |
| 10  | `docker/scripts/migrate-and-start.sh` misturaria migração e inicialização                                                       | Substituído por serviços `*-migrate` no Compose e Job no Kubernetes              |

## 3. Pendente de execução

| Comando                          | O que valida                                              |
| -------------------------------- | --------------------------------------------------------- |
| `npm install`                    | Resolução de dependências; **gera o `package-lock.json`** |
| `npm run lint`                   | Regras de ESLint em todo o monorepo                       |
| `npm run format:check`           | Formatação Prettier                                       |
| `npm run prisma:generate`        | Geração do client nos 3 serviços                          |
| `npm run typecheck`              | Tipos, incluindo os pontos de risco do OpenTelemetry      |
| `npm run test`                   | ~150 casos unitários                                      |
| `npm run build`                  | Compilação dos 8 workspaces                               |
| `docker compose config`          | Sintaxe e resolução de variáveis                          |
| `docker compose up --build`      | Build das 4 imagens e subida dos 12 serviços              |
| `npm run test:integration`       | Fluxo completo contra a stack real                        |
| `bash tests/smoke/smoke.sh`      | Caminho crítico                                           |
| `kubectl kustomize` (3 overlays) | Renderização dos manifests                                |
| `terraform fmt` / `validate`     | Formatação e sintaxe do IaC                               |

## 4. Riscos conhecidos de primeira execução

Pontos com maior probabilidade de exigir ajuste, com a correção antecipada:

| Risco                                          | Sintoma esperado                    | Correção                                                                     |
| ---------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| **API do `@opentelemetry/resources`**          | `resourceFromAttributes` não existe | Alternativa documentada no cabeçalho de `tracing.ts`                         |
| **Versões experimentais do OTel desalinhadas** | Erro de tipo entre pacotes `0.x`    | Alinhar todos na mesma linha; o Dependabot já os agrupa                      |
| **Migrations ausentes**                        | `*-migrate` falha                   | `npx prisma migrate dev --name init` nos 3 serviços                          |
| **`package-lock.json` ausente**                | `npm ci` falha nos Dockerfiles      | `npm install` primeiro                                                       |
| **Tipo de conexão do amqplib**                 | Erro de tipo em `connection.ts`     | Já mitigado: o tipo é derivado de `Awaited<ReturnType<typeof amqp.connect>>` |
| **NetworkPolicy ignorada**                     | Tudo se comunica apesar da política | CNI sem suporte; verificação em `kubernetes/README.md`                       |

## 5. Conclusão da revisão

O projeto está **coerente por inspeção**: nomes, caminhos, portas, contratos e
referências cruzadas foram verificados e as inconsistências encontradas foram
corrigidas, não maquiadas.

O que **não** pode ser afirmado: que compila, que os testes passam, que a stack
sobe ou que os manifests são aceitos por um cluster. Isso depende de execução, e
nenhuma execução ocorreu.

Nenhum item do `PROJECT_MANIFEST.md` deve ser promovido a `VALIDADO` sem que o
comando correspondente tenha sido rodado e o resultado registrado.
