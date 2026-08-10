variable "name_prefix" {
  description = "Prefixo aplicado ao nome dos recursos"
  type        = string
}

variable "vpc_id" {
  description = "VPC onde o banco será criado"
  type        = string
}

variable "private_subnet_ids" {
  description = "Sub-redes privadas do subnet group. Banco nunca em sub-rede pública."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = <<-EOT
    Security groups autorizados a alcançar a porta do PostgreSQL.

    Liberar por security group, e não por CIDR, é o que mantém a regra correta
    quando os nós mudam de IP — o que acontece a cada escala do node group.
  EOT
  type        = list(string)
  default     = []
}

variable "engine_version" {
  description = "Versão do PostgreSQL. Fixada para reprodutibilidade."
  type        = string
  default     = "16.4"
}

variable "instance_class" {
  description = <<-EOT
    Classe da instância RDS.

    db.t4g.micro é elegível ao nível gratuito na primeira conta e suficiente
    para o ambiente acadêmico. Instâncias da família T são "burstable": têm
    créditos de CPU que se esgotam sob carga sustentada, e a partir daí o
    desempenho cai drasticamente. Para produção real, use a família M.
  EOT
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Armazenamento inicial em GB"
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Teto do autoscaling de armazenamento. Zero desabilita o autoscaling."
  type        = number
  default     = 50
}

variable "database_name" {
  description = "Banco inicial criado com a instância"
  type        = string
  default     = "postgres"
}

variable "master_username" {
  description = "Usuário administrador"
  type        = string
  default     = "lojaveloz_admin"
}

variable "multi_az" {
  description = <<-EOT
    Réplica síncrona em outra zona de disponibilidade, com failover automático.

    CUSTO: aproximadamente dobra o preço da instância, porque provisiona uma
    segunda. Padrão `false` para staging; `true` é obrigatório em produção.
  EOT
  type        = bool
  default     = false
}

variable "backup_retention_period" {
  description = "Dias de retenção de backup automático. Zero DESABILITA backup — inaceitável em produção."
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Impede exclusão acidental. Com `true`, `terraform destroy` falha até que seja desligado."
  type        = bool
  default     = false
}

variable "skip_final_snapshot" {
  description = "Pula o snapshot final na exclusão. `true` acelera o descarte em ambiente acadêmico e DESTRÓI os dados."
  type        = bool
  default     = true
}

variable "performance_insights_enabled" {
  description = "Habilita o Performance Insights. Sete dias de retenção não têm custo adicional."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags aplicadas a todos os recursos"
  type        = map(string)
  default     = {}
}
