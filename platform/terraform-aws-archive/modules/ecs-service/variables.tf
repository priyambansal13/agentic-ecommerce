variable "name" {
  description = "Microservice / zone name; also the ECS service name and the Service Connect DNS name (e.g. catalog, storefront)"
  type        = string
}

variable "cluster_name" {
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "service_connect_namespace_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "image" {
  description = "Full image reference, e.g. <acct>.dkr.ecr.ap-south-1.amazonaws.com/agentic-commerce-dev/web:<git-sha>"
  type        = string
}

variable "container_port" {
  description = "Service port: Service Connect, ALB target and health check"
  type        = number
}

variable "health_check_command" {
  description = "Override the container health check command (default: wget health_check_path)"
  type        = list(string)
  default     = null
}

variable "sidecars" {
  description = "Extra essential containers in the task (e.g. OPA next to the agents service)"
  type = list(object({
    name        = string
    image       = string
    command     = optional(list(string))
    environment = optional(map(string), {})
  }))
  default = []
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "cpu_architecture" {
  type    = string
  default = "ARM64"
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "min_count" {
  type    = number
  default = 1
}

variable "max_count" {
  type    = number
  default = 2
}

variable "cpu_target_percent" {
  type    = number
  default = 60
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  description = "ENV_NAME => Secrets Manager secret ARN (optionally ARN:json-key::) - only this service's own secrets"
  type        = map(string)
  default     = {}
}

variable "attach_task_policy" {
  description = "Attach task_policy_json to the task role (static flag so count is known at plan time)"
  type        = bool
  default     = true
}

variable "task_policy_json" {
  description = "IAM policy for the task role (what the app code may call)"
  type        = string
  default     = null
}

variable "health_check_path" {
  type    = string
  default = "/health"
}

variable "health_check_matcher" {
  description = "ALB target group success codes"
  type        = string
  default     = "200-399"
}

variable "listener_arn" {
  type    = string
  default = null
}

variable "path_patterns" {
  description = "ALB path patterns routed to this service; empty = internal only"
  type        = list(string)
  default     = []
}

variable "listener_priority" {
  type    = number
  default = 100
}

variable "enable_execute_command" {
  type    = bool
  default = true
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
