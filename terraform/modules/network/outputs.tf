output "vpc_id" {
  description = "Identificador da VPC"
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "Bloco CIDR da VPC"
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Sub-redes públicas, para balanceadores externos"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Sub-redes privadas, para nós do EKS e RDS"
  value       = aws_subnet.private[*].id
}

output "nat_gateway_enabled" {
  description = "Indica se há NAT Gateway. Quando false, as sub-redes privadas não alcançam a internet."
  value       = var.enable_nat_gateway
}
