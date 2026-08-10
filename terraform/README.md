# Terraform — infraestrutura na AWS

## Aviso de execução

**Nada neste diretório foi aplicado.** Nenhum `terraform apply` foi executado
durante a construção deste projeto, e portanto **nenhuma afirmação de que a
infraestrutura funciona pode ser feita**. O código foi escrito e revisado por
inspeção; a validação real depende de uma conta AWS e está registrada como
`PENDENTE DE EXECUÇÃO` em `docs/practical-report.md`.

## Estrutura

```
modules/
  network/     VPC, sub-redes públicas e privadas, IGW, NAT opcional, VPC Endpoint S3
  eks/         cluster EKS, node group, papéis IAM, addons gerenciados
  database/    RDS PostgreSQL, subnet group, security group, senha no Secrets Manager
environments/
  staging/     baixo custo: SPOT, sem NAT, RDS single-AZ, backup 3 dias
  production/  3 AZs, ON_DEMAND, NAT por zona, RDS Multi-AZ, backup 30 dias
```

Módulos são chamados por caminho relativo local. Quando módulos públicos forem
usados (por exemplo `terraform-aws-modules/eks/aws`), a versão deve ser fixada
com `version = "x.y.z"` e a origem oficial registrada — módulo sem versão
fixada quebra o build sozinho na próxima release.

## O que cada comando faz

| Comando | Precisa de credencial AWS? | Cria recurso? | Custo |
|---|---|---|---|
| `terraform fmt -check` | não | não | nenhum |
| `terraform init -backend=false` | não | não | nenhum |
| `terraform validate` | não | não | nenhum |
| `terraform init` (com backend) | sim | não | nenhum |
| `terraform plan` | sim | não | nenhum |
| `terraform apply` | sim | **sim** | **cobrado** |
| `terraform destroy` | sim | remove | interrompe a cobrança |

Os dois primeiros rodam no `ci.yml` a cada PR. `validate` checa sintaxe,
tipos de variável e referências entre recursos **sem consultar a API da AWS** —
por isso funciona no pipeline sem nenhum segredo configurado.

`plan` é diferente: ele lê o estado atual dos recursos na AWS e precisa de
credencial, mesmo sem alterar nada.

## Sequência

```bash
cd terraform/environments/staging

cp terraform.tfvars.example terraform.tfvars
cp backend.tf.example backend.tf        # ajuste o nome do bucket

terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=tfplan               # revise a saída ANTES de aplicar
terraform apply tfplan
```

Aplicar um plano salvo (`tfplan`), e não `terraform apply` direto, garante que
o que será executado é exatamente o que foi revisado.

## Custo

Este ambiente provisiona recursos **cobrados**. Os itens de maior impacto:

| Recurso | Natureza da cobrança |
|---|---|
| EKS control plane | por hora, independentemente de uso |
| Nós EC2 | por hora, por instância |
| NAT Gateway | por hora **mais** por GB processado, mesmo ocioso |
| RDS Multi-AZ | aproximadamente o dobro de single-AZ (provisiona duas instâncias) |
| Load Balancer | por hora mais por capacidade utilizada |
| CloudWatch Logs | por GB ingerido e armazenado |

**Este projeto não informa valores em moeda.** Preços variam por região, por
conta e ao longo do tempo; publicar um número seria inventar dado. Use a
calculadora oficial da AWS.

**Decisões tomadas para reduzir custo em staging:**

- `enable_nat_gateway = false` — o NAT é um dos maiores custos fixos de uma
  VPC. Sem ele, os nós vão para sub-rede pública (`node_group_public = true`),
  o que preserva o acesso ao GHCR ao custo de menor isolamento de rede.
- `node_capacity_type = "SPOT"` — instâncias podem ser recuperadas com 2
  minutos de aviso. Aceitável porque os quatro serviços são stateless, têm
  graceful shutdown e PodDisruptionBudget.
- `db.t4g.micro` — elegível ao nível gratuito na primeira conta.
- VPC Endpoint de S3 — tipo Gateway, **sem custo por hora**, reduz o tráfego
  que passaria pelo NAT.

**Destruir o ambiente quando não estiver em uso** é a única forma confiável de
não ser cobrado:

```bash
terraform destroy
```

Em produção, `deletion_protection = true` faz o destroy do RDS falhar de
propósito. Desligar essa proteção é uma decisão consciente, não um obstáculo a
contornar sem pensar.

## Segredos

**Nenhuma chave da AWS neste repositório.** O provider resolve credenciais por,
em ordem de preferência:

1. **OIDC no GitHub Actions** (recomendado) — sem chave estática, tokens de
   vida curta trocados por `sts:AssumeRoleWithWebIdentity`
2. Perfil do `~/.aws/credentials`
3. Variáveis `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`

A senha do RDS é gerada por `random_password` e guardada no AWS Secrets
Manager. **Ela também fica no arquivo de estado, em texto claro** — não há
como evitar isso no Terraform. É exatamente por isso que o backend remoto
precisa de criptografia em repouso, versionamento e acesso restrito. Um
`terraform.tfstate` local é um arquivo com a senha do banco de produção
dentro.

## Depois do apply

O módulo de banco cria a **instância**, não os três bancos por serviço. O
provider `postgresql` exigiria conectividade de rede a partir de onde o
Terraform roda, e a instância está em sub-rede privada.

Os bancos são criados por um Job dentro do cluster:

```bash
# 1. kubectl
aws eks update-kubeconfig --region us-east-1 --name loja-veloz-staging

# 2. Senha do administrador
export PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id $(terraform output -raw database_secret_arn) \
  --query SecretString --output text | jq -r .password)

# 3. Job que executa o mesmo script de database/postgres-init/
kubectl create configmap postgres-init -n loja-veloz \
  --from-file=../../../database/postgres-init/01-create-databases.sh

kubectl run db-init --rm -it --restart=Never -n loja-veloz \
  --image=postgres:16-bookworm \
  --env="POSTGRES_USER=lojaveloz_admin" \
  --env="PGPASSWORD=$PGPASSWORD" \
  --env="PGHOST=$(terraform output -raw database_endpoint | cut -d: -f1)" \
  -- bash /scripts/01-create-databases.sh
```

Depois disso, siga `kubernetes/README.md` para instalar Metrics Server,
Ingress Controller e a stack de observabilidade.

## O que este código não cobre

- **RabbitMQ** — não provisionado. As opções corretas são Amazon MQ ou o
  RabbitMQ Cluster Operator. Entregar um `aws_mq_broker` nunca aplicado seria
  preencher diretório sem validação.
- **DNS e certificados** — sem Route 53 nem ACM. Exigem um domínio real.
- **IRSA** — o emissor OIDC é exposto como output, mas nenhum papel IAM por
  ServiceAccount foi criado. É o pré-requisito do External Secrets Operator.
- **Cluster Autoscaler / Karpenter** — o node group escala manualmente; o
  `ignore_changes` em `desired_size` já prepara o terreno.
- **WAF, Shield, GuardDuty** — fora do escopo do MVP.
