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

output "cluster_oidc_issuer_url" {
  description = "Emissor OIDC, base para IRSA (IAM Roles for Service Accounts)"
  value       = module.eks.cluster_oidc_issuer_url
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

output "aviso_custo" {
  description = "Itens de custo relevantes deste ambiente"
  value       = <<-EOT

    Este ambiente provisiona recursos COBRADOS. Os itens de maior impacto:

      - EKS control plane: cobrado por hora, independentemente de uso
      - 3 nos ON_DEMAND m6i.large: cobrados por hora
      - RDS db.m6g.large Multi-AZ: aproximadamente o dobro de uma instancia
        simples, porque provisiona duas
      - 3 NAT Gateways: cobrados por hora MAIS por GB processado
      - Network Load Balancer criado pelo Ingress Controller
      - CloudWatch Logs do control plane e do RDS

    Consulte a calculadora oficial da AWS antes de aplicar. Este projeto NAO
    afirma valores: precos variam por regiao e por conta.

    Para destruir:  terraform destroy
    Atencao: deletion_protection = true impede a exclusao do RDS ate ser
    desligado explicitamente.
  EOT
}
