# Diagramas

Todos os diagramas são **Mermaid em texto**, versionados junto do código. Nada
de imagem binária: um PNG exportado de ferramenta externa fica desatualizado no
primeiro refactor e ninguém percebe.

O GitHub renderiza Mermaid nativamente em arquivos Markdown.

## Onde está cada um

| # | Diagrama | Tipo | Arquivo |
|---|---|---|---|
| 1 | Arquitetura geral | `graph TB` | [`architecture.md` §2](../architecture.md) |
| 2 | Fluxo de criação do pedido | `sequenceDiagram` | [`architecture.md` §4](../architecture.md) |
| 3 | Estados do pedido | `stateDiagram-v2` | [`architecture.md` §5](../architecture.md) |
| 4 | Topologia RabbitMQ | `graph LR` | [`architecture.md` §6](../architecture.md) |
| 5 | Modelo de dados | `erDiagram` | [`architecture.md` §7](../architecture.md) |
| 6 | Observabilidade | `graph LR` | [`architecture.md` §8](../architecture.md) |
| 7 | Pipeline CI/CD | `graph LR` | abaixo |
| 8 | Kubernetes | `graph TB` | abaixo |
| 9 | AWS com Terraform | `graph TB` | abaixo |

---

## 7. Pipeline CI/CD

```mermaid
graph LR
    subgraph Dev["Desenvolvimento"]
        PR["Pull Request"]
        Main["push na main"]
        Tag["tag v*.*.*"]
    end

    subgraph CI["ci.yml"]
        Q["lint · format<br/>typecheck · testes"]
        INT["integração<br/>stack real"]
        MAN["compose config<br/>kustomize<br/>terraform validate"]
    end

    subgraph IMG["images.yml"]
        BLD["build<br/>matriz de 4 serviços"]
        SCAN["Trivy<br/>ANTES do push"]
        PUSH["publica no GHCR<br/>tag sha-&lt;commit&gt;"]
    end

    subgraph DEP["deploy-staging.yml"]
        JOB["Job de migration"]
        APPLY["kubectl apply -k"]
        ROLL["rollout status"]
        SMOKE["smoke tests"]
        UNDO["rollback"]
    end

    PR --> Q --> INT
    PR --> MAN
    Main --> Q
    Main --> BLD
    Tag --> BLD

    BLD --> SCAN --> PUSH
    PUSH -.->|workflow_dispatch| JOB
    JOB --> APPLY --> ROLL --> SMOKE
    ROLL -.->|falhou| UNDO
    SMOKE -.->|falhou| UNDO
```

O Trivy roda **antes** do push, sobre a imagem carregada no daemon local.
Escanear depois significaria já ter distribuído uma imagem vulnerável.

O rollback automático só ocorre quando `skip_migrations` é verdadeiro:
reverter Deployment não desfaz migration, e colocar código antigo contra
schema novo pode ser pior que o estado atual.

---

## 8. Kubernetes

```mermaid
graph TB
    Internet(["Internet"])

    subgraph NS["Namespace loja-veloz — PSS restricted"]
        subgraph GW["api-gateway"]
            GWD["Deployment<br/>2-10 réplicas · HPA 60% CPU"]
            GWS["Service ClusterIP :8080"]
        end

        subgraph BE["Backends — sem HTTP entre si"]
            OD["order-service<br/>2-8 · HPA 70%"]
            ID["inventory-service<br/>2-8 · HPA 70%"]
            PD["payment-service<br/>2-6 · HPA 70%"]
        end

        CM["ConfigMap<br/>app-config"]
        SEC["Secret<br/>app-secrets<br/>fora do Git"]
        NP["NetworkPolicy<br/>deny-all + exceções"]
        PDB["PodDisruptionBudget<br/>minAvailable"]
        RQ["ResourceQuota<br/>LimitRange"]
    end

    ING["Ingress NGINX<br/>ns: ingress-nginx"]
    OBS["Prometheus · Loki<br/>Jaeger · Alloy<br/>ns: observability"]
    RDS[("RDS PostgreSQL")]
    MQ{{"RabbitMQ"}}

    Internet --> ING --> GWS --> GWD
    GWD --> OD
    GWD --> ID
    GWD --> PD

    OD --> RDS
    ID --> RDS
    PD --> RDS
    OD <--> MQ
    ID <--> MQ
    PD <--> MQ

    CM -.-> GWD
    CM -.-> OD
    SEC -.-> OD
    SEC -.-> ID
    SEC -.-> PD

    OBS -.->|scrape| GWD
    OBS -.->|scrape| OD
```

Cada serviço tem ServiceAccount própria, com
`automountServiceAccountToken: false`: nenhum deles fala com a API do
Kubernetes, então montar a credencial só ampliaria o estrago de um
comprometimento.

---

## 9. AWS com Terraform

```mermaid
graph TB
    subgraph VPC["VPC 10.20.0.0/16"]
        subgraph AZ1["AZ a"]
            PUB1["Sub-rede pública<br/>NAT · LB"]
            PRI1["Sub-rede privada<br/>nós EKS · RDS"]
        end
        subgraph AZ2["AZ b"]
            PUB2["Sub-rede pública"]
            PRI2["Sub-rede privada"]
        end
        subgraph AZ3["AZ c — só produção"]
            PUB3["Sub-rede pública"]
            PRI3["Sub-rede privada"]
        end

        IGW["Internet Gateway"]
        NAT["NAT Gateway<br/>opcional · cobrado por hora"]
        VPCE["VPC Endpoint S3<br/>tipo Gateway · sem custo/hora"]
    end

    subgraph MOD["Módulos Terraform"]
        M1["network"]
        M2["eks"]
        M3["database"]
    end

    EKS["EKS control plane<br/>+ node group"]
    RDS[("RDS PostgreSQL<br/>Multi-AZ em produção")]
    SM["Secrets Manager<br/>senha do banco"]
    S3["S3<br/>estado do Terraform"]

    M1 --> VPC
    M2 --> EKS
    M3 --> RDS
    M3 --> SM

    IGW --- PUB1
    PUB1 --- NAT
    NAT -.->|"se habilitado"| PRI1
    VPCE --- PRI1

    PRI1 --- EKS
    PRI1 --- RDS

    MOD -.->|estado| S3
```

**RabbitMQ não é provisionado por este Terraform.** As opções corretas são
Amazon MQ ou o RabbitMQ Cluster Operator; entregar um `aws_mq_broker` nunca
aplicado seria preencher diretório sem validação. Registrado em
`docs/limitations-and-roadmap.md`.

---

## Cuidados com o Mermaid do GitHub

O renderizador do GitHub é mais restritivo que o playground do Mermaid. O que
foi evitado nestes diagramas:

- parênteses, colchetes e chaves **dentro** de rótulos sem aspas — quebram o
  parser
- acentos em identificadores de nó (só no texto entre aspas)
- `<br/>` é aceito; `\n` não
- `subgraph` sem identificador antes do rótulo
- comentários `%%` no meio de uma definição de aresta

Ao alterar um diagrama, confira a renderização na própria página do GitHub
antes de considerar pronto: erro de sintaxe aparece como bloco de código cru,
não como mensagem de erro.
