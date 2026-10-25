variable "project" {
  type    = string
  default = "agentic-commerce"
}

variable "environment" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

# network --------------------------------------------------------------
variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "az_count" {
  type    = number
  default = 3
}

variable "single_nat_gateway" {
  type    = bool
  default = true
}

# edge / identity ------------------------------------------------------
variable "certificate_arn" {
  description = "ACM cert for the ALB; null = HTTP only"
  type        = string
  default     = null
}

variable "enable_waf" {
  type    = bool
  default = false
}

variable "cors_origins" {
  type    = list(string)
  default = ["http://localhost:3300"]
}

variable "public_app_url" {
  description = "Public origin of the shell (e.g. https://www.example.com); zones and Auth.js use it"
  type        = string
  default     = "http://localhost:3300"
}

variable "oidc_issuers" {
  description = "Trusted Keycloak realm issuers (customers + staff)"
  type        = list(string)
  default     = []
}

# images ---------------------------------------------------------------
variable "manage_ecr_repositories" {
  description = "Create the account-wide ac/<name> ECR repositories here (exactly one env per AWS account)"
  type        = bool
  default     = true
}

variable "default_image_tag" {
  description = "Image tag for services/zones without an entry in image_tags (CI passes the git SHA)"
  type        = string
  default     = "latest"
}

variable "image_tags" {
  description = "Per service/zone tag, e.g. { catalog = \"1a2b3c\" } — services release independently"
  type        = map(string)
  default     = {}
}

variable "opa_image" {
  type    = string
  default = "openpolicyagent/opa:1.21.3-static"
}

# compute --------------------------------------------------------------
variable "use_fargate_spot" {
  type    = bool
  default = false
}

variable "min_tasks" {
  type    = number
  default = 1
}

variable "max_tasks" {
  type    = number
  default = 2
}

variable "max_tasks_overrides" {
  type    = map(number)
  default = {}
}

variable "cpu_overrides" {
  type    = map(number)
  default = {}
}

variable "memory_overrides" {
  type    = map(number)
  default = {}
}

variable "scale_to_zero_noncritical" {
  description = "Start services/zones marked critical = false at 0 tasks (dev cost saving; scale up when needed)"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# data -----------------------------------------------------------------
variable "deletion_protection" {
  type    = bool
  default = false
}

variable "dedicated_db_services" {
  description = "Services whose database gets its OWN Aurora cluster instead of the shared one (e.g. payment for PCI isolation)"
  type        = list(string)
  default     = []
}

variable "aurora_engine_version" {
  type    = string
  default = "17.5"
}

variable "aurora_parameter_group_family" {
  type    = string
  default = "aurora-postgresql17"
}

variable "aurora_min_acu" {
  type    = number
  default = 0.5
}

variable "aurora_max_acu" {
  type    = number
  default = 4
}

variable "aurora_instance_count" {
  type    = number
  default = 1
}

variable "dedicated_aurora_max_acu" {
  type    = number
  default = 4
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "cache_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "cache_node_count" {
  type    = number
  default = 1
}

variable "opensearch_engine_version" {
  type    = string
  default = "OpenSearch_3.1"
}

variable "opensearch_instance_type" {
  type    = string
  default = "t3.medium.search"
}

variable "opensearch_instance_count" {
  type    = number
  default = 1
}

variable "opensearch_volume_gb" {
  type    = number
  default = 20
}

variable "audit_retention_days" {
  type    = number
  default = 365
}
