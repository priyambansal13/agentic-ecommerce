# Partial S3 backend config — supply the bucket at init time (created by ../../bootstrap):
#   terraform init -backend-config="bucket=agentic-commerce-tfstate-<account-id>" -backend-config="region=ap-south-1"
# or via the platform CLI:  ac tf prod init   (= node platform/scripts/ac.mjs tf prod init; bucket from TF_STATE_BUCKET)
# For local validation only:  terraform init -backend=false
terraform {
  backend "s3" {
    key          = "agentic-commerce/prod/terraform.tfstate"
    encrypt      = true
    use_lockfile = true # S3 native locking (Terraform >= 1.10), no DynamoDB
  }
}
