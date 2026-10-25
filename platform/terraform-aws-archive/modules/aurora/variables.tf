variable "name" {
  description = "Cluster name prefix, e.g. agentic-commerce-dev-shared or agentic-commerce-prod-payment"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "database_subnet_ids" {
  type = list(string)
}

variable "app_security_group_id" {
  type = string
}

variable "engine_version" {
  description = "Aurora PostgreSQL version (plan targets PG 18; use the newest Aurora supports in your region)"
  type        = string
  default     = "17.5"
}

variable "parameter_group_family" {
  type    = string
  default = "aurora-postgresql17"
}

variable "min_acu" {
  type    = number
  default = 0.5
}

variable "max_acu" {
  type    = number
  default = 4
}

variable "instance_count" {
  description = "1 writer (+ readers). >= 2 in prod for Multi-AZ failover."
  type        = number
  default     = 1
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
