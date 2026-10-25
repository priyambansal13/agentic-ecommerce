variable "name_prefix" {
  description = "Path prefix, e.g. ac/dev"
  type        = string
}

variable "secrets" {
  description = "key => '<owner>/<NAME>' (owner = service or zone name)"
  type        = map(string)
}

variable "managed_keys" {
  description = "Keys of var.secrets whose value Terraform writes (non-sensitive list so it can drive for_each)"
  type        = set(string)
  default     = []
}

variable "managed_values" {
  description = "key => secret string for managed_keys"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "recovery_window_in_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
