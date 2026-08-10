# Kubernetes

## Organização

```
base/                 manifests autorais da aplicação (Kustomize)
overlays/
  development/        1 réplica, dependências dentro do cluster, recursos acadêmicos LIGADOS
  staging/            2 réplicas, imagens por SHA, simulação de recusa ligada
  production/         3 réplicas, tag semântica, recursos acadêmicos DESLIGADOS
helm-values/          valores versionados dos charts de terceiros
```

**Divisão de responsabilidade:** o que é nosso vive em Kustomize; o que é de
terceiros (Prometheus, Loki, Jaeger, Alloy, Ingress Controller, Metrics Server)
é instalado por Helm com valores versionados em `helm-values/`. Copiar
manifests gerados por charts oficiais para dentro do repositório, fingindo
instalação manual, tornaria a atualização impossível.

## Pré-requisitos

| Componente               | Necessário para  | Sem ele                                           |
| ------------------------ | ---------------- | ------------------------------------------------- |
| Metrics Server           | HPA              | HPA fica em `<unknown>` e nunca escala            |
| NGINX Ingress Controller | Ingress          | Ingress criado sem `ADDRESS`, inacessível         |
| CNI com NetworkPolicy    | NetworkPolicies  | Políticas aceitas e **silenciosamente ignoradas** |
| Secret `app-secrets`     | staging/produção | Pods em `CreateContainerConfigError`              |
| Acesso ao GHCR           | staging/produção | `ImagePullBackOff`                                |

Verificar se o CNI aplica NetworkPolicy — o CNI padrão do kind e do Docker
Desktop **não aplica**:

```bash
kubectl get pods -n kube-system | grep -Ei 'calico|cilium|weave'
```

Se não retornar nada, as NetworkPolicies deste projeto são decorativas naquele
cluster. Para kind, criar o cluster com `disableDefaultCNI: true` e instalar
Calico.

## Instalação dos componentes de terceiros

```bash
# Metrics Server (necessário para o HPA)
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system --version 3.12.2
# Em kind/local, os kubelets usam certificado autoassinado. Só então:
#   --set args={--kubelet-insecure-tls}

# NGINX Ingress Controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace --version 4.11.3

# Observabilidade
helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  -n observability --create-namespace --version 65.5.1 \
  -f kubernetes/helm-values/kube-prometheus-stack.values.yaml

helm upgrade --install loki grafana/loki \
  -n observability --version 6.24.0 \
  -f kubernetes/helm-values/loki.values.yaml

helm upgrade --install alloy grafana/alloy \
  -n observability --version 0.10.1 \
  -f kubernetes/helm-values/alloy.values.yaml

helm upgrade --install jaeger jaegertracing/jaeger \
  -n observability --version 3.3.1 \
  -f kubernetes/helm-values/jaeger.values.yaml
```

As NetworkPolicies casam os namespaces `ingress-nginx` e `observability` pelo
label `kubernetes.io/metadata.name`, que o Kubernetes aplica automaticamente.
Se você usar outros nomes de namespace, ajuste `base/networkpolicies.yaml`.

## Validação sem cluster

Estes dois comandos **não exigem cluster** e devem ser rodados antes de
qualquer apply. Estão no `ci.yml`:

```bash
kubectl kustomize kubernetes/overlays/development
kubectl kustomize kubernetes/overlays/staging
kubectl kustomize kubernetes/overlays/production
```

Com cluster, validação sem aplicar nada:

```bash
kubectl apply --dry-run=client -k kubernetes/overlays/development
kubectl apply --dry-run=server -k kubernetes/overlays/staging
```

`--dry-run=client` só valida a estrutura localmente. `--dry-run=server` envia
ao servidor e valida contra os CRDs e webhooks reais — mais rigoroso, mas
exige cluster e permissão.

## Deploy

### Desenvolvimento (cluster local)

```bash
# 1. Construir as imagens localmente
docker compose build

# 2. Em kind, carregar as imagens no cluster (não há registry)
kind load docker-image loja-veloz/loja-veloz-api-gateway:local
kind load docker-image loja-veloz/loja-veloz-order-service:local
kind load docker-image loja-veloz/loja-veloz-inventory-service:local
kind load docker-image loja-veloz/loja-veloz-payment-service:local

# 3. Aplicar
kubectl apply -k kubernetes/overlays/development

# 4. Aplicar as migrations (uma vez, após o Postgres ficar pronto)
kubectl wait --for=condition=available deploy/postgres -n loja-veloz --timeout=180s
kubectl run order-migrate --rm -i --restart=Never -n loja-veloz \
  --image=loja-veloz/loja-veloz-order-service:local \
  --env="DATABASE_URL=postgresql://orders_user:orders_dev_only@postgres:5432/orders_db" \
  -- npx prisma migrate deploy

# 5. Acompanhar
kubectl get pods -n loja-veloz -w
```

O overlay de desenvolvimento sobe PostgreSQL e RabbitMQ **dentro do cluster**,
com `emptyDir`. Os dados somem a cada reinício. Isso está marcado em
`dependencies-academic.yaml` e não deve ser usado fora de desenvolvimento.

### Staging e produção

O Secret **nunca** vem do Git:

```bash
kubectl create namespace loja-veloz
kubectl create secret generic app-secrets -n loja-veloz \
  --from-literal=ORDERS_DATABASE_URL='postgresql://...' \
  --from-literal=INVENTORY_DATABASE_URL='postgresql://...' \
  --from-literal=PAYMENTS_DATABASE_URL='postgresql://...' \
  --from-literal=RABBITMQ_URL='amqp://...'
```

