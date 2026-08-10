variable "cluster_name" {
  description = "Nome do cluster EKS"
  type        = string
}

variable "kubernetes_version" {
  description = "Versão do Kubernetes. Fixada de propósito: deixar a AWS escolher torna o ambiente irreprodutível."
  type        = string
  default     = "1.31"
}

variable "vpc_id" {
  description = "VPC onde o cluster será criado"
  type        = string
}

variable "private_subnet_ids" {
  description = "Sub-redes privadas para o control plane e para os nós"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Sub-redes públicas, usadas quando node_group_public = true"
  type        = list(string)
  default     = []
}

variable "node_group_public" {
  description = <<-EOT
    Coloca os nós em sub-rede pública.

    `true` é a opção de BAIXO CUSTO: sem NAT Gateway, os nós ainda alcançam a
    internet para puxar imagens. O preço é menor isolamento de rede — os nós
    recebem IP público.

    `false` é o correto para produção, mas exige NAT Gateway
    (enable_nat_gateway = true no módulo de rede) ou VPC Endpoints para ECR.
  EOT
  type        = bool
  default     = false
}

variable "node_instance_types" {
  description = "Tipos de instância do node group"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_capacity_type" {
  description = <<-EOT
    ON_DEMAND ou SPOT.

    SPOT custa significativamente menos, mas as instâncias podem ser
    recuperadas pela AWS com 2 minutos de aviso. É viável para cargas
    stateless e tolerantes a interrupção — que é o caso dos quatro serviços
    deste projeto, todos com graceful shutdown e PodDisruptionBudget. Não use
    SPOT para cargas com estado.
  EOT
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["ON_DEMAND", "SPOT"], var.node_capacity_type)
    error_message = "node_capacity_type deve ser ON_DEMAND ou SPOT."
  }
}

variable "node_desired_size" {
  description = "Número desejado de nós"
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "Número mínimo de nós"
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Número máximo de nós"
  type        = number
  default     = 4
}

variable "node_disk_size" {
  description = "Tamanho do disco de cada nó, em GB"
  type        = number
  default     = 30
}

variable "endpoint_public_access" {
  description = "Expõe o endpoint da API do Kubernetes à internet. Necessário para deploy a partir do GitHub Actions hospedado."
  type        = bool
  default     = true
}

variable "public_access_cidrs" {
  description = "CIDRs autorizados a alcançar o endpoint público da API. 0.0.0.0/0 é aceitável apenas em ambiente acadêmico."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "tags" {
  description = "Tags aplicadas a todos os recursos"
  type        = map(string)
  default     = {}
}
