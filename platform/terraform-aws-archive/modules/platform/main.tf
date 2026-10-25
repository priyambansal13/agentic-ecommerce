# Whole platform for one environment: one ECS service per microservice (catalog.tf → var.services),
# one per micro-frontend zone (var.zones), Kong at the edge, and a database per service.
# envs/dev and envs/prod differ only in sizing / isolation inputs.

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    random = {
      source = "hashicorp/random"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name       = "${var.project}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
  tags       = merge(var.tags, { Project = var.project, Environment = var.environment, ManagedBy = "terraform" })

  # ── databases: one logical database per service; listed services get a dedicated cluster
  db_services = { for k, s in var.services : k => s if s.database != null }
  dedicated   = toset([for k in var.dedicated_db_services : k if contains(keys(local.db_services), k)])
  cluster_of  = { for k in keys(local.db_services) : k => contains(local.dedicated, k) ? k : "shared" }
  db_host = {
    for k in keys(local.db_services) : k => (
      contains(local.dedicated, k) ? module.aurora_dedicated[k].endpoint : module.aurora_shared.endpoint
    )
  }

  # ── secrets: ac/<env>/<owner>/<NAME>; every service/zone can read ONLY its own
  secret_paths = merge(
    { for k in keys(local.db_services) : "${k}/database-url" => "${k}/database-url" },
    merge([for k, s in var.services : { for n in s.secrets : "${k}/${n}" => "${k}/${n}" }]...),
    merge([for k, z in var.zones : { for n in z.secrets : "${k}/${n}" => "${k}/${n}" }]...),
  )
  db_secret_values = {
    for k, s in local.db_services : "${k}/database-url" => jsonencode({
      url      = "postgresql://svc_${s.database}:${random_password.db[k].result}@${local.db_host[k]}:5432/ac_${s.database}?sslmode=require"
      username = "svc_${s.database}"
      password = random_password.db[k].result
      dbname   = "ac_${s.database}"
      host     = local.db_host[k]
      port     = 5432
    })
  }

  # ── images
  image_names = concat(keys(var.services), keys(var.zones), ["edge"])
  # ECR repository per deployable: services ac/<service>, zones ac/zone-<zone> (as built by `ac docker build`), edge ac/edge
  repo_name = merge({ for k in keys(var.services) : k => k }, { for k in keys(var.zones) : k => "zone-${trimsuffix(k, "-web")}" }, { edge = "edge" })
  image     = { for n in local.image_names : n => "${module.cluster.repository_urls[local.repo_name[n]]}:${lookup(var.image_tags, n, var.default_image_tag)}" }

  # ── scaling
  min_tasks = {
    for n, c in merge(
      { for k, s in var.services : k => s.critical },
      { for k, z in var.zones : k => z.critical },
      { edge = true },
    ) : n => (var.scale_to_zero_noncritical && !c ? 0 : var.min_tasks)
  }

  bucket_env = { for k, v in module.storage.bucket_names : "S3_BUCKET_${upper(replace(k, "-", "_"))}" => v }

  common_service_env = {
    NODE_ENV                = "production"
    APP_ENV                 = var.environment
    AWS_REGION              = local.region
    REDIS_URL               = "rediss://${module.data.redis_endpoint}:6379"
    KAFKA_BROKERS           = module.data.msk_bootstrap_brokers_iam
    KAFKA_SASL_MECHANISM    = "aws-msk-iam"
    OIDC_ISSUERS            = join(",", var.oidc_issuers)
    OTEL_TRACES_SAMPLER     = "parentbased_traceidratio"
    OTEL_TRACES_SAMPLER_ARG = var.environment == "prod" ? "0.1" : "1"
  }

  # the shell reads ZONE_<ZONE>_URL (zone name from frontend/zones.json, e.g. ZONE_ADMIN_URL → Service Connect admin-web)
  zone_urls = { for k, z in var.zones : "ZONE_${upper(replace(trimsuffix(k, "-web"), "-", "_"))}_URL" => "http://${k}:${z.port}" if k != "shell" }

  service_connect_urls = merge(
    { for k, s in var.services : k => "http://${k}:${s.port}" },
    { for k, z in var.zones : k => "http://${k}:${z.port}" },
    { edge = "http://edge:${var.edge.port}" },
  )
}

