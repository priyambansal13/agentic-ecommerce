# prod: Multi-AZ everywhere, NAT per AZ, WAF, deletion protection, long audit retention,
# payment database on its own Aurora cluster (PCI isolation), everything at >= 2 tasks.
module "platform" {
  source      = "../../modules/platform"
  environment = "prod"

  single_nat_gateway = false
  az_count           = 3
  certificate_arn    = var.certificate_arn
  enable_waf         = true
  cors_origins       = var.cors_origins
  public_app_url     = var.public_app_url
  oidc_issuers       = var.oidc_issuers

  manage_ecr_repositories   = var.manage_ecr_repositories
  default_image_tag         = var.default_image_tag
  image_tags                = var.image_tags
  use_fargate_spot          = false
  min_tasks                 = 2
  max_tasks                 = 6
  max_tasks_overrides       = { agents = 8, storefront = 8, search = 6, edge = 6, shell = 6 }
  scale_to_zero_noncritical = false

  deletion_protection       = true
  dedicated_db_services     = var.dedicated_db_services
  aurora_min_acu            = 1
  aurora_max_acu            = 16
  dedicated_aurora_max_acu  = 8
  aurora_instance_count     = 2
  db_backup_retention_days  = 14
  cache_node_type           = "cache.t4g.small"
  cache_node_count          = 2
  opensearch_instance_type  = "m7g.large.search"
  opensearch_instance_count = 2
  opensearch_volume_gb      = 50
  audit_retention_days      = 2555 # ~7 years for refund/finance audit trail
  log_retention_days        = 90

  tags = { CostCenter = "agentic-commerce-prod" }
}
