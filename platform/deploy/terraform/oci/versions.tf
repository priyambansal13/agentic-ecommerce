terraform {
  required_version = ">= 1.6"
  required_providers {
    oci = { source = "oracle/oci", version = "~> 9.11" }
  }
  # State: local by default (single operator). For a team, use an OCI Object Storage bucket via the S3-compatible
  # backend — see ../../README.md.
}

# Credentials come from ~/.oci/config (create an API key in the OCI console → "Add API key" → copy the config
# snippet), never from this repo.
provider "oci" {
  region              = var.region
  config_file_profile = var.oci_profile
}