module "network" {
  source             = "../network"
  name               = local.name
  region             = local.region
  cidr               = var.vpc_cidr
  az_count           = var.az_count
  single_nat_gateway = var.single_nat_gateway
  tags               = local.tags
}

module "storage" {
  source               = "../storage"
  name_prefix          = "${local.name}-${local.account_id}"
  cors_origins         = var.cors_origins
  audit_retention_days = var.audit_retention_days
  force_destroy        = !var.deletion_protection
  tags                 = local.tags
}

module "cluster" {
  source                    = "../ecs-cluster"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  public_subnet_ids         = module.network.public_subnet_ids
  repositories              = values(local.repo_name)
  repository_prefix         = "ac"
  manage_repositories       = var.manage_ecr_repositories
  certificate_arn           = var.certificate_arn
  enable_waf                = var.enable_waf
  use_spot                  = var.use_fargate_spot
  deletion_protection       = var.deletion_protection
  force_delete_repositories = !var.deletion_protection
  tags                      = local.tags
}

module "data" {
  source                    = "../data"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  private_subnet_ids        = module.network.private_subnet_ids
  app_security_group_id     = module.cluster.app_security_group_id
  deletion_protection       = var.deletion_protection
  cache_node_type           = var.cache_node_type
  cache_node_count          = var.cache_node_count
  opensearch_engine_version = var.opensearch_engine_version
  opensearch_instance_type  = var.opensearch_instance_type
  opensearch_instance_count = var.opensearch_instance_count
  opensearch_volume_gb      = var.opensearch_volume_gb
  tags                      = local.tags
}

# ---------------------------------------------------------------- databases
module "aurora_shared" {
  source                 = "../aurora"
  name                   = "${local.name}-shared"
  vpc_id                 = module.network.vpc_id
  database_subnet_ids    = module.network.database_subnet_ids
  app_security_group_id  = module.cluster.app_security_group_id
  engine_version         = var.aurora_engine_version
  parameter_group_family = var.aurora_parameter_group_family
  min_acu                = var.aurora_min_acu
  max_acu                = var.aurora_max_acu
  instance_count         = var.aurora_instance_count
  backup_retention_days  = var.db_backup_retention_days
  deletion_protection    = var.deletion_protection
  tags                   = local.tags
}

module "aurora_dedicated" {
  source   = "../aurora"
  for_each = local.dedicated

  name                   = "${local.name}-${each.key}"
  vpc_id                 = module.network.vpc_id
  database_subnet_ids    = module.network.database_subnet_ids
  app_security_group_id  = module.cluster.app_security_group_id
  engine_version         = var.aurora_engine_version
  parameter_group_family = var.aurora_parameter_group_family
  min_acu                = var.aurora_min_acu
  max_acu                = var.dedicated_aurora_max_acu
  instance_count         = var.aurora_instance_count
  backup_retention_days  = var.db_backup_retention_days
  deletion_protection    = var.deletion_protection
  tags                   = merge(local.tags, { Service = each.key })
}

resource "random_password" "db" {
  for_each = local.db_services
  length   = 32
  special  = false
}

module "secrets" {
  source                  = "../secrets"
  name_prefix             = "ac/${var.environment}"
  secrets                 = local.secret_paths
  managed_keys            = toset(keys(local.db_secret_values))
  managed_values          = local.db_secret_values
  recovery_window_in_days = var.deletion_protection ? 30 : 0
  tags                    = local.tags
}

module "db_bootstrap" {
  source   = "../db-bootstrap"
  for_each = toset(concat(["shared"], tolist(local.dedicated)))

