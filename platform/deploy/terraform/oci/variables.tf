variable "tenancy_ocid" {
  description = "Tenancy OCID (OCI console → Tenancy details). Used for availability domains and image lookup."
  type        = string
}
variable "compartment_ocid" {
  description = "Compartment to create resources in (the tenancy OCID works for the root compartment)."
  type        = string
}
variable "region" {
  description = "Home region of the Always Free tenancy, e.g. ap-mumbai-1."
  type        = string
}
variable "oci_profile" {
  description = "Profile name in ~/.oci/config."
  type        = string
  default     = "DEFAULT"
}
variable "name" {
  type    = string
  default = "agentic-commerce"
}
variable "ocpus" {
  description = "Always Free Ampere allowance is 4 OCPU / 24 GB per tenancy in total — the swarm-ai VM already uses 2 / 12."
  type        = number
  default     = 2
}
variable "memory_gb" {
  type    = number
  default = 12
}
variable "boot_volume_gb" {
  description = "Always Free includes 200 GB of block storage in total."
  type        = number
  default     = 100
}
variable "availability_domain_index" {
  description = "A1 capacity is often exhausted in one AD (\"Out of host capacity\") — try 1 or 2."
  type        = number
  default     = 0
}
variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}
variable "ssh_cidr" {
  description = "Who may SSH to the VM."
  type        = string
  default     = "0.0.0.0/0"
}
variable "admin_cidr" {
  description = "Who may reach the k3s API (6443) — your IP, e.g. 203.0.113.7/32. Never 0.0.0.0/0."
  type        = string
}
variable "domain" {
  description = "Public hostname for the site (DNS A record → the VM IP), e.g. shop.example.com or name.duckdns.org."
  type        = string
}
variable "acme_email" {
  description = "Email for Let's Encrypt certificates."
  type        = string
}
variable "k3s_version" {
  type    = string
  default = "v1.34.12+k3s1"
}
variable "cert_manager_version" {
  type    = string
  default = "v1.21.2"
}
