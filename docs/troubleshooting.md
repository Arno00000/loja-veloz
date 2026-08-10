# Guia de troubleshooting

Cada problema traz **sintoma**, **causa provável**, **diagnóstico**,
**correção** e **prevenção**.

---

## Ambiente local

### 1. Docker indisponível

**Sintoma:** `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`

**Causa:** daemon parado; no Windows/macOS, Docker Desktop fechado; no Linux, o
usuário fora do grupo `docker`.

**Diagnóstico:** `docker info`

**Correção:** iniciar o Docker Desktop; no Linux,
`sudo systemctl start docker` e `sudo usermod -aG docker $USER` (exige novo
login).

**Prevenção:** `docker info` antes de qualquer sessão de trabalho.

---

### 2. Porta ocupada

**Sintoma:** `bind: address already in use` ao subir o Compose.

**Causa:** outro processo usa 8080, 3000, 9090, 15672 ou 16686.

**Diagnóstico:**

```bash
ss -tlnp | grep 8080          # Linux
netstat -ano | findstr :8080  # Windows
```

**Correção:** encerrar o processo, ou alterar a porta no `.env`
(`API_GATEWAY_PORT=8081`). As portas do host são parametrizadas justamente para
isso.

**Prevenção:** `docker compose down` ao terminar.

---

### 3. Container unhealthy

**Sintoma:** `docker compose ps` mostra `unhealthy`; serviços dependentes não
sobem.

**Causa:** o healthcheck falha — aplicação não subiu, ou dependência ausente.

**Diagnóstico:**

```bash
docker compose ps
docker inspect --format='{{json .State.Health}}' loja-veloz-order-service | jq
docker compose logs order-service --tail=100
```

**Correção:** depende do log. Erro de configuração aparece como
`ConfigurationError` com a lista de campos inválidos.

**Prevenção:** `start_period` generoso nos healthchecks; `startupProbe` no
Kubernetes.

---

### 4. Falha no PostgreSQL

**Sintoma:** `Can't reach database server`, ou o pod não fica `healthy`.

**Causa:** ainda inicializando; volume corrompido; credencial errada.

**Diagnóstico:**

```bash
docker compose logs postgres --tail=50
docker compose exec postgres pg_isready -U postgres
docker compose exec postgres psql -U postgres -c "\l"
```

**Correção:** se os três bancos não existirem, o script de init não rodou —
ele **só executa com o volume vazio**. `docker compose down -v` e subir de novo
(apaga os dados).

**Prevenção:** entender que `docker-entrypoint-initdb.d` é executado apenas na
primeira subida.

---

### 5. Migration falhando

**Sintoma:** o serviço `*-migrate` termina com código diferente de zero.

**Causa provável:** nenhuma migration foi gerada ainda. `prisma migrate deploy`
**não cria** migration, só aplica as existentes.

**Diagnóstico:**

```bash
ls apps/order-service/prisma/migrations
docker compose logs order-migrate
```

**Correção:**

```bash
cd apps/order-service && npx prisma migrate dev --name init
```

Repetir nos três serviços e **versionar** os arquivos gerados.

Se a causa for permissão, verifique se o usuário é dono do schema `public` — é
o que o script de init configura.

**Prevenção:** gerar as migrations iniciais logo após o primeiro
`npm install`.

---

### 6. Prisma Client ausente

**Sintoma:** `Cannot find module '../../generated/prisma'` ou
`@prisma/client did not initialize yet`.

**Causa:** `prisma generate` não foi executado. O client é **gerado**, e o
diretório está no `.gitignore` de propósito.

**Diagnóstico:** `ls apps/order-service/generated/prisma`

**Correção:** `npm run prisma:generate`

**Prevenção:** o passo está no `ci.yml` antes do typecheck, e nos Dockerfiles
antes do build.

---

### 7. RabbitMQ indisponível

**Sintoma:** log com `Falha ao conectar no RabbitMQ`, readiness em 503.

**Causa:** broker ainda subindo (leva ~40 s), ou fora do ar.

**Diagnóstico:**

```bash
docker compose logs rabbitmq --tail=50
docker compose exec rabbitmq rabbitmq-diagnostics -q check_running
```

**Correção:** normalmente nenhuma — **o cliente reconecta sozinho** com backoff
exponencial. O readiness segura o tráfego enquanto isso.

**Prevenção:** é por isso que existe reconexão automática. `depends_on` sozinho
não resolveria: a queda pode acontecer a qualquer momento, não só na partida.

