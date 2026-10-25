locals {
  buckets = {
    images        = { object_lock = false, expire_days = 0 }
    evidence      = { object_lock = false, expire_days = var.evidence_retention_days }
    audit         = { object_lock = true, expire_days = 0 }
    kafka-archive = { object_lock = false, expire_days = var.kafka_archive_retention_days }
    # OPA bundle for the agents service sidecar (built by platform CI: opa build policies -> bundles/agents.tar.gz)
    policies = { object_lock = false, expire_days = 0 }
  }
}

resource "aws_s3_bucket" "this" {
  for_each            = local.buckets
  bucket              = "${var.name_prefix}-${each.key}"
  object_lock_enabled = each.value.object_lock
  force_destroy       = var.force_destroy && !each.value.object_lock
  tags                = merge(var.tags, { Purpose = each.key })
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Audit trail (agent tool calls, refund decisions) is tamper-evident: WORM, compliance mode.
resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.this["audit"].id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.audit_retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_lifecycle_configuration" "expiring" {
  for_each = { for k, v in local.buckets : k => v if v.expire_days > 0 }
  bucket   = aws_s3_bucket.this[each.key].id

  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = each.value.expire_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# Browser uploads of product images / evidence go through presigned POSTs.
resource "aws_s3_bucket_cors_configuration" "uploads" {
  for_each = toset(["images", "evidence"])
  bucket   = aws_s3_bucket.this[each.key].id
  cors_rule {
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = var.cors_origins
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}
