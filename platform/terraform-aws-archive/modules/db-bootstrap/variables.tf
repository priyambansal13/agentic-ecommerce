variable "name" {
  description = "Prefix, e.g. agentic-commerce-dev-shared"
  type        = string
}

variable "db_host" {
  description = "Aurora writer endpoint"
  type        = string
}

variable "master_username" {
  type = string
}

variable "master_secret_arn" {
  description = "RDS-managed master secret (JSON key password)"
  type        = string
}

variable "databases" {
  description = "Per-service databases on this cluster: database = suffix (ac_<database>, role svc_<database>), secret_arn = that service's database secret (JSON with key password)"
  type = list(object({
    service    = string
    database   = string
    secret_arn = string
  }))
}

variable "image" {
  description = "Image with psql (ARM64)"
  type        = string
  default     = "public.ecr.aws/docker/library/postgres:17-alpine"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
