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
}

locals {
  common_tags = merge(var.tags, {
    ManagedBy = "terraform"
    Module    = "database"
  })
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-db-subnet-group"
  })
}

resource "aws_security_group" "database" {
  name        = "${var.name_prefix}-db-sg"
  description = "Acesso ao PostgreSQL restrito aos nos do cluster"
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-db-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Regras como recursos separados, e não blocos inline: assim é possível
# adicionar ou remover uma origem sem recriar o security group inteiro.
resource "aws_vpc_security_group_ingress_rule" "postgres" {
  count = length(var.allowed_security_group_ids)

  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = var.allowed_security_group_ids[count.index]
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL a partir do cluster EKS"
}

# Sem regra de egress: um banco de dados não precisa iniciar conexões.
# Nenhuma saída é o privilégio mínimo aqui.

# --- Senha do administrador --------------------------------------------------
# Gerada pelo Terraform e guardada no AWS Secrets Manager. A senha aparece no
# ARQUIVO DE ESTADO do Terraform em texto claro — por isso o backend remoto
# precisa de criptografia em repouso e acesso restrito. Ver terraform/README.md.
resource "random_password" "master" {
  length  = 32
  special = true
  # Caracteres que o RDS não aceita na senha do administrador.
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_secretsmanager_secret" "database" {
  name        = "${var.name_prefix}/database/master"
  description = "Credenciais do administrador do RDS da Loja Veloz"
  # Zero permite recriar o segredo imediatamente após destruir, o que evita
  # travar o ambiente acadêmico na janela padrão de 30 dias.
  recovery_window_in_days = 0

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id

  secret_string = jsonencode({
    username = var.master_username
    password = random_password.master.result
    engine   = "postgres"
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = var.database_name
  })
}

# --- Instância ---------------------------------------------------------------
resource "aws_db_parameter_group" "this" {
  name   = "${var.name_prefix}-pg16"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # registra consultas acima de 1s
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = local.common_tags
}

resource "aws_db_instance" "this" {
  identifier = "${var.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage == 0 ? null : var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.database_name
  username = var.master_username
  password = random_password.master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  # Instância NUNCA acessível pela internet. Só de dentro da VPC.
  publicly_accessible = false

  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_period
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"

  parameter_group_name = aws_db_parameter_group.this.name

  # Correções de segurança aplicadas automaticamente na janela de manutenção.
  auto_minor_version_upgrade = true

  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_retention_period = var.performance_insights_enabled ? 7 : null
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.name_prefix}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  lifecycle {
    # `timestamp()` muda a cada plano e provocaria diferença permanente.
    ignore_changes = [final_snapshot_identifier]
  }

  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-postgres"
  })
}

# NOTA SOBRE OS TRÊS BANCOS
#
# Este módulo cria a INSTÂNCIA e o banco inicial. Os três bancos por serviço
# (orders_db, inventory_db, payments_db) e seus usuários NÃO são criados aqui:
# o provider `postgresql` do Terraform exigiria conectividade de rede a partir
# de onde o Terraform roda, e a instância está em sub-rede privada.
#
# O caminho adotado é criá-los por Job do Kubernetes, executando o mesmo
# script de database/postgres-init/, a partir de dentro do cluster. Ver
# terraform/README.md, seção "Depois do apply".