  name              = "${local.name}-${each.key}"
  db_host           = each.key == "shared" ? module.aurora_shared.endpoint : module.aurora_dedicated[each.key].endpoint
  master_username   = each.key == "shared" ? module.aurora_shared.master_username : module.aurora_dedicated[each.key].master_username
  master_secret_arn = each.key == "shared" ? module.aurora_shared.master_secret_arn : module.aurora_dedicated[each.key].master_secret_arn
  databases = [
    for k, s in local.db_services : {
      service    = k
      database   = s.database
      secret_arn = module.secrets.secret_arns["${k}/database-url"]
    } if local.cluster_of[k] == each.key
  ]
  log_retention_days = var.log_retention_days
  tags               = local.tags

  depends_on = [module.secrets]
}

# ---------------------------------------------------------------- backend microservices
module "service" {
  source   = "../ecs-service"
  for_each = var.services

  name                          = each.key
  cluster_name                  = module.cluster.cluster_name
  cluster_arn                   = module.cluster.cluster_arn
  service_connect_namespace_arn = module.cluster.service_connect_namespace_arn
  vpc_id                        = module.network.vpc_id
  subnet_ids                    = module.network.private_subnet_ids
  security_group_ids            = [module.cluster.app_security_group_id]

  image          = local.image[each.key]
  container_port = each.value.port
  cpu            = lookup(var.cpu_overrides, each.key, each.value.cpu)
  memory         = lookup(var.memory_overrides, each.key, each.value.memory)
  desired_count  = local.min_tasks[each.key]
  min_count      = local.min_tasks[each.key]
  max_count      = lookup(var.max_tasks_overrides, each.key, var.max_tasks)

  environment = merge(
    local.common_service_env,
    { SERVICE_NAME = each.key, PORT = tostring(each.value.port), OTEL_SERVICE_NAME = each.key },
    each.value.opensearch == null ? {} : { OPENSEARCH_URL = "https://${module.data.opensearch_endpoint}" },
    { for b in distinct(concat(each.value.s3_read, each.value.s3_write, each.value.s3_put)) :
    "S3_BUCKET_${upper(replace(b, "-", "_"))}" => module.storage.bucket_names[b] },
    each.value.env,
  )
  secrets = merge(
    each.value.database == null ? {} : { DATABASE_URL = "${module.secrets.secret_arns["${each.key}/database-url"]}:url::" },
    { for n in each.value.secrets : n => module.secrets.secret_arns["${each.key}/${n}"] },
  )

  # agents: OPA sidecar pulls the policy bundle (platform CI: opa build policies → s3://<policies>/bundles/agents.tar.gz)
  sidecars = each.key == "agents" ? [{
    name  = "opa"
    image = var.opa_image
    command = [
      "run", "--server", "--addr=127.0.0.1:8181", "--log-level=info",
      "--set=services.s3.url=https://${module.storage.bucket_names["policies"]}.s3.${local.region}.amazonaws.com",
      "--set=services.s3.credentials.s3_signing.metadata_credentials.aws_region=${local.region}",
      "--set=bundles.agents.service=s3",
      "--set=bundles.agents.resource=bundles/agents.tar.gz",
      "--set=bundles.agents.polling.min_delay_seconds=30",
      "--set=bundles.agents.polling.max_delay_seconds=60",
    ]
  }] : []

  task_policy_json = data.aws_iam_policy_document.service[each.key].json

  log_retention_days = var.log_retention_days
  tags               = merge(local.tags, { Service = each.key, Kind = "microservice" })
}

# ---------------------------------------------------------------- micro-frontend zones
module "zone" {
  source   = "../ecs-service"
  for_each = var.zones

  name                          = each.key
  cluster_name                  = module.cluster.cluster_name
  cluster_arn                   = module.cluster.cluster_arn
  service_connect_namespace_arn = module.cluster.service_connect_namespace_arn
  vpc_id                        = module.network.vpc_id
  subnet_ids                    = module.network.private_subnet_ids
  security_group_ids            = [module.cluster.app_security_group_id]