---

### 8. Credencial incorreta

**Sintoma:** `ACCESS_REFUSED` (RabbitMQ) ou `password authentication failed`
(PostgreSQL).

**Causa:** `.env` divergente do que foi usado na criação do volume. Trocar a
senha no `.env` **não** altera a senha já gravada no banco.

**Diagnóstico:** comparar a URL do serviço com as credenciais do `.env`.

**Correção:** `docker compose down -v` e subir de novo, para recriar com as
credenciais atuais.

**Prevenção:** não alterar credenciais sem recriar o volume.

---

## Mensageria

### 9. Mensagem na DLQ

**Sintoma:** alerta `MensagensNaDLQ`; fila `*.dlq` com mensagens.

**Diagnóstico:** ler o header `x-failure-reason`. Procedimento completo no
runbook, seção 4.

**Correção:** depende do motivo. `invalid_json`, `unknown_event_type` e
`contract_violation` **nunca** devem ser reprocessados. `retries_exhausted`
pode ser reprocessado **depois** de corrigida a causa.

**Prevenção:** validação Zod nas duas pontas; contrato compartilhado em tempo
de compilação.

---

### 10. Retry contínuo

**Sintoma:** `messaging_retries_total` subindo sem parar; a mesma mensagem
falhando repetidamente.

**Causa:** dependência instável, ou erro que não é transitório sendo tratado
como se fosse.

**Diagnóstico:**

```promql
sum by (queue, event_type) (rate(messaging_retries_total[5m]))
```

Nos logs, procurar `Evento reenviado para a fila de retry`.

**Correção:** corrigir a dependência. Se o erro nunca vai passar, o handler
deve lançar `NonRetryableError`, que envia direto para a DLQ.

**Prevenção:** `RABBITMQ_MAX_RETRIES` tem teto de 20 no schema — **retry
infinito é impossível por construção**, e há teste que comprova
(`retry-policy.test.ts`).

---

### 11. Falha de DNS entre serviços

**Sintoma:** `getaddrinfo ENOTFOUND order-service`.

**Causa:** nome de serviço errado, ou serviços em redes diferentes.

**Diagnóstico:**

```bash
docker compose exec api-gateway node -e "fetch('http://order-service:3001/health/live').then(r=>console.log(r.status))"
kubectl exec -n loja-veloz deploy/api-gateway -- nslookup order-service
```

**Correção:** conferir o nome no `docker-compose.yml` ou no Service do
Kubernetes. No Kubernetes, verificar a NetworkPolicy de DNS — sem UDP/53
liberado para o `kube-system`, nada resolve.

**Prevenção:** as URLs vêm de configuração validada por schema.

---

### 12. Timeout entre serviços

**Sintoma:** HTTP 504 com `UPSTREAM_TIMEOUT`.

**Causa:** serviço interno lento ou travado.

**Diagnóstico:** procurar o trace no Jaeger — ele mostra exatamente onde o
tempo foi gasto.

**Correção:** se for lentidão real, escalar. Se for consulta pesada, otimizar.
Aumentar `UPSTREAM_TIMEOUT_MS` esconde o problema em vez de resolvê-lo.

**Prevenção:** timeout explícito por requisição já implementado; alerta
`LatenciaP95Alta`.

---

## Kubernetes

### 13. Imagem não encontrada

**Sintoma:** `ErrImagePull` ou `manifest unknown`.

**Causa:** tag inexistente, ou imagem local não carregada no cluster.

**Diagnóstico:** `kubectl describe pod <pod> -n loja-veloz`

**Correção em kind:**

```bash
kind load docker-image loja-veloz/loja-veloz-order-service:local
```

**Prevenção:** `imagePullPolicy: IfNotPresent` no overlay de desenvolvimento.

---

### 14. Erro de autenticação no GHCR

**Sintoma:** `unauthorized: authentication required`.

**Causa:** pacote privado sem `imagePullSecret`, ou nome com maiúsculas — o
GHCR exige o caminho todo em minúsculas.

**Diagnóstico:** `docker pull ghcr.io/<usuario>/loja-veloz-order-service:sha-...`

**Correção:**

```bash
kubectl create secret docker-registry ghcr-secret -n loja-veloz \
  --docker-server=ghcr.io --docker-username=<usuario> --docker-password=<token>
```

E referenciar em `imagePullSecrets` no Deployment. Ou tornar o pacote público.

**Prevenção:** o `images.yml` já converte o nome para minúsculas.

---

