output "endpoint" {
  description = "Endpoint do RDS, no formato host:porta"
  value       = aws_db_instance.this.endpoint
}

output "address" {
  description = "Nome de host do RDS"
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Porta do PostgreSQL"
  value       = aws_db_instance.this.port
}

output "database_name" {
  description = "Nome do banco inicial"
  value       = aws_db_instance.this.db_name
}

output "security_group_id" {
  description = "Security group da instância"
  value       = aws_security_group.database.id
}

output "master_secret_arn" {
  description = "ARN do segredo com as credenciais do administrador no Secrets Manager"
  value       = aws_secretsmanager_secret.database.arn
}

output "master_username" {
  description = "Usuário administrador"
  value       = aws_db_instance.this.username
  sensitive   = true
}

# A senha NÃO é exposta como output, nem mesmo marcada como sensitive: um
# output sensível ainda fica em texto claro no arquivo de estado e é legível
# com `terraform output -json`. Quem precisa dela lê o Secrets Manager.
