variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS on the ALB (null = HTTP only)"
  type        = string
  default     = null
}

variable "public_app_url" {
  description = "Public origin served by the shell zone"
  type        = string
  default     = "http://localhost:3300"
}

variable "oidc_issuers" {
  description = "Keycloak realm issuers trusted by services, e.g. [https://auth.example.com/realms/customers, .../realms/staff]"
  type        = list(string)
  default     = []
}

variable "cors_origins" {
  type    = list(string)
  default = ["http://localhost:3300"]
}

variable "manage_ecr_repositories" {
  description = "Create the account-wide ac/<name> ECR repositories in this env (exactly one env per AWS account)"
  type        = bool
  default     = false
}

variable "dedicated_db_services" {
  description = "Services whose database gets its own Aurora cluster"
  type        = list(string)
  default     = ["payment"]
}

variable "scale_to_zero_noncritical" {
  description = "Start non-critical services/zones (notification, admin, seller-analytics, seller, admin-web) at 0 tasks"
  type        = bool
  default     = false
}

variable "default_image_tag" {
  description = "CI passes the git SHA: -var default_image_tag=$GITHUB_SHA"
  type        = string
  default     = "latest"
}

variable "image_tags" {
  description = "Per service/zone image tag — services release independently, e.g. { catalog = \"1a2b3c4\" }"
  type        = map(string)
  default     = {}
}
