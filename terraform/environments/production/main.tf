terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend remoto OBRIGATÓRIO em produção. Ver
  # terraform/environments/staging/backend.tf.example para o modelo e para os
  # comandos de criação do bucket. A chave deve ser production/terraform.tfstate.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "loja-veloz"
      Criticality = "high"
    }
  }
}

locals {
  name_prefix  = "${var.project_name}-${var.environment}"
  cluster_name = "${var.project_name}-${var.environment}"

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

module "network" {
  source = "../../modules/network"

  name_prefix        = local.name_prefix
  cluster_name       = local.cluster_name
  availability_zones = var.availability_zones
  vpc_cidr           = "10.20.0.0/16"

  public_subnet_cidrs  = ["10.20.0.0/20", "10.20.16.0/20", "10.20.32.0/20"]
  private_subnet_cidrs = ["10.20.64.0/20", "10.20.80.0/20", "10.20.96.0/20"]

  # NAT ligado em produção: os nós ficam em sub-rede privada, sem IP público,
  # e a saída para a internet passa pelo NAT.
  #
  # CUSTO: com single_nat_gateway = false, são três NAT Gateways (um por AZ),
  # cada um cobrado por hora e por GB processado. É a maior parcela fixa do
  # custo de rede. A alternativa de um NAT único economiza, mas cria
  # dependência entre zonas: a perda da AZ do NAT deixa as outras duas sem
  # saída. Em produção, a redundância vale o custo.
  enable_nat_gateway = true
  single_nat_gateway = false

  tags = local.tags
}

module "eks" {
  source = "../../modules/eks"

  cluster_name       = local.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  public_subnet_ids  = module.network.public_subnet_ids

  # Nós em sub-rede privada: sem IP público, alcançáveis apenas de dentro da VPC.
  node_group_public = false

  node_instance_types = var.node_instance_types
  # ON_DEMAND em produção: instância recuperada pela AWS no meio de um pico é
  # exatamente o que não se quer durante uma campanha promocional.
  node_capacity_type = "ON_DEMAND"
  node_desired_size  = 3
  node_min_size      = 3
  node_max_size      = 10

  node_disk_size = 50

  endpoint_public_access = true
  public_access_cidrs    = var.public_access_cidrs

  tags = local.tags
}

module "database" {
  source = "../../modules/database"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids

  allowed_security_group_ids = [module.eks.cluster_security_group_id]

  instance_class        = var.db_instance_class
  allocated_storage     = 100
  max_allocated_storage = 500

  # Produção: réplica síncrona com failover automático, backup de 30 dias,
  # proteção contra exclusão acidental e snapshot final obrigatório.
  multi_az                     = true
  backup_retention_period      = 30
  deletion_protection          = true
  skip_final_snapshot          = false
  performance_insights_enabled = true

  tags = local.tags
}

# LIMITAÇÃO ASSUMIDA: o RabbitMQ não é provisionado por este código.
#
# O MVP roda o broker dentro do cluster, o que é inadequado para produção
# (ver kubernetes/overlays/development/dependencies-academic.yaml). As duas
# saídas corretas são o Amazon MQ para RabbitMQ, gerenciado e com failover, ou
# o RabbitMQ Cluster Operator oficial com volume persistente e quorum queues.
#
# Entregar aqui um `aws_mq_broker` que nunca foi aplicado seria preencher
# diretório sem validação. A decisão está registrada em
# docs/limitations-and-roadmap.md.
