# Modelo de ameaças — Pedidos Veloz

Escopo: a plataforma como entregue neste repositório, incluindo ambiente local
(Docker Compose) e Kubernetes. Não cobre a infraestrutura da AWS além do que os
módulos Terraform provisionam.

Metodologia: identificação de ativos, atores, superfícies e ameaças, com os
controles implementados e o **risco residual declarado**. Onde o risco não foi
mitigado, isso está dito com todas as letras — modelo de ameaças que só lista
controles é propaganda, não análise.

---

## 1. Ativos

| #   | Ativo                                        | Por que importa                              | Impacto se comprometido                                   |
| --- | -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| A1  | Dados de pedido (`customerId`, itens, valor) | Dado pessoal indireto e informação comercial | Alto — exposição de comportamento de compra               |
| A2  | Saldo de estoque                             | Base da decisão de venda                     | Alto — venda a descoberto ou negação indevida             |
| A3  | Registros de pagamento                       | Valor, status, referência externa            | Alto — embora **não haja dado de cartão**                 |
| A4  | Credenciais de banco e broker                | Acesso total aos dados                       | **Crítico**                                               |
| A5  | Chave de administração do estoque            | Permite alterar saldo                        | Médio — desligada em produção                             |
| A6  | Imagens de contêiner no GHCR                 | Cadeia de suprimento                         | **Crítico** — imagem adulterada executa código arbitrário |
| A7  | Estado do Terraform                          | Contém a senha do RDS em texto claro         | **Crítico**                                               |
| A8  | Disponibilidade da plataforma                | Receita durante a campanha                   | Alto                                                      |
| A9  | Telemetria (logs, traces, métricas)          | Pode conter dado sensível se mal filtrada    | Médio                                                     |

**Observação relevante:** o sistema **não armazena número de cartão, CVV nem
titular** em lugar nenhum. O simulador de pagamento não recebe esses dados. Isso
mantém o projeto fora do escopo do PCI DSS — e é uma decisão de desenho, não
sorte.

## 2. Atores

| Ator                                       | Motivação                                               | Capacidade                          |
| ------------------------------------------ | ------------------------------------------------------- | ----------------------------------- |
| T1 — Atacante externo anônimo              | Fraude, indisponibilidade, exfiltração                  | Só alcança o Ingress e o Gateway    |
| T2 — Cliente legítimo mal-intencionado     | Comprar abaixo do preço, esgotar estoque de concorrente | Requisições válidas em volume       |
| T3 — Insider com acesso ao cluster         | Exfiltração, sabotagem                                  | Alta, se o RBAC for permissivo      |
| T4 — Atacante na cadeia de suprimento      | Código malicioso via dependência ou action              | Alta e difícil de detectar          |
| T5 — Desenvolvedor descuidado              | Nenhuma; erro honesto                                   | Commitar segredo, afrouxar política |
| T6 — Atacante com acesso à rede do cluster | Interceptação de tráfego interno                        | Média                               |

## 3. Superfícies de ataque

| #   | Superfície                        | Exposição                                         |
| --- | --------------------------------- | ------------------------------------------------- |
| S1  | Ingress e API Gateway             | **Pública**                                       |
| S2  | Serviços de backend (3001–3003)   | Interna; NetworkPolicy só permite o Gateway       |
| S3  | PostgreSQL (5432)                 | Interna; sub-rede privada em nuvem                |
| S4  | RabbitMQ (5672 e 15672)           | Interna; só a UI é publicada localmente           |
| S5  | Interfaces de observabilidade     | Locais; **não expostas** em nuvem                 |
| S6  | Pipeline de CI/CD                 | GitHub; controlado por permissão de repositório   |
| S7  | Registro GHCR                     | Público ou privado, conforme o repositório        |
| S8  | API do Kubernetes                 | Pública em staging; restrita por CIDR em produção |
| S9  | Socket do Docker montado no Alloy | **Local apenas**                                  |

---

## 4. Ameaças, controles e risco residual

### AM-01 · Injeção via payload de pedido

