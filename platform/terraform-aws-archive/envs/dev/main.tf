# dev: smallest sizes, Fargate Spot, single NAT, no deletion protection, all databases on one shared
# Aurora cluster, non-critical services/zones start at 0 tasks. Creates the account-wide ac/<name> ECR repos.
module "platform" {
  source      = "../../modules/platform"
  environment = "dev"

  single_nat_gateway = true
  az_count           = 3
  certificate_arn    = var.certificate_arn
  enable_waf         = false
  cors_origins       = var.cors_origins
  public_app_url     = var.public_app_url
  oidc_issuers       = var.oidc_issuers

  manage_ecr_repositories   = var.manage_ecr_repositories
  default_image_tag         = var.default_image_tag
  image_tags                = var.image_tags
  use_fargate_spot          = true
  min_tasks                 = 1
  max_tasks                 = 2
  scale_to_zero_noncritical = var.scale_to_zero_noncritical

  deletion_protection       = false
  dedicated_db_services     = var.dedicated_db_services
  aurora_min_acu            = 0.5
  aurora_max_acu            = 2
  aurora_instance_count     = 1
  db_backup_retention_days  = 1
  cache_node_type           = "cache.t4g.micro"
  cache_node_count          = 1
  opensearch_instance_type  = "t3.small.search"
  opensearch_instance_count = 1
  opensearch_volume_gb      = 10
  audit_retention_days      = 1
  log_retention_days        = 7

  tags = { CostCenter = "agentic-commerce-dev" }
}
