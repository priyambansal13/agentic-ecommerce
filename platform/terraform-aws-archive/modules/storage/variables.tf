variable "name_prefix" {
  description = "Bucket name prefix, must be globally unique-ish (e.g. agentic-commerce-dev-<account-id>)"
  type        = string
}

variable "cors_origins" {
  type    = list(string)
  default = ["http://localhost:3300"]
}

variable "audit_retention_days" {
  type    = number
  default = 365
}

variable "evidence_retention_days" {
  type    = number
  default = 730
}

variable "kafka_archive_retention_days" {
  type    = number
  default = 365
}

variable "force_destroy" {
  description = "Allow destroying non-empty buckets (dev only). Never applies to the object-locked audit bucket."
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