  image             = local.image[each.key]
  container_port    = each.value.port
  health_check_path = "${each.value.base_path}/api/health"
  cpu               = lookup(var.cpu_overrides, each.key, each.value.cpu)
  memory            = lookup(var.memory_overrides, each.key, each.value.memory)
  desired_count     = local.min_tasks[each.key]
  min_count         = local.min_tasks[each.key]
  max_count         = lookup(var.max_tasks_overrides, each.key, var.max_tasks)

  environment = merge(
    {
      NODE_ENV            = "production"
      PORT                = tostring(each.value.port)
      HOSTNAME            = "0.0.0.0"
      ZONE_NAME           = each.key
      BASE_PATH           = each.value.base_path
      NEXT_PUBLIC_APP_URL = var.public_app_url
      AUTH_URL            = var.public_app_url
      KONG_URL            = local.service_connect_urls["edge"]
      OIDC_ISSUERS        = join(",", var.oidc_issuers)
    },
    each.key == "shell" ? local.zone_urls : {},
    each.value.env,
  )
  secrets = { for n in each.value.secrets : n => module.secrets.secret_arns["${each.key}/${n}"] }

  # only the shell is public; it rewrites /shop, /account, /seller, /admin to the zones internally
  listener_arn      = each.key == "shell" ? module.cluster.listener_arn : null
  path_patterns     = each.key == "shell" ? ["/*"] : []
  listener_priority = 900

  task_policy_json = data.aws_iam_policy_document.minimal.json

  log_retention_days = var.log_retention_days
  tags               = merge(local.tags, { Service = each.key, Kind = "micro-frontend" })
}

# ---------------------------------------------------------------- edge (Kong)
module "edge" {
  source = "../ecs-service"

  name                          = "edge"
  cluster_name                  = module.cluster.cluster_name
  cluster_arn                   = module.cluster.cluster_arn
  service_connect_namespace_arn = module.cluster.service_connect_namespace_arn
  vpc_id                        = module.network.vpc_id
  subnet_ids                    = module.network.private_subnet_ids
  security_group_ids            = [module.cluster.app_security_group_id]

  image                = local.image["edge"]
  container_port       = var.edge.port
  health_check_command = ["CMD", "kong", "health"]
  health_check_path    = "/" # ALB target health on the proxy port: Kong answers 404 "no route" when alive
  health_check_matcher = "200-404"
  cpu                  = var.edge.cpu
  memory               = var.edge.memory
  desired_count        = local.min_tasks["edge"]
  min_count            = local.min_tasks["edge"]
  max_count            = lookup(var.max_tasks_overrides, "edge", var.max_tasks)

  environment = {
    KONG_DATABASE           = "off"
    KONG_DECLARATIVE_CONFIG = "/kong/kong.yml"
    KONG_PROXY_LISTEN       = "0.0.0.0:${var.edge.port}"
    KONG_ADMIN_LISTEN       = "127.0.0.1:8001"
    KONG_PROXY_ACCESS_LOG   = "/dev/stdout"
    KONG_PROXY_ERROR_LOG    = "/dev/stderr"
  }

  listener_arn      = module.cluster.listener_arn
  path_patterns     = ["/api/*"]
  listener_priority = 100

  task_policy_json = data.aws_iam_policy_document.minimal.json

  log_retention_days = var.log_retention_days
  tags               = merge(local.tags, { Service = "edge", Kind = "gateway" })
}

# OpenSearch is only reachable (SigV4) by the services that declare `opensearch` in the catalog.
resource "aws_opensearch_domain_policy" "this" {
  domain_name = module.data.opensearch_domain_name
  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = [for k, s in var.services : module.service[k].task_role_arn if s.opensearch != null] }
      Action    = ["es:ESHttp*"]
      Resource  = "${module.data.opensearch_arn}/*"
    }]
  })
}
