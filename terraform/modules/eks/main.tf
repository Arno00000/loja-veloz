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
  node_subnet_ids = var.node_group_public ? var.public_subnet_ids : var.private_subnet_ids

  common_tags = merge(var.tags, {
    ManagedBy = "terraform"
    Module    = "eks"
  })
}

# --- IAM do control plane ----------------------------------------------------
data "aws_iam_policy_document" "cluster_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${var.cluster_name}-cluster-role"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume_role.json
  tags               = local.common_tags
}

# Políticas gerenciadas pela AWS, e não políticas inline: são mantidas
# atualizadas pela própria AWS conforme o EKS evolui.
resource "aws_iam_role_policy_attachment" "cluster_policy" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

# --- Cluster -----------------------------------------------------------------
resource "aws_cloudwatch_log_group" "cluster" {
  name = "/aws/eks/${var.cluster_name}/cluster"
  # Log de control plane sem retenção definida é cobrado indefinidamente.
  retention_in_days = 30
  tags              = local.common_tags
}

resource "aws_eks_cluster" "this" {
  name     = var.cluster_name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    # O control plane usa sub-redes privadas em qualquer configuração; a
    # escolha pública/privada afeta apenas os nós.
    subnet_ids              = concat(var.private_subnet_ids, var.public_subnet_ids)
    endpoint_private_access = true
    endpoint_public_access  = var.endpoint_public_access
    public_access_cidrs     = var.public_access_cidrs
  }

  # `api` e `audit` são o mínimo útil para investigar incidente de acesso.
  # Habilitar os cinco tipos aumenta o custo do CloudWatch sem ganho
  # proporcional em um MVP.
  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  access_config {
    # API é o modo recomendado desde o EKS 1.23+: dispensa editar o ConfigMap
    # aws-auth à mão, que é uma fonte clássica de perda de acesso ao cluster.
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster_policy,
    aws_cloudwatch_log_group.cluster,
  ]

  tags = merge(local.common_tags, {
    Name = var.cluster_name
  })
}

# --- IAM dos nós -------------------------------------------------------------
data "aws_iam_policy_document" "node_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${var.cluster_name}-node-role"
  assume_role_policy = data.aws_iam_policy_document.node_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "node_worker" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "node_cni" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "node_ecr" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# --- Node group --------------------------------------------------------------
resource "aws_eks_node_group" "this" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${var.cluster_name}-ng"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = local.node_subnet_ids

  instance_types = var.node_instance_types
  capacity_type  = var.node_capacity_type
  disk_size      = var.node_disk_size

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  update_config {
    # Um nó indisponível por vez durante upgrade: com PodDisruptionBudget
    # configurado, isso mantém a aplicação de pé durante a manutenção.
    max_unavailable = 1
  }

  lifecycle {
    # `desired_size` passa a ser controlado pelo Cluster Autoscaler depois da
    # criação. Sem este ignore, todo `terraform apply` reverteria a escala
    # decidida pelo autoscaler.
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_cni,
    aws_iam_role_policy_attachment.node_ecr,
  ]

  tags = merge(local.common_tags, {
    Name = "${var.cluster_name}-ng"
  })
}

# --- Addons ------------------------------------------------------------------
# Gerenciados pela AWS: recebem correção de segurança sem intervenção.
resource "aws_eks_addon" "vpc_cni" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "vpc-cni"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  depends_on                  = [aws_eks_node_group.this]
  tags                        = local.common_tags
}

resource "aws_eks_addon" "coredns" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "coredns"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  depends_on                  = [aws_eks_node_group.this]
  tags                        = local.common_tags
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name                = aws_eks_cluster.this.name
  addon_name                  = "kube-proxy"
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
  depends_on                  = [aws_eks_node_group.this]
  tags                        = local.common_tags
}

# O Metrics Server NÃO é um addon gerenciado do EKS e precisa ser instalado
# por Helm. Sem ele, o HPA deste projeto não funciona.
# Ver kubernetes/README.md.
