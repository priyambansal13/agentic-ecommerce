# Shared data plane: ElastiCache (Valkey), OpenSearch, MSK Serverless. Aurora lives in ../aurora
# (one shared cluster with a database per service + optional dedicated clusters).
# Every store only accepts traffic from the application security group.


# ---------------------------------------------------------------- security groups
resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "ElastiCache - app tasks only"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "redis" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = var.app_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}

resource "aws_security_group" "opensearch" {
  name        = "${var.name}-opensearch"
  description = "OpenSearch - app tasks only"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "opensearch" {
  security_group_id            = aws_security_group.opensearch.id
  referenced_security_group_id = var.app_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_security_group" "msk" {
  name        = "${var.name}-msk"
  description = "MSK Serverless (IAM auth, 9098) - app tasks only"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "msk" {
  security_group_id            = aws_security_group.msk.id
  referenced_security_group_id = var.app_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 9098
  to_port                      = 9098
}

# ---------------------------------------------------------------- ElastiCache (Valkey, Redis-compatible)
resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-cache"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "${var.name}-cache"
  description                = "cache, rate limits, sessions, BullMQ"
  engine                     = var.cache_engine
  engine_version             = var.cache_engine_version
  node_type                  = var.cache_node_type
  num_cache_clusters         = var.cache_node_count
  automatic_failover_enabled = var.cache_node_count > 1
  multi_az_enabled           = var.cache_node_count > 1
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  snapshot_retention_limit   = var.cache_node_count > 1 ? 3 : 0
  apply_immediately          = !var.deletion_protection
  tags                       = var.tags
}

# ---------------------------------------------------------------- OpenSearch (hybrid BM25 + k-NN)
resource "aws_opensearch_domain" "this" {
  domain_name    = "${var.name}-search"
  engine_version = var.opensearch_engine_version

  cluster_config {
    instance_type          = var.opensearch_instance_type
    instance_count         = var.opensearch_instance_count
    zone_awareness_enabled = var.opensearch_instance_count > 1
    dynamic "zone_awareness_config" {
      for_each = var.opensearch_instance_count > 1 ? [1] : []
      content {
        availability_zone_count = min(var.opensearch_instance_count, 3)
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.opensearch_volume_gb
  }

  vpc_options {
    subnet_ids         = slice(var.private_subnet_ids, 0, max(1, min(var.opensearch_instance_count, length(var.private_subnet_ids))))
    security_group_ids = [aws_security_group.opensearch.id]
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  tags = var.tags
}

# ---------------------------------------------------------------- MSK Serverless (Kafka, IAM auth)
resource "aws_msk_serverless_cluster" "this" {
  cluster_name = "${var.name}-events"

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.msk.id]
  }

  client_authentication {
    sasl {
      iam {
        enabled = true
      }
    }
  }

  tags = var.tags
}

data "aws_msk_bootstrap_brokers" "this" {
  cluster_arn = aws_msk_serverless_cluster.this.arn
}
