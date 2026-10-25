# Task-role policies, generated per microservice from the catalog (catalog.tf):
#   Kafka  — WriteData only on the topics it produces (+ dlq.events), ReadData only on the topics it consumes,
#            consumer groups restricted to "<service>.*"
#   S3     — only the buckets it declares (read / write / put-only)
#   others — OpenSearch identity statement (paired with the domain policy), SES, policies bundle for the OPA sidecar
# Zones and the edge get no AWS data access at all.

locals {
  msk_cluster_arn  = module.data.msk_cluster_arn
  msk_cluster_name = module.data.msk_cluster_name
  msk_cluster_uuid = element(split("/", local.msk_cluster_arn), 2)
  msk_topic_prefix = "arn:aws:kafka:${local.region}:${local.account_id}:topic/${local.msk_cluster_name}/${local.msk_cluster_uuid}"
  msk_group_prefix = "arn:aws:kafka:${local.region}:${local.account_id}:group/${local.msk_cluster_name}/${local.msk_cluster_uuid}"

  b = module.storage.bucket_arns

  kafka_produce = { for k, s in var.services : k => length(s.produces) > 0 ? concat(s.produces, ["dlq.events"]) : [] }
  uses_kafka    = { for k, s in var.services : k => length(s.produces) + length(s.consumes) > 0 }
  s3_read_arns  = { for k, s in var.services : k => [for x in concat(s.s3_read, k == "agents" ? ["policies"] : []) : "${local.b[x]}/*"] }
  s3_write_arns = { for k, s in var.services : k => [for x in s.s3_write : "${local.b[x]}/*"] }
  s3_put_arns   = { for k, s in var.services : k => [for x in s.s3_put : "${local.b[x]}/*"] }
}

data "aws_iam_policy_document" "minimal" {
  statement {
    sid       = "XRay"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
}

data "aws_iam_policy_document" "service" {
  for_each = var.services

  statement {
    sid       = "XRay"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = local.uses_kafka[each.key] ? [1] : []
    content {
      sid       = "MskConnect"
      actions   = ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster", "kafka-cluster:WriteDataIdempotently"]
      resources = [local.msk_cluster_arn]
    }
  }

  dynamic "statement" {
    for_each = length(local.kafka_produce[each.key]) > 0 ? [1] : []
    content {
      sid       = "MskProduce"
      actions   = ["kafka-cluster:DescribeTopic", "kafka-cluster:CreateTopic", "kafka-cluster:WriteData"]
      resources = [for t in local.kafka_produce[each.key] : "${local.msk_topic_prefix}/${t}"]
    }
  }

  dynamic "statement" {
    for_each = length(each.value.consumes) > 0 ? [1] : []
    content {
      sid       = "MskConsume"
      actions   = ["kafka-cluster:DescribeTopic", "kafka-cluster:ReadData"]
      resources = [for t in each.value.consumes : "${local.msk_topic_prefix}/${t}"]
    }
  }

  dynamic "statement" {
    for_each = length(each.value.consumes) > 0 ? [1] : []
    content {
      sid       = "MskGroups"
      actions   = ["kafka-cluster:AlterGroup", "kafka-cluster:DescribeGroup"]
      resources = ["${local.msk_group_prefix}/${each.key}.*"]
    }
  }

  dynamic "statement" {
    for_each = length(local.s3_read_arns[each.key]) > 0 ? [1] : []
    content {
      sid       = "S3Read"
      actions   = ["s3:GetObject"]
      resources = local.s3_read_arns[each.key]
    }
  }

  dynamic "statement" {
    for_each = length(local.s3_write_arns[each.key]) > 0 ? [1] : []
    content {
      sid       = "S3Write"
      actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      resources = local.s3_write_arns[each.key]
    }
  }

  dynamic "statement" {
    for_each = length(local.s3_put_arns[each.key]) > 0 ? [1] : []
    content {
      sid       = "S3PutOnly"
      actions   = ["s3:PutObject"]
      resources = local.s3_put_arns[each.key]
    }
  }

  dynamic "statement" {
    for_each = each.value.opensearch == null ? [] : [1]
    content {
      sid = "OpenSearch"
      actions = each.value.opensearch == "rw" ? [
        "es:ESHttpGet", "es:ESHttpHead", "es:ESHttpPost", "es:ESHttpPut", "es:ESHttpDelete",
      ] : ["es:ESHttpGet", "es:ESHttpHead", "es:ESHttpPost"]
      resources = ["${module.data.opensearch_arn}/*"]
    }
  }

  dynamic "statement" {
    for_each = each.value.ses ? [1] : []
    content {
      sid       = "Ses"
      actions   = ["ses:SendEmail", "ses:SendRawEmail"]
      resources = ["*"]
    }
  }
}
