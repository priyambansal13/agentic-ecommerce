variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "az_count" {
  type    = number
  default = 3
}

variable "single_nat_gateway" {
  description = "true for dev (cheaper), false for prod (one NAT per AZ)"
  type        = bool
  default     = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
