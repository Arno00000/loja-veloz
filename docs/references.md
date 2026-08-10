# Referências

Formatação aproximada da ABNT NBR 6023. Todas as referências são **fontes
primárias**: documentação oficial dos projetos e fornecedores, ou o texto
original dos autores.

## Nota de honestidade sobre verificação

As referências abaixo estão divididas em duas listas:

- **Verificadas** — a URL foi acessada durante a construção deste projeto e o
  conteúdo confirmado.
- **Pendentes de verificação** — são páginas de documentação oficial cuja
  existência é sólida, mas cuja URL exata, título ou data de atualização **não
  foram conferidos** nesta sessão. Estão marcadas com
  `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`.

Apresentar uma referência não conferida como verificada seria inventar dado.
Antes da entrega final, cada item da segunda lista deve ser acessado e movido
para a primeira, ou corrigido.

---

## Referências verificadas

GOOGLE CLOUD PLATFORM. **microservices-demo: sample cloud-first application
with 10 microservices showcasing Kubernetes, Istio, and gRPC**. GitHub, 2026.
Disponível em: https://github.com/GoogleCloudPlatform/microservices-demo.
Acesso em: 30 jul. 2026.

GOOGLE CLOUD PLATFORM. **Online Boutique: README**. GitHub, 2026. Disponível
em: https://github.com/GoogleCloudPlatform/microservices-demo/blob/main/README.md.
Acesso em: 30 jul. 2026.

GOOGLE CLOUD PLATFORM. **Online Boutique: development guide**. GitHub, 2026.
Disponível em:
https://github.com/GoogleCloudPlatform/microservices-demo/blob/main/docs/development-guide.md.
Acesso em: 30 jul. 2026.

---

## Referências pendentes de verificação

### Fundamentos

WIGGINS, Adam. **The Twelve-Factor App**. [S.l.], 2011. Disponível em:
https://12factor.net. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Usada em: configuração externa à aplicação (fator III), processos stateless
> (fator VI), logs como fluxo de eventos (fator XI), paridade entre ambientes
> (fator X).

FOWLER, Martin; LEWIS, James. **Microservices: a definition of this new
architectural term**. martinfowler.com, 2014. Disponível em:
https://martinfowler.com/articles/microservices.html. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

RICHARDSON, Chris. **Microservice Architecture patterns**. microservices.io.
Disponível em: https://microservices.io. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Usada em: padrão Database per Service, Saga, Transactional Outbox e
> Idempotent Consumer, citados em ADR-003, ADR-004 e nas limitações.

### Contêineres

DOCKER INC. **Docker documentation**. Disponível em: https://docs.docker.com.
Acesso em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

DOCKER INC. **Best practices for writing Dockerfiles**. Disponível em:
https://docs.docker.com/build/building/best-practices/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Usada em: multi-stage build, ordenação de camadas para cache, usuário
> não-root.

DOCKER INC. **Docker Compose specification**. Disponível em:
https://docs.docker.com/compose/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

### Orquestração

THE KUBERNETES AUTHORS. **Kubernetes documentation**. Disponível em:
https://kubernetes.io/docs/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

THE KUBERNETES AUTHORS. **Configure liveness, readiness and startup probes**.
Disponível em:
https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/.
Acesso em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Base da distinção entre liveness e readiness adotada no projeto.

THE KUBERNETES AUTHORS. **Horizontal Pod Autoscaling**. Disponível em:
https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/.
Acesso em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

THE KUBERNETES AUTHORS. **Pod Security Standards**. Disponível em:
https://kubernetes.io/docs/concepts/security/pod-security-standards/. Acesso
em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

THE KUBERNETES AUTHORS. **Network Policies**. Disponível em:
https://kubernetes.io/docs/concepts/services-networking/network-policies/.
Acesso em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

THE KUBERNETES AUTHORS. **Secrets**. Disponível em:
https://kubernetes.io/docs/concepts/configuration/secret/. Acesso em:
30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Fonte do aviso de que Secrets são armazenados codificados em Base64, e não
> criptografados por padrão.

SIG CLI. **Kustomize**. Disponível em: https://kubectl.docs.kubernetes.io/.
Acesso em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

KUBERNETES SIGS. **Metrics Server**. GitHub. Disponível em:
https://github.com/kubernetes-sigs/metrics-server. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

### Mensageria

BROADCOM / VMWARE. **RabbitMQ documentation**. Disponível em:
https://www.rabbitmq.com/docs. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

BROADCOM / VMWARE. **RabbitMQ: reliability guide**. Disponível em:
https://www.rabbitmq.com/docs/reliability. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Base das afirmações sobre publisher confirms, acknowledgement manual e
> entrega "ao menos uma vez".