**Superfície:** S1 · **Ator:** T1, T2

**Controles:** validação Zod estrita em toda entrada (tipo, tamanho, formato,
SKU por expressão regular, sem SKU repetido); Prisma usa consultas
parametrizadas; nas duas consultas com SQL bruto, os valores vão por template
tag do Prisma, que também parametriza; limite de corpo de 100 kB; limite de 50
itens por pedido.

**Residual:** Baixo.

---

### AM-02 · Negação de serviço por volume

**Superfície:** S1 · **Ator:** T1, T2

**Controles:** rate limit no Gateway (120 req/min por IP, 300 em produção);
`limit-rps: 50` no Ingress como segunda camada; limite de corpo; HPA absorve
picos legítimos; `ResourceQuota` impede escalada descontrolada.

**Residual:** **Médio.** Não há WAF nem proteção contra DDoS volumétrico. Um
ataque distribuído de volume derruba o Ingress antes de o rate limit importar.
Mitigação indicada: AWS WAF e Shield.

---

### AM-03 · Esgotamento de estoque por reservas maliciosas

**Superfície:** S1 · **Ator:** T2

**Controles:** rate limit; reserva liberada automaticamente na falha de
pagamento.

**Residual:** **Alto e assumido.** Não há autenticação. Um atacante pode criar
pedidos ilimitados com `customerId` arbitrário e manter estoque reservado
indefinidamente, porque **não existe expiração de reserva**. Um pedido que
nunca chega ao pagamento mantém o saldo preso para sempre.

Mitigações necessárias: autenticação (OAuth 2.0/OIDC), limite por cliente e
**timeout de reserva** — um processo que libera reservas em `RESERVED` há mais
de N minutos. Registrado em `docs/limitations-and-roadmap.md`.

---

### AM-04 · Acesso não autorizado às APIs

**Superfície:** S1 · **Ator:** T1

**Controles:** apenas o endpoint de reposição de estoque é protegido, por chave
estática, e vem desligado por padrão.

**Residual:** **Crítico e assumido.** **Não há autenticação nem autorização nas
APIs de pedido.** Qualquer um pode criar pedido, consultar qualquer pedido pelo
id e consultar qualquer pagamento. Um `orderId` é UUID v4, o que dificulta
adivinhação, mas **segurança por obscuridade não é controle**.

Isso é uma limitação declarada do MVP, não um descuido. A correção é OAuth 2.0
com OIDC, e escopo por cliente nas consultas.

---

### AM-05 · Movimentação lateral entre serviços

**Superfície:** S2 · **Ator:** T1 após comprometer um serviço

**Controles:** NetworkPolicy com negação por padrão; nenhuma regra permite HTTP
entre backends; credenciais de banco distintas por serviço, com permissão
apenas no próprio banco; ServiceAccount por serviço com
`automountServiceAccountToken: false`; contêineres não-root, sem
`privilegeEscalation`, com sistema de arquivos raiz somente leitura e todas as
capabilities removidas.

**Residual:** **Médio, com ressalva importante.** NetworkPolicy **só funciona
se o CNI a implementar**. Em kind e Docker Desktop com CNI padrão, as políticas
são aceitas pela API e **silenciosamente ignoradas** — o que dá falsa sensação
de proteção. Verificação documentada em `kubernetes/README.md`.

---

### AM-06 · Interceptação de tráfego interno

**Superfície:** S2, S3, S4 · **Ator:** T6

**Controles:** TLS no Ingress para tráfego externo; NetworkPolicy limita quem
alcança; em nuvem, sub-redes privadas.

**Residual:** **Médio e assumido.** **O tráfego interno é texto claro.** Não há
mTLS (ver ADR-008), e as conexões com PostgreSQL e RabbitMQ não forçam TLS. A
NetworkPolicy limita **quem alcança**, não **o que se lê**.

Mitigações: service mesh com mTLS, `sslmode=require` na URL do banco, AMQPS.

---

### AM-07 · Vazamento de credenciais

**Superfície:** S6, S7 · **Ator:** T5

