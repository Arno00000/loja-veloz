variable "name_prefix" {
  description = "Prefixo aplicado ao nome de todos os recursos"
  type        = string
}

variable "vpc_cidr" {
  description = "Bloco CIDR da VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Zonas de disponibilidade. Duas é o mínimo exigido pelo EKS e pelo RDS Multi-AZ."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "O EKS exige sub-redes em ao menos duas zonas de disponibilidade."
  }
}

variable "public_subnet_cidrs" {
  description = "CIDRs das sub-redes públicas, na mesma ordem das AZs"
  type        = list(string)
  default     = ["10.0.0.0/20", "10.0.16.0/20"]
}

variable "private_subnet_cidrs" {
  description = "CIDRs das sub-redes privadas, na mesma ordem das AZs"
  type        = list(string)
  default     = ["10.0.32.0/20", "10.0.48.0/20"]
}

variable "enable_nat_gateway" {
  description = <<-EOT
    Cria NAT Gateway para dar saída à internet às sub-redes privadas.

    CUSTO: o NAT Gateway é cobrado por hora de existência MAIS por GB
    processado, independentemente de haver tráfego. É um dos itens de maior
    custo fixo de uma VPC. Por isso o padrão é `false`.

    Com `false`, os nós do EKS em sub-rede privada NÃO alcançam a internet.
    Consequência prática: não conseguem puxar imagens do GHCR nem de qualquer
    registry público. Para um ambiente funcional sem NAT há duas saídas:
      1. colocar os nós em sub-rede pública (`node_group_public = true`),
         mais barato e aceitável em ambiente acadêmico;
      2. usar VPC Endpoints para ECR e S3, o que resolve o pull de imagens
         sem NAT, mas não dá saída geral à internet.
  EOT
  type        = bool
  default     = false
}

variable "single_nat_gateway" {
  description = "Um único NAT compartilhado entre as AZs. Reduz custo, mas cria ponto único de falha entre zonas."
  type        = bool
  default     = true
}

variable "cluster_name" {
  description = "Nome do cluster EKS, usado nas tags de descoberta de sub-rede"
  type        = string
}

variable "tags" {
  description = "Tags aplicadas a todos os recursos"
  type        = map(string)
  default     = {}
}
