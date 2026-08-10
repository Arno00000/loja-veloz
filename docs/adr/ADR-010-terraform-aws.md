# ADR-010 — Terraform e AWS como referência de nuvem

**Status:** Aceito · 2026-07-30

## Contexto

O problema declarado inclui **dificuldade de reproduzir a infraestrutura**.
Infraestrutura criada por cliques no console não é reproduzível, não é
revisável e não é auditável: ninguém sabe por que uma regra de firewall existe,
nem quem a criou.

## Decisão

**Terraform** como ferramenta de IaC, **AWS** como provedor de referência,
com módulos próprios:

```
modules/network   VPC, sub-redes, IGW, NAT opcional, VPC Endpoint S3
modules/eks       cluster, node group, papéis IAM, addons
modules/database  RDS PostgreSQL, subnet group, security group, Secrets Manager
environments/staging      baixo custo
environments/production   Multi-AZ, três zonas
```

Estado em backend S3 remoto, com criptografia, versionamento e bloqueio nativo.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Console da AWS** | Não é reproduzível nem revisável. É o problema, não a solução |
| **AWS CloudFormation / CDK** | Nativos e bem integrados, mas exclusivos da AWS. Terraform mantém a possibilidade de outro provedor sem trocar de ferramenta |
| **Pulumi** | IaC em linguagem de programação de verdade — atraente para quem já escreve TypeScript. Ecossistema e material de referência menores que os do Terraform |
| **Ansible** | Ferramenta de configuração, não de provisionamento declarativo de recursos de nuvem |
| **Módulos públicos** (`terraform-aws-modules/eks`) | Maduros e bem testados; usá-los seria defensável. Módulos próprios foram escolhidos por valor didático — o objetivo acadêmico inclui entender o que cada recurso faz, e um módulo público esconderia isso atrás de dezenas de variáveis |

## Consequências positivas

- Infraestrutura versionada, revisável em PR e reproduzível
- `terraform plan` mostra o que vai mudar **antes** de mudar
- Módulos reutilizáveis entre staging e produção, com parâmetros distintos
- `terraform fmt` e `terraform validate` rodam no CI **sem credencial da AWS**
- Destruir o ambiente é um comando — o que importa muito para não ser cobrado
  por recurso esquecido

## Consequências negativas

- **O arquivo de estado contém a senha do RDS em texto claro.** Não há como
  evitar isso no Terraform. É por isso que o backend remoto precisa de
  criptografia e acesso restrito, e por que um `terraform.tfstate` local é um
  arquivo perigoso
- Estado divergente da realidade se alguém alterar recurso pelo console
- Curva de aprendizado: HCL, ciclo de vida de recursos, dependências implícitas
- Alguns recursos demoram muito (EKS leva vários minutos)
- **Nada aqui foi aplicado.** Não há validação por execução

## Riscos

| Risco | Mitigação |
|---|---|
| Custo inesperado | Avisos explícitos em `terraform/README.md`; NAT desligado por padrão em staging; SPOT e `db.t4g.micro`; VPC Endpoint S3 sem custo por hora |
| Exclusão acidental de banco de produção | `deletion_protection = true` e `skip_final_snapshot = false` em produção |
| Estado corrompido | Versionamento do bucket S3 permite recuperar a versão anterior |
| Dois `apply` simultâneos | Bloqueio nativo do S3 (`use_lockfile`) |
| Credencial da AWS vazada | Nenhuma chave no repositório; OIDC recomendado no GitHub Actions |
| Módulo público mudando de comportamento | Não aplicável hoje; quando usados, versão fixada e origem oficial registrada |

## O que este código NÃO cobre

Declarado por honestidade, não por esquecimento:

- **RabbitMQ não é provisionado.** As opções corretas são Amazon MQ ou o
  RabbitMQ Cluster Operator. Entregar um `aws_mq_broker` nunca aplicado seria
  preencher diretório sem validação
- Route 53 e ACM — exigem domínio real
- IRSA — o emissor OIDC é exposto como output, mas nenhum papel por
  ServiceAccount foi criado
- Cluster Autoscaler ou Karpenter
- Os três bancos por serviço: o módulo cria a instância; os bancos são criados
  por Job dentro do cluster, porque o provider `postgresql` exigiria
  conectividade a partir de onde o Terraform roda

## Critérios de revisão

Substituir os módulos próprios pelos públicos quando a manutenção deles passar
a competir com a evolução do produto — o módulo `terraform-aws-modules/eks`
resolve casos de borda que este não cobre.

Adotar Terragrunt se o número de ambientes crescer a ponto de a duplicação
entre `environments/` incomodar.
