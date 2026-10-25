output "alb_dns_name" {
  value = module.platform.alb_dns_name
}

output "ecr_repository_urls" {
  value = module.platform.ecr_repository_urls
}

output "ecs_cluster_name" {
  value = module.platform.ecs_cluster_name
}

output "ecs_services" {
  value = module.platform.ecs_services
}

output "service_connect_urls" {
  value = module.platform.service_connect_urls
}

output "postgres_endpoints" {
  value = module.platform.postgres_endpoints
}

output "postgres_master_secret_arns" {
  value = module.platform.postgres_master_secret_arns
}

output "database_placement" {
  value = module.platform.database_placement
}

output "db_bootstrap_run_commands" {
  value = module.platform.db_bootstrap_run_commands
}

output "redis_endpoint" {
  value = module.platform.redis_endpoint
}

output "opensearch_endpoint" {
  value = module.platform.opensearch_endpoint
}

output "msk_bootstrap_brokers_iam" {
  value = module.platform.msk_bootstrap_brokers_iam
}

output "buckets" {
  value = module.platform.buckets
}

output "secrets_to_set" {
  value = module.platform.secrets_to_set
}
