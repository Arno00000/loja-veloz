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

  # O backend remoto está em backend.tf.example. Renomeie para backend.tf e
  # ajuste os valores. Ele fica fora do Git de propósito: o nome do bucket de
  # estado é informação de infraestrutura que não deve ser pública.
  #
  # Sem backend configurado, o estado fica em terraform.tfstate LOCAL, o que
  # significa: nenhum bloqueio contra dois `apply` simultâneos, nenhuma
  # criptografia, nenhum histórico, e perda total se a máquina falhar.
}

provider "aws" {
  region = var.aws_region

  # NENHUMA credencial no código. O provider resolve por variáveis de
  # ambiente (AWS_ACCESS_KEY_ID), perfil do ~/.aws/credentials, ou OIDC no
  # GitHub Actions — que é a forma recomendada, pois dispensa chave estática.
  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "loja-veloz"
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
  vpc_cidr           = "10.10.0.0/16"

  public_subnet_cidrs  = ["10.10.0.0/20", "10.10.16.0/20"]
  private_subnet_cidrs = ["10.10.32.0/20", "10.10.48.0/20"]

  # Desligado por padrão: NAT Gateway é cobrado por hora, mesmo ocioso.
  # Com `false`, os nós ficam em sub-rede pública (ver módulo eks abaixo).
  enable_nat_gateway = var.enable_nat_gateway
  single_nat_gateway = true

  tags = local.tags
}

module "eks" {
  source = "../../modules/eks"

  cluster_name       = local.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  public_subnet_ids  = module.network.public_subnet_ids

  # Sem NAT, os nós precisam de sub-rede pública para puxar imagens do GHCR.
  node_group_public = !var.enable_nat_gateway

  node_instance_types = var.node_instance_types
  # SPOT em staging: interrupção é tolerável e o custo cai bastante.
  node_capacity_type = var.node_capacity_type
  node_desired_size  = 2
  node_min_size      = 2
  node_max_size      = 4

  # Público porque o deploy vem do GitHub Actions hospedado. Restringir
  # `public_access_cidrs` ao IP do runner é o mínimo recomendável.
  endpoint_public_access = true
  public_access_cidrs    = var.public_access_cidrs

  tags = local.tags
}

module "database" {
  source = "../../modules/database"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids

  # Libera a porta apenas para o security group do cluster: os nós mudam de
  # IP a cada escala, mas o security group permanece.
  allowed_security_group_ids = [module.eks.cluster_security_group_id]

  instance_class    = "db.t4g.micro"
  allocated_storage = 20

  # Staging não é produção: sem Multi-AZ, backup curto, sem proteção de
  # exclusão, para que o ambiente possa ser destruído e recriado à vontade.
  multi_az                = false
  backup_retention_period = 3
  deletion_protection     = false
  skip_final_snapshot     = true

  tags = local.tags
}
