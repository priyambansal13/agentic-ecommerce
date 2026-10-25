output "endpoint" {
  value = aws_rds_cluster.this.endpoint
}

output "reader_endpoint" {
  value = aws_rds_cluster.this.reader_endpoint
}

output "master_username" {
  value = aws_rds_cluster.this.master_username
}

output "master_secret_arn" {
  description = "RDS-managed secret (JSON with username/password)"
  value       = aws_rds_cluster.this.master_user_secret[0].secret_arn
}

output "cluster_identifier" {
  value = aws_rds_cluster.this.cluster_identifier
}
