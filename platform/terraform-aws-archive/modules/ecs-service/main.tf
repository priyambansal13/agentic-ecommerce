# One ECS Fargate service = one microservice or micro-frontend zone (independently deployable).
# Published in Service Connect as http://<name>:<container_port>.

data "aws_region" "current" {}

locals {
  attach_to_alb = length(var.path_patterns) > 0
  health_command = coalesce(
    var.health_check_command,
    ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.container_port}${var.health_check_path} >/dev/null 2>&1 || exit 1"],
  )
  main_container = {
    name      = var.name
    image     = var.image
    essential = true
    portMappings = [{
      name          = var.name
      containerPort = var.container_port
      protocol      = "tcp"
      appProtocol   = "http"
    }]
    environment = [for k, v in var.environment : { name = k, value = v }]
    secrets     = [for k, arn in var.secrets : { name = k, valueFrom = arn }]
    healthCheck = {
      command     = local.health_command
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    dependsOn = [for sc in var.sidecars : { containerName = sc.name, condition = "START" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = var.name
      }
    }
    readonlyRootFilesystem = false
  }
  sidecar_containers = [for sc in var.sidecars : {
    name        = sc.name
    image       = sc.image
    essential   = true
    command     = sc.command
    environment = [for k, v in sc.environment : { name = k, value = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = sc.name
      }
    }
  }]
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.cluster_name}/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# ---------------------------------------------------------------- IAM
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pull image, write logs, inject the listed secrets.
resource "aws_iam_role" "execution" {
  name               = "${var.cluster_name}-${var.name}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  count = length(var.secrets) > 0 ? 1 : 0
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    # strip an optional ":json-key:version-stage:version-id" suffix back to the secret ARN
    resources = distinct([for arn in values(var.secrets) : join(":", slice(split(":", arn), 0, 7)) if startswith(arn, "arn:aws:secretsmanager:")])
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  count  = length(var.secrets) > 0 ? 1 : 0
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets[0].json
}

# Task role: what the application code itself may call (S3, MSK, OpenSearch, ...).
resource "aws_iam_role" "task" {
  name               = "${var.cluster_name}-${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "task" {
  # count must be known at plan time; the policy JSON itself is only known after apply
  count  = var.attach_task_policy ? 1 : 0
  name   = "app"
  role   = aws_iam_role.task.id
  policy = var.task_policy_json
}

# ECS Exec (debugging) needs SSM messages on the task role.
data "aws_iam_policy_document" "exec" {
  statement {
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "exec" {
  count  = var.enable_execute_command ? 1 : 0
  name   = "ecs-exec"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.exec.json
}

# ---------------------------------------------------------------- task definition
resource "aws_ecs_task_definition" "this" {
  family                   = "${var.cluster_name}-${var.name}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode(concat([local.main_container], local.sidecar_containers))

  tags = var.tags
}

# ---------------------------------------------------------------- ALB target (optional)
resource "aws_lb_target_group" "this" {
  count                = local.attach_to_alb ? 1 : 0
  name                 = substr("${var.cluster_name}-${var.name}", 0, 32)
  port                 = var.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = var.health_check_path
    matcher             = var.health_check_matcher
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

resource "aws_lb_listener_rule" "this" {
  count        = local.attach_to_alb ? 1 : 0
  listener_arn = var.listener_arn
  priority     = var.listener_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[0].arn
  }

  condition {
    path_pattern {
      values = var.path_patterns
    }
  }

  tags = var.tags
}

# ---------------------------------------------------------------- service
resource "aws_ecs_service" "this" {
  name                   = var.name
  cluster                = var.cluster_arn
  task_definition        = aws_ecs_task_definition.this.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = var.enable_execute_command
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "load_balancer" {
    for_each = local.attach_to_alb ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.this[0].arn
      container_name   = var.name
      container_port   = var.container_port
    }
  }

  service_connect_configuration {
    enabled   = true
    namespace = var.service_connect_namespace_arn
    service {
      port_name      = var.name
      discovery_name = var.name
      client_alias {
        port     = var.container_port
        dns_name = var.name
      }
    }
  }

  lifecycle {
    # CI deploys new images by registering task definitions; desired count is owned by autoscaling.
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.this]
  tags       = var.tags
}

# ---------------------------------------------------------------- autoscaling (CPU target tracking)
resource "aws_appautoscaling_target" "this" {
  service_namespace  = "ecs"
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_count
  max_capacity       = var.max_count
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name}-cpu"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    target_value       = var.cpu_target_percent
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
