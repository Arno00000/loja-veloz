terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  az_count = length(var.availability_zones)
  nat_count = var.enable_nat_gateway ? (var.single_nat_gateway ? 1 : local.az_count) : 0

  common_tags = merge(var.tags, {
    ManagedBy = "terraform"
    Module    = "network"
  })
}

resource "aws_vpc" "this" {
  cidr_block = var.vpc_cidr
  # Ambos necessários para que os nós do EKS resolvam nomes internos e para
  # que os VPC Endpoints privados funcionem.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpc"
  })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-igw"
  })
}

# --- Sub-redes públicas ------------------------------------------------------
# Recebem o Load Balancer criado pelo Ingress Controller. A tag
# `kubernetes.io/role/elb` é o que faz o AWS Load Balancer Controller
# encontrar estas sub-redes automaticamente.
resource "aws_subnet" "public" {
  count = local.az_count

  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name                                        = "${var.name_prefix}-public-${var.availability_zones[count.index]}"
    "kubernetes.io/role/elb"                    = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    Tier                                        = "public"
  })
}

# --- Sub-redes privadas ------------------------------------------------------
# Abrigam os nós do EKS e o RDS. A tag `internal-elb` permite balanceadores
# internos.
resource "aws_subnet" "private" {
  count = local.az_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  tags = merge(local.common_tags, {
    Name                                        = "${var.name_prefix}-private-${var.availability_zones[count.index]}"
    "kubernetes.io/role/internal-elb"           = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    Tier                                        = "private"
  })
}

# --- NAT Gateway (opcional, desligado por padrão) ----------------------------
resource "aws_eip" "nat" {
  count = local.nat_count

  domain = "vpc"

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-nat-eip-${count.index}"
  })
}

resource "aws_nat_gateway" "this" {
  count = local.nat_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  # O NAT precisa de rota para a internet já existente no momento da criação.
  depends_on = [aws_internet_gateway.this]

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-nat-${count.index}"
  })
}

# --- Tabelas de rota ---------------------------------------------------------
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-rt-public"
  })
}

resource "aws_route_table_association" "public" {
  count = local.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Uma tabela por AZ mesmo com NAT único: assim, habilitar múltiplos NATs
# depois não exige recriar as associações.
resource "aws_route_table" "private" {
  count = local.az_count

  vpc_id = aws_vpc.this.id

  # Rota de saída só existe se houver NAT. Sem ela, a sub-rede privada é
  # isolada da internet — o que é seguro, mas impede o pull de imagens.
  dynamic "route" {
    for_each = var.enable_nat_gateway ? [1] : []
    content {
      cidr_block     = "0.0.0.0/0"
      nat_gateway_id = aws_nat_gateway.this[var.single_nat_gateway ? 0 : count.index].id
    }
  }

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-rt-private-${var.availability_zones[count.index]}"
  })
}

resource "aws_route_table_association" "private" {
  count = local.az_count

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# --- VPC Endpoints (alternativa de baixo custo ao NAT) -----------------------
# O endpoint de S3 é do tipo Gateway e NÃO tem custo por hora. Como as camadas
# de imagem do ECR ficam em S3, ele já reduz bastante o tráfego que passaria
# pelo NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-vpce-s3"
  })
}

data "aws_region" "current" {}
