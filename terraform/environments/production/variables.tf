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
  default     = "production"
}

variable "availability_zones" {
  description = "Zonas de disponibilidade. Três em produção, para tolerar a perda de uma."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "kubernetes_version" {
  description = "Versão do Kubernetes no EKS"
  type        = string
  default     = "1.31"
}

variable "node_instance_types" {
  description = "Tipos de instância dos nós"
  type        = list(string)
  default     = ["m6i.large"]
}

variable "public_access_cidrs" {
  description = <<-EOT
    CIDRs autorizados a alcançar a API do Kubernetes.

    Em produção este valor NÃO deve ser 0.0.0.0/0. Restrinja aos IPs de saída
    do runner de CI e da VPN corporativa. O valor padrão aqui é propositalmente
    um bloco privado, para que um apply sem configuração explícita falhe em vez
    de expor o cluster.
  EOT
  type        = list(string)
  default     = ["10.0.0.0/8"]
}

variable "db_instance_class" {
  description = "Classe da instância RDS. Família M em produção: a família T tem créditos de CPU que se esgotam sob carga sustentada."
  type        = string
  default     = "db.m6g.large"
}