### 15. ImagePullBackOff

**Sintoma:** pod nesse estado por vários minutos.

**Causa:** consequência de 13 ou 14, com backoff crescente do kubelet.

**Diagnóstico:** os eventos no `describe pod` dizem qual dos dois é.

**Correção:** corrigir a origem e apagar o pod para forçar nova tentativa
imediata.

---

### 16. CrashLoopBackOff

**Sintoma:** pod reiniciando em ciclo.

**Causa mais comum neste projeto:** configuração inválida. A aplicação falha
rápido e de propósito quando falta variável obrigatória.

**Diagnóstico:**

```bash
kubectl logs <pod> -n loja-veloz --previous
```

O `--previous` é essencial: mostra o log do contêiner **que morreu**.

**Correção:** o erro `ConfigurationError` lista os campos inválidos — sem
mostrar valores, para não vazar credencial. Corrigir ConfigMap ou Secret.

**Prevenção:** falhar na inicialização é intencional; um processo com
configuração inválida nunca deve receber tráfego.

---

### 17. Readiness falhando

**Sintoma:** pod `Running` mas `0/1 READY`; não recebe tráfego.

**Causa:** banco ou broker inacessível.

**Diagnóstico:**

```bash
kubectl exec <pod> -n loja-veloz -- node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>r.text()).then(console.log)"
```

A resposta traz `dependencies` com o estado de cada uma.

**Correção:** corrigir a dependência. O pod **não** será reiniciado — é o
comportamento desejado.

**Prevenção:** liveness não consulta dependência, justamente para não
transformar indisponibilidade de banco em reinício de todos os pods.

---

### 18. Startup probe falhando

**Sintoma:** pod reiniciado antes de terminar de subir.

**Causa:** `failureThreshold × periodSeconds` insuficiente para carregar o
Prisma Client e conectar às dependências.

**Diagnóstico:** `Startup probe failed` nos eventos do `describe pod`.

**Correção:** aumentar `failureThreshold` (hoje 18 × 5 s = 90 s nos serviços
com banco).

**Prevenção:** enquanto a startup probe não passa, liveness e readiness ficam
suspensas.

---

### 19. HPA sem métricas

**Sintoma:** `kubectl get hpa` mostra `<unknown>/70%`.

**Causa:** Metrics Server ausente, ou Deployment sem `requests.cpu`.

**Diagnóstico:**

```bash
kubectl top pods -n loja-veloz
kubectl get deploy metrics-server -n kube-system
```

**Correção:** instalar o Metrics Server. Em kind, com
`--set args={--kubelet-insecure-tls}`, porque os kubelets usam certificado
autoassinado.

**Prevenção:** o `LimitRange` garante `requests.cpu` mesmo se alguém esquecer.

---

### 20. Ingress inacessível

**Sintoma:** `kubectl get ingress` com `ADDRESS` vazio.

**Causa:** Ingress Controller não instalado, ou `ingressClassName` divergente.

**Diagnóstico:**

```bash
kubectl get pods -n ingress-nginx
kubectl get ingressclass
```

**Correção:** instalar o controller; conferir se a classe se chama `nginx`.
Localmente, `/etc/hosts` precisa apontar `loja-veloz.local`.

**Alternativa para teste:** `kubectl port-forward -n loja-veloz svc/api-gateway
8080:8080`.

---

### 21. NetworkPolicy sem efeito

**Sintoma:** tudo se comunica apesar da política de negação.

**Causa:** o CNI não implementa NetworkPolicy. **O manifest é aceito e
ignorado** — falsa sensação de proteção.

**Diagnóstico:**

```bash
kubectl get pods -n kube-system | grep -Ei 'calico|cilium|weave'
```

Vazio significa que as políticas não são aplicadas.

**Correção:** criar o cluster kind com `disableDefaultCNI: true` e instalar
Calico.

**Prevenção:** aviso destacado em `kubernetes/README.md`.

---

## Observabilidade

### 22. Prometheus sem targets

**Sintoma:** targets ausentes ou `DOWN` em `/targets`.

**Diagnóstico:** http://localhost:9090/targets

**Correção:** verificar se os serviços estão no ar e se `/metrics` responde.
No Kubernetes, conferir as annotations `prometheus.io/*` e a NetworkPolicy —
o namespace `observability` precisa alcançar os pods.

---

### 23. Grafana sem dados

**Sintoma:** painéis vazios.

**Causa:** datasource inacessível, ou intervalo de tempo sem dados.

