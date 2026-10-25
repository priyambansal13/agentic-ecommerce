variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "app_security_group_id" {
  description = "Security group attached to all ECS tasks; the only allowed client of the data stores"
  type        = string
}

variable "deletion_protection" {
  type    = bool
  default = false
}

# Cache ----------------------------------------------------------------
variable "cache_engine" {
  type    = string
  default = "valkey"
}

variable "cache_engine_version" {
  type    = string
  default = "8.0"
}

variable "cache_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "cache_node_count" {
  type    = number
  default = 1
}

# OpenSearch -----------------------------------------------------------
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

variable "tags" {
  type    = map(string)
  default = {}
}