**Controles:** `.gitignore` cobre `.env`, `secret.yaml`, `terraform.tfvars`,
`backend.tf` e `*.tfstate`; apenas `secret.example.yaml` com placeholders é
versionado; **o CI verifica** que nenhum `secret.yaml` foi commitado; logger com
redaction automática de `authorization`, `cookie`, `x-admin-key`, `password`,
`token`, `DATABASE_URL` e `RABBITMQ_URL`; `redactConfig` mascara conexões antes
de qualquer log; erro de configuração lista o **campo**, nunca o **valor**.

**Residual:** Baixo para segredo novo. **Médio** para histórico: nada varre
commits anteriores. Um segredo já commitado permanece no histórico do Git para
sempre. Mitigação: `gitleaks` ou `trufflehog` no pipeline, e rotação do segredo
exposto.

---

### AM-08 · Base64 confundido com criptografia

**Superfície:** S8 · **Ator:** T3

**Fato:** o campo `data` de um Secret do Kubernetes é **apenas Base64**, que é
codificação reversível com um comando de uma linha. Por padrão, Secrets ficam
em **texto claro no etcd**.

**Controles:** o `secret.example.yaml` usa `stringData` justamente para deixar
explícito que não há proteção; o aviso está no cabeçalho do arquivo e neste
documento; a criação recomendada é por `kubectl create secret`, sem o valor
tocar o disco.

**Residual:** **Médio.** As proteções reais dependem do cluster: RBAC
restringindo leitura de Secrets e criptografia em repouso do etcd
(`EncryptionConfiguration`) — **nenhuma das duas é configurada por este
projeto**. Mitigação: External Secrets Operator com AWS Secrets Manager.

---

### AM-09 · Comprometimento da cadeia de suprimento

**Superfície:** S6, S7 · **Ator:** T4

**Controles:** `package-lock.json` fixa versões exatas; `npm ci` falha se o
lockfile divergir do `package.json`; Trivy escaneia **antes** do push;
Dependabot semanal; imagem base oficial `node:22-bookworm-slim`; multi-stage
build reduz a superfície; actions fixadas por versão maior.

**Residual:** **Médio.** Não há SBOM, não há assinatura de imagem (Cosign), não
há verificação de proveniência, e o Trivy **publica sem bloquear** (decisão
justificada em ADR-009). Actions fixadas por `@v4` e não por SHA — uma tag pode
ser movida.

---

### AM-10 · Escalada de privilégio dentro do contêiner

**Superfície:** S2 · **Ator:** T1 após execução remota

**Controles:** `runAsNonRoot: true` com uid 1000; `allowPrivilegeEscalation:
false`; `readOnlyRootFilesystem: true`; `capabilities.drop: [ALL]`;
`seccompProfile: RuntimeDefault`; Pod Security Standard `restricted` por label
de namespace; token da ServiceAccount não montado.

**Residual:** Baixo. **Exceção declarada:** PostgreSQL e RabbitMQ do overlay de
desenvolvimento rodam com `readOnlyRootFilesystem: false`, porque os
entrypoints escrevem fora do diretório de dados. Está marcado no arquivo.
Nenhum controle foi desligado em serviço da aplicação.

---

### AM-11 · Acesso privilegiado pelo socket do Docker

**Superfície:** S9 · **Ator:** T3, T1

**Fato:** acesso ao socket do Docker equivale a acesso **root ao host**. O
Alloy o monta para descobrir contêineres.

**Controles:** montado somente leitura; **apenas no ambiente local**; no
Kubernetes a coleta usa a API com ServiceAccount e RBAC próprios.

**Residual:** Baixo, e restrito ao ambiente de desenvolvimento. Aceitável ali,
inaceitável em produção — e é por isso que a configuração de nuvem é outra.

---

### AM-12 · Dado sensível em telemetria

**Superfície:** S5 · **Ator:** T3

**Controles:** redaction no logger; nenhum payload anexado a span; regra de
cardinalidade impede `customerId` e `orderId` como label do Prometheus; erro
inesperado devolve mensagem genérica ao cliente, sem stack trace.

