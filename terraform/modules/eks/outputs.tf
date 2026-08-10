output "cluster_name" {
  description = "Nome do cluster"
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "Endpoint da API do Kubernetes"
  value       = aws_eks_cluster.this.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Certificado da autoridade do cluster, em base64"
  value       = aws_eks_cluster.this.certificate_authority[0].data
  # Não é segredo (é um certificado público), mas marcar como sensitive evita
  # poluir a saída do `terraform apply` com um blob enorme.
  sensitive = true
}

output "cluster_security_group_id" {
  description = "Security group gerenciado pelo cluster. Usado pelo módulo de banco para liberar acesso apenas ao cluster."
  value       = aws_eks_cluster.this.vpc_config[0].cluster_security_group_id
}

output "cluster_oidc_issuer_url" {
  description = "URL do emissor OIDC, base para IRSA (IAM Roles for Service Accounts)"
  value       = aws_eks_cluster.this.identity[0].oidc[0].issuer
}

output "node_role_arn" {
  description = "ARN do papel IAM dos nós"
  value       = aws_iam_role.node.arn
}

output "kubeconfig_command" {
  description = "Comando para configurar o kubectl localmente"
  value       = "aws eks update-kubeconfig --region ${data.aws_region.current.name} --name ${aws_eks_cluster.this.name}"
}

data "aws_region" "current" {}
