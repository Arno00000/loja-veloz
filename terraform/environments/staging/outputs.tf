output "cluster_name" {
  description = "Nome do cluster EKS"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Endpoint da API do Kubernetes"
  value       = module.eks.cluster_endpoint
}

output "kubeconfig_command" {
  description = "Comando para configurar o kubectl"
  value       = module.eks.kubeconfig_command
}

output "vpc_id" {
  description = "Identificador da VPC"
  value       = module.network.vpc_id
}

output "database_endpoint" {
  description = "Endpoint do RDS"
  value       = module.database.endpoint
}

output "database_secret_arn" {
  description = "ARN do segredo com as credenciais do banco no Secrets Manager"
  value       = module.database.master_secret_arn
}

output "proximos_passos" {
  description = "O que fazer depois do apply"
  value       = <<-EOT

    1. Configurar o kubectl:
       ${module.eks.kubeconfig_command}

    2. Ler a senha do banco no Secrets Manager:
       aws secretsmanager get-secret-value \
         --secret-id ${module.database.master_secret_arn} \
         --query SecretString --output text

    3. Criar os tres bancos e usuarios (Job dentro do cluster):
       ver terraform/README.md, secao "Depois do apply"

    4. Instalar Metrics Server, Ingress Controller e observabilidade:
       ver kubernetes/README.md

    5. Criar o Secret da aplicacao:
       kubectl create secret generic app-secrets -n loja-veloz --from-literal=...

    6. Executar o workflow "Deploy staging" no GitHub Actions.
  EOT
}
