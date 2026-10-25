output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_connect_namespace_arn" {
  value = aws_service_discovery_http_namespace.this.arn
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "listener_arn" {
  description = "Listener that services attach path rules to (HTTPS if a certificate is set, else HTTP)"
  value       = var.certificate_arn == null ? aws_lb_listener.http.arn : aws_lb_listener.https[0].arn
}

output "repository_urls" {
  value = local.repository_urls
}
