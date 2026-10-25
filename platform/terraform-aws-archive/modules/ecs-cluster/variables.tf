variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "repositories" {
  description = "Image names (one per microservice / zone); repositories are <repository_prefix>/<name>"
  type        = list(string)
}

variable "repository_prefix" {
  type    = string
  default = "ac"
}

variable "manage_repositories" {
  description = "Create the ECR repositories in this environment (true in exactly one env per AWS account); false = look them up"
  type        = bool
  default     = true
}

variable "certificate_arn" {
  description = "ACM certificate for HTTPS. null = HTTP only (early dev)."
  type        = string
  default     = null
}

variable "enable_waf" {
  type    = bool
  default = false
}

variable "waf_rate_limit_per_5min" {
  type    = number
  default = 2000
}

variable "use_spot" {
  description = "Default capacity provider FARGATE_SPOT (dev cost saving)"
  type        = bool
  default     = false
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "force_delete_repositories" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
