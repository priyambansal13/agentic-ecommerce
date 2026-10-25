# One Aurora PostgreSQL Serverless v2 cluster. The platform creates a shared cluster that hosts one
# logical database per microservice, plus a dedicated cluster for every service in dedicated_db_services.
# Roles/databases inside the cluster are created by the db-bootstrap task (the AWS provider can't).

resource "aws_security_group" "this" {
  name        = "${var.name}-pg"
  description = "Aurora ${var.name} - app tasks only"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "app" {
  security_group_id            = aws_security_group.this.id
  referenced_security_group_id = var.app_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-pg"
  subnet_ids = var.database_subnet_ids
  tags       = var.tags
}

resource "aws_rds_cluster_parameter_group" "this" {
  name        = "${var.name}-pg"
  family      = var.parameter_group_family
  description = "agentic-commerce aurora params (${var.name})"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  tags = var.tags
}

resource "aws_rds_cluster" "this" {
  cluster_identifier              = "${var.name}-pg"
  engine                          = "aurora-postgresql"
  engine_mode                     = "provisioned"
  engine_version                  = var.engine_version
  master_username                 = "ac_admin"
  manage_master_user_password     = true # master password lives in Secrets Manager, rotated by RDS
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.this.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.this.name
  storage_encrypted               = true
  backup_retention_period         = var.backup_retention_days
  preferred_backup_window         = "19:00-20:00" # ~00:30 IST
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = !var.deletion_protection
  final_snapshot_identifier       = var.deletion_protection ? "${var.name}-pg-final" : null
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql"]

  serverlessv2_scaling_configuration {
    min_capacity = var.min_acu
    max_capacity = var.max_acu
  }

  tags = var.tags
}

resource "aws_rds_cluster_instance" "this" {
  count                        = var.instance_count
  identifier                   = "${var.name}-pg-${count.index}"
  cluster_identifier           = aws_rds_cluster.this.id
  instance_class               = "db.serverless"
  engine                       = aws_rds_cluster.this.engine
  engine_version               = aws_rds_cluster.this.engine_version
  db_subnet_group_name         = aws_db_subnet_group.this.name
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  tags                         = var.tags
}