Depois, o pipeline (`deploy-staging.yml`) faz `kustomize edit set image` com o
SHA do commit e aplica.

## Estratégia de deploy: Rolling Update

**Por que Rolling Update e não Blue/Green ou Canary:** com `maxSurge: 1` e
`maxUnavailable: 0`, o Kubernetes sobe um pod novo, espera ele passar no
readiness, e só então derruba um antigo. A capacidade nunca cai abaixo do
declarado, o deploy é sem indisponibilidade, e não exige nenhuma ferramenta
além do próprio Kubernetes. Para quatro semanas de projeto, é a escolha com
melhor relação entre risco reduzido e complexidade adicionada.

**Como as probes evitam tráfego prematuro:** um pod só entra nos endpoints do
Service depois que o `readinessProbe` retorna 200, o que significa que banco e
broker responderam. Antes disso ele não recebe requisição alguma. A
`startupProbe` suspende liveness e readiness durante a partida, dando até 90s
para carregar o Prisma Client e conectar às dependências, sem risco de o
kubelet matar o processo por achar que travou.

**O `preStop: sleep 5`** existe porque a remoção do pod dos endpoints e o envio
do SIGTERM acontecem **em paralelo**. Sem a pausa, o proxy ainda pode
encaminhar requisições para um pod que já começou a encerrar — sintoma: 502
esporádico durante o deploy.

### Rollback

```bash
kubectl rollout status deployment/order-service -n loja-veloz --timeout=300s
kubectl rollout history deployment/order-service -n loja-veloz
kubectl rollout undo deployment/order-service -n loja-veloz
kubectl rollout undo deployment/order-service -n loja-veloz --to-revision=3
```

**Limitação do rollback:** ele reverte o Deployment, não o banco. Se o release
incluiu uma migration destrutiva, voltar a imagem anterior não desfaz a
mudança de schema — e a versão antiga pode nem funcionar contra o schema novo.
Por isso migrations devem ser sempre compatíveis com a versão anterior
(_expand and contract_): primeiro adiciona coluna, depois o código passa a
usá-la, e só num release seguinte a coluna antiga é removida.

### Canary — o que seria necessário

Um Service comum do Kubernetes **não faz divisão percentual de tráfego**. Ele
distribui entre todos os pods que casam com o selector, e a proporção é
simplesmente o número de pods de cada versão. Dois Deployments atrás do mesmo
Service não são canary: são um Rolling Update disfarçado, sem controle de
proporção, sem análise de métrica e sem promoção automática.

Canary ponderado de verdade exige uma destas:

- **Argo Rollouts** — recurso `Rollout` com passos e análise automática
- **Flagger** — promoção baseada em métricas do Prometheus
- **Istio / Linkerd** — `VirtualService` com pesos por subset
- **NGINX Ingress** — annotations `canary-weight`, com dois Ingress separados

Está registrado como evolução futura em `docs/limitations-and-roadmap.md`.

## Escalabilidade

HPA v2 por CPU, com `minReplicas`/`maxReplicas` distintos por serviço.

**O alvo é calculado sobre `requests.cpu`**, não sobre o limite nem sobre a
capacidade do nó. Um Deployment sem `requests.cpu` torna o HPA inoperante —
por isso o `LimitRange` define um default.

**HPA e VPA não devem atuar sobre o mesmo recurso no mesmo Deployment.** O VPA
altera `requests`; o HPA calcula percentuais sobre esse valor. Com os dois
mexendo em CPU ao mesmo tempo, o resultado é oscilação. Este projeto usa
apenas HPA.

**O teto real de escala não é CPU, é o banco.** Cada réplica do order-service
abre até 10 conexões (`connection_limit=10`). Doze réplicas são 120 conexões só
desse serviço. O `max_connections` do PostgreSQL é o limite efetivo, e por isso
os `maxReplicas` dos serviços com banco são menores que o do Gateway.

**CPU é uma métrica ruim para consumidores de fila.** Um acúmulo de mensagens
não necessariamente aparece como CPU alta, então o sistema escala tarde. O
KEDA resolve isso escalando pela profundidade da fila no RabbitMQ — é a
evolução indicada.

**Idempotência é pré-requisito da escala.** Com N réplicas consumindo a mesma
fila, a mesma mensagem pode ser processada por réplicas diferentes após uma
reentrega. É a tabela `processed_events` que torna isso seguro.

```bash
kubectl get hpa -n loja-veloz -w
kubectl describe hpa order-service -n loja-veloz
kubectl top pods -n loja-veloz
```

## Segurança dos pods

Todos os Deployments da aplicação atendem ao Pod Security Standard
`restricted`, aplicado por label no namespace:

```yaml
runAsNonRoot: true
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
seccompProfile:
  type: RuntimeDefault
```

`readOnlyRootFilesystem: true` exige um `emptyDir` montado em `/tmp`, que é o
único caminho onde a aplicação escreve.

**Exceção consciente:** o PostgreSQL e o RabbitMQ do overlay de
desenvolvimento rodam com `readOnlyRootFilesystem: false`, porque os
entrypoints dessas imagens escrevem fora do diretório de dados. Está
documentado no próprio arquivo. Nenhum controle foi desligado em serviço da
aplicação para "fazer o contêiner subir".

## Diagnóstico rápido

```bash
kubectl get pods -n loja-veloz
kubectl describe pod <pod> -n loja-veloz          # eventos, probes, motivo do restart
kubectl logs <pod> -n loja-veloz --previous       # log do contêiner que morreu
kubectl get events -n loja-veloz --sort-by=.lastTimestamp
kubectl get networkpolicy -n loja-veloz
```

Sintomas e causas prováveis estão em `docs/troubleshooting.md`.
