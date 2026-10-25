output "redis_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "opensearch_endpoint" {
  value = aws_opensearch_domain.this.endpoint
}

output "opensearch_arn" {
  value = aws_opensearch_domain.this.arn
}

output "msk_cluster_arn" {
  value = aws_msk_serverless_cluster.this.arn
}

output "msk_cluster_name" {
  value = aws_msk_serverless_cluster.this.cluster_name
}

output "msk_bootstrap_brokers_iam" {
  value = data.aws_msk_bootstrap_brokers.this.bootstrap_brokers_sasl_iam
}

output "opensearch_domain_name" {
  value = aws_opensearch_domain.this.domain_name
}
