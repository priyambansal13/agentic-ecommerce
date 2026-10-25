output "alb_dns_name" {
  value = module.cluster.alb_dns_name
}

output "ecr_repository_urls" {
  description = "ac/<name> per microservice, zone and edge"
  value       = module.cluster.repository_urls
}

output "ecs_cluster_name" {
  value = module.cluster.cluster_name
}

output "ecs_services" {
  description = "ECS service names (service/zone/edge) — one deployable each"
  value = merge(
    { for k, m in module.service : k => m.service_name },
    { for k, m in module.zone : k => m.service_name },
    { edge = module.edge.service_name },
  )
}

output "service_connect_urls" {
  description = "Internal URLs; must match `ac kong --cloud` upstreams and the shell's ZONE_*_URL"
  value       = local.service_connect_urls
}

output "postgres_endpoints" {
  description = "Writer endpoint per cluster (shared + dedicated)"
  value = merge(
    { shared = module.aurora_shared.endpoint },
    { for k, m in module.aurora_dedicated : k => m.endpoint },
  )
}

output "postgres_master_secret_arns" {
  value = merge(
    { shared = module.aurora_shared.master_secret_arn },
    { for k, m in module.aurora_dedicated : k => m.master_secret_arn },
  )
}

output "database_placement" {
  description = "service => cluster hosting its ac_<db> database"
  value       = local.cluster_of
}

output "db_bootstrap_run_commands" {
  description = "Run after apply (and after adding a service) to create roles/databases"
  value = {
    for k, m in module.db_bootstrap : k => join(" ", [
      "aws ecs run-task --cluster ${module.cluster.cluster_name}",
      "--task-definition ${m.task_definition_family} --launch-type FARGATE",
      "--network-configuration 'awsvpcConfiguration={subnets=[${module.network.private_subnet_ids[0]}],securityGroups=[${module.cluster.app_security_group_id}],assignPublicIp=DISABLED}'",
    ])
  }
}

output "redis_endpoint" {
  value = module.data.redis_endpoint
}

output "opensearch_endpoint" {
  value = module.data.opensearch_endpoint
}

output "msk_bootstrap_brokers_iam" {
  value = module.data.msk_bootstrap_brokers_iam
}

output "buckets" {
  value = module.storage.bucket_names
}

output "secrets_to_set" {
  description = "Third-party secrets to fill in (database-url secrets are generated): aws secretsmanager put-secret-value --secret-id <name> --secret-string <value>"
  value       = { for k, n in module.secrets.secret_names : k => n if !endswith(k, "/database-url") }
}

output "task_role_arns" {
  value = { for k, s in module.service : k => s.task_role_arn }
}