**Residual:** **Médio.** As interfaces de observabilidade não têm autenticação
forte: Grafana com `admin/admin`, Prometheus e Jaeger **sem autenticação
alguma**. São locais e não expostas em nuvem — mas quem alcançar a rede lê
tudo. Em produção: OIDC no Grafana e nenhuma dessas interfaces publicada.

---

### AM-13 · Manipulação de saldo pelo endpoint de reposição

**Superfície:** S2 · **Ator:** T1, T3

**Controles:** desligado por padrão (`INVENTORY_RESTOCK_ENABLED=false`);
`refine` no schema **impede subir** com o recurso ligado e sem chave; aviso no
log de inicialização; **não exposto pelo Gateway**; responde 404 quando
desligado, sem revelar que existe.

**Residual:** Baixo em produção. A chave estática é reconhecidamente um modelo
fraco — sem rotação, sem identidade, viaja em todo request — e por isso o
recurso é acadêmico e declarado como tal no próprio controller.

---

### AM-14 · Repúdio e ausência de trilha de auditoria

**Superfície:** todas · **Ator:** T3

**Controles:** logs estruturados com `correlationId`, `traceId` e `spanId`;
tabela `processed_events`; eventos `order.confirmed`, `order.failed` e
`stock.released` para auditoria; logs de auditoria do control plane EKS
habilitados.

**Residual:** **Alto.** Sem autenticação, **não há a quem atribuir uma ação**.
`customerId` é informado pelo próprio cliente e não é verificado. Não existe
trilha de auditoria confiável. Depende inteiramente de AM-04.

---

### AM-15 · Perda de dados

**Superfície:** S3, S4 · **Ator:** falha, não ataque

**Controles:** RDS com backup automático (3 dias em staging, 30 em produção),
Multi-AZ em produção, `deletion_protection`, snapshot final; mensagens e filas
duráveis; publisher confirms; DLQ preserva o que falhou.

**Residual:** **Alto no ambiente local e no overlay de desenvolvimento**, onde
PostgreSQL e RabbitMQ usam `emptyDir` — reinício do pod apaga tudo. Está
marcado no arquivo. Em produção com RDS, o risco é baixo; o **RabbitMQ, porém,
não é provisionado por Terraform** e permanece sem HA.

---

## 5. Resumo do risco residual

| Nível       | Ameaças                                         | Observação                      |
| ----------- | ----------------------------------------------- | ------------------------------- |
| **Crítico** | AM-04 (sem autenticação)                        | Bloqueador para uso real        |
| **Alto**    | AM-03, AM-14, AM-15 (local)                     | AM-03 e AM-14 dependem de AM-04 |
| **Médio**   | AM-02, AM-05, AM-06, AM-07, AM-08, AM-09, AM-12 |                                 |
| **Baixo**   | AM-01, AM-10, AM-11, AM-13                      |                                 |

## 6. Ordem de correção recomendada

1. **Autenticação e autorização** (AM-04) — destrava AM-03 e AM-14 juntos
2. **Timeout de reserva de estoque** (AM-03) — falha de disponibilidade real
3. **External Secrets Operator** (AM-08) — remove segredo do alcance do RBAC
4. **TLS nas conexões internas** (AM-06) — `sslmode=require` e AMQPS são
   baratos; mTLS completo exige mesh
5. **Varredura de segredo no histórico** (AM-07) — gitleaks no pipeline
6. **SBOM e assinatura de imagem** (AM-09) — Syft e Cosign
7. **WAF** (AM-02) — quando houver exposição pública real

## 7. O que este modelo não cobre

- Segurança física dos data centers (responsabilidade da AWS)
- Engenharia social
- Segurança do endpoint dos desenvolvedores
- Conformidade com LGPD: o sistema armazena `customerId` fornecido pelo
  cliente, que **pode** ser dado pessoal. Não há política de retenção,
  anonimização, nem mecanismo de exclusão a pedido do titular. **Uma análise de
  conformidade é necessária antes de qualquer uso real** e está fora do escopo
  deste MVP acadêmico.