**Diagnóstico:** Configuration > Data sources > **Test**.

**Correção:** se o Prometheus está bem, ampliar o intervalo — o sistema pode
simplesmente não ter recebido tráfego. Gere alguns pedidos com
`scripts/create-order.sh`.

---

### 24. Jaeger sem traces

**Sintoma:** nenhum serviço na lista do Jaeger.

**Causas possíveis:** `OTEL_TRACES_ENABLED=false`; Collector fora do ar; ou —
a mais sutil — **Express carregado antes da instrumentação**.

**Diagnóstico:**

```bash
docker compose logs otel-collector --tail=50
docker compose logs api-gateway | grep -i tracing
```

**Correção:** confirmar que `./instrumentation` é o **primeiro import** de
`server.ts`. A auto-instrumentação funciona interceptando `require`; módulos
carregados antes não são instrumentados.

**Prevenção:** ponto de entrada dedicado `@loja-veloz/observability/tracing`,
que não arrasta o Express junto.

---

### 25. Alloy sem logs

**Sintoma:** `{job="docker"}` no Loki não retorna nada.

**Causa:** socket do Docker inacessível, ou nome de projeto do Compose fora do
padrão esperado pelo `discovery.relabel`.

**Diagnóstico:**

```bash
docker compose logs alloy --tail=50
curl -s http://localhost:3100/ready
```

**Correção:** o filtro mantém contêineres cujo projeto casa com `loja-veloz.*`.
Se você alterou o `name:` do Compose, ajuste o regex em `config.alloy`.

---

## CI/CD

### 26. Trivy bloqueando o build

**Sintoma:** o passo do Trivy falha.

**Causa:** não deveria acontecer — `exit-code` é `0` de propósito
(justificativa em ADR-009). Se estiver falhando, o workflow foi alterado.

**Correção:** se a decisão foi bloquear por CVE, é preciso um processo de
exceção. Sem ele, o desfecho previsto é alguém desabilitar o scan inteiro.

---

### 27. GitHub Actions sem permissão

**Sintoma:** `denied: permission_denied` ao publicar no GHCR, ou
`Resource not accessible by integration`.

**Causa:** `permissions` não declara `packages: write`, ou o repositório
restringe o `GITHUB_TOKEN` a leitura.

**Diagnóstico:** conferir o bloco `permissions` do workflow e
Settings > Actions > General > Workflow permissions.

**Correção:** declarar a permissão no workflow e liberar nas configurações.

**Prevenção:** cada workflow declara o mínimo necessário — `ci.yml` só lê.

---

### 28. Terraform sem credenciais

**Sintoma:** `No valid credential sources found`.

**Causa:** `plan` e `apply` exigem credencial; `validate` **não**.

**Diagnóstico:** `aws sts get-caller-identity`

**Correção:** configurar perfil, variáveis de ambiente ou OIDC. Para validar
sem credencial:

```bash
terraform init -backend=false && terraform validate
```

**Prevenção:** é exatamente assim que o `ci.yml` valida, sem nenhum segredo.

---

### 29. Custos AWS inesperados

**Sintoma:** cobrança acima do previsto.

**Causas mais comuns:** NAT Gateway (cobrado por hora **e** por GB, mesmo
ocioso); control plane EKS ocioso; RDS Multi-AZ; Load Balancer esquecido;
volumes EBS órfãos após deletar o cluster.

**Diagnóstico:** AWS Cost Explorer, agrupando por serviço e por tag
`Environment`.

**Correção:**

```bash
cd terraform/environments/staging && terraform destroy
```

Depois, conferir no console se sobrou Load Balancer ou volume — recursos
criados **pelo Kubernetes**, e não pelo Terraform, não são removidos pelo
`destroy`.

**Prevenção:** NAT desligado por padrão; SPOT em staging; `default_tags` em
todos os recursos; destruir o ambiente quando não estiver em uso.

---

## Comandos de diagnóstico rápido

```bash
# Local
docker compose ps
docker compose logs --tail=100 -f <serviço>
curl -s http://localhost:8080/health/ready | jq

# Kubernetes
kubectl get pods -n loja-veloz
kubectl describe pod <pod> -n loja-veloz
kubectl logs <pod> -n loja-veloz --previous
kubectl get events -n loja-veloz --sort-by=.lastTimestamp
kubectl top pods -n loja-veloz

# Mensageria
docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers

# Banco
docker compose exec postgres psql -U orders_user -d orders_db -c "\dt"
```
