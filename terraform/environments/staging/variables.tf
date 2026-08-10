variable "aws_region" {
  description = "Região da AWS"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Nome do projeto, usado como prefixo dos recursos"
  type        = string
  default     = "loja-veloz"
}

variable "environment" {
  description = "Nome do ambiente"
  type        = string
  default     = "staging"
}

variable "availability_zones" {
  description = "Zonas de disponibilidade"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "kubernetes_version" {
  description = "Versão do Kubernetes no EKS"
  type        = string
  default     = "1.31"
}

variable "node_instance_types" {
  description = "Tipos de instância dos nós"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_capacity_type" {
  description = "ON_DEMAND ou SPOT"
  type        = string
  default     = "SPOT"
}

variable "enable_nat_gateway" {
  description = "Cria NAT Gateway. Ver o aviso de custo no módulo de rede."
  type        = bool
  default     = false
}

variable "public_access_cidrs" {
  description = "CIDRs autorizados a alcançar a API do Kubernetes. Restrinja ao IP de saída do runner de CI."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