BROADCOM / VMWARE. **RabbitMQ: dead letter exchanges**. Disponível em:
https://www.rabbitmq.com/docs/dlx. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Base do padrão de retry com TTL + dead-letter adotado em
> `packages/messaging/src/topology.ts`.

### Observabilidade

OPENTELEMETRY AUTHORS. **OpenTelemetry documentation**. Cloud Native Computing
Foundation. Disponível em: https://opentelemetry.io/docs/. Acesso em:
30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

W3C. **Trace Context**. W3C Recommendation. Disponível em:
https://www.w3.org/TR/trace-context/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Especificação dos cabeçalhos `traceparent` e `tracestate` propagados pelo
> projeto em HTTP e nos headers AMQP.

PROMETHEUS AUTHORS. **Prometheus documentation**. Disponível em:
https://prometheus.io/docs/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

PROMETHEUS AUTHORS. **Metric and label naming best practices**. Disponível em:
https://prometheus.io/docs/practices/naming/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Base da regra de cardinalidade adotada: identificadores nunca viram label.

GRAFANA LABS. **Grafana documentation**. Disponível em:
https://grafana.com/docs/grafana/latest/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

GRAFANA LABS. **Loki documentation**. Disponível em:
https://grafana.com/docs/loki/latest/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

GRAFANA LABS. **Grafana Alloy documentation**. Disponível em:
https://grafana.com/docs/alloy/latest/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

THE JAEGER AUTHORS. **Jaeger documentation**. Cloud Native Computing
Foundation. Disponível em: https://www.jaegertracing.io/docs/. Acesso em:
30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

### CI/CD e registro de imagens

GITHUB INC. **GitHub Actions documentation**. Disponível em:
https://docs.github.com/actions. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

GITHUB INC. **Working with the Container registry**. Disponível em:
https://docs.github.com/packages/working-with-a-github-packages-registry/working-with-the-container-registry.
Acesso em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

GITHUB INC. **Automatic token authentication**. Disponível em:
https://docs.github.com/actions/security-guides/automatic-token-authentication.
Acesso em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Base da escolha do `GITHUB_TOKEN` em vez de um Personal Access Token.

AQUA SECURITY. **Trivy documentation**. Disponível em:
https://trivy.dev/latest/docs/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

### Infraestrutura como código e nuvem

HASHICORP. **Terraform documentation**. Disponível em:
https://developer.hashicorp.com/terraform/docs. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

HASHICORP. **Terraform AWS Provider**. Terraform Registry. Disponível em:
https://registry.terraform.io/providers/hashicorp/aws/latest/docs. Acesso em:
30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

AMAZON WEB SERVICES. **Amazon EKS User Guide**. Disponível em:
https://docs.aws.amazon.com/eks/latest/userguide/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

AMAZON WEB SERVICES. **Amazon RDS User Guide**. Disponível em:
https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/. Acesso em:
30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

AMAZON WEB SERVICES. **AWS Well-Architected Framework**. Disponível em:
https://docs.aws.amazon.com/wellarchitected/latest/framework/. Acesso em:
30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

### Service mesh e evoluções

ISTIO AUTHORS. **Istio documentation**. Disponível em: https://istio.io/latest/docs/.
Acesso em: 30 jul. 2026. `[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

> Citada em ADR-008 como referência do que um service mesh entrega — mTLS
> automático, retry no nível da malha e divisão ponderada de tráfego.

ARGO PROJECT. **Argo Rollouts documentation**. Disponível em:
https://argo-rollouts.readthedocs.io/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

KEDA AUTHORS. **KEDA documentation**. Cloud Native Computing Foundation.
Disponível em: https://keda.sh/docs/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

### Ferramentas da stack

OPENJS FOUNDATION. **Node.js documentation**. Disponível em:
https://nodejs.org/docs/latest-v22.x/api/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

NPM INC. **npm workspaces**. Disponível em:
https://docs.npmjs.com/cli/v10/using-npm/workspaces. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

PRISMA. **Prisma ORM documentation**. Disponível em:
https://www.prisma.io/docs. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

THE POSTGRESQL GLOBAL DEVELOPMENT GROUP. **PostgreSQL 16 documentation**.
Disponível em: https://www.postgresql.org/docs/16/. Acesso em: 30 jul. 2026.
`[REFERÊNCIA PENDENTE DE VERIFICAÇÃO]`

---

## Como verificar

Para cada item da segunda lista:

1. Abrir a URL
2. Confirmar título, organização responsável e que o conteúdo corresponde ao
   uso citado
3. Registrar a data real de acesso
4. Mover para a lista de verificadas, ou corrigir a entrada

Referência que não puder ser confirmada deve ser **removida**, e não mantida
com a marcação — a marcação existe para o intervalo entre escrever e conferir,
não como estado permanente.
