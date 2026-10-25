# Secrets Manager containers, one per (owner, name): <prefix>/<owner>/<name>, e.g. ac/dev/payment/STRIPE_SECRET_KEY.
# Third-party credentials are set out of band (`aws secretsmanager put-secret-value`), never in state.
# Exception: generated per-service database credentials (managed_values), which Terraform must know
# to build each service's DATABASE_URL; the state bucket is KMS-encrypted and access-restricted.
resource "aws_secretsmanager_secret" "this" {
  for_each                = var.secrets
  name                    = "${var.name_prefix}/${each.value}"
  recovery_window_in_days = var.recovery_window_in_days
  tags                    = merge(var.tags, { Owner = split("/", each.value)[0] })
}

resource "aws_secretsmanager_secret_version" "managed" {
  for_each      = var.managed_keys
  secret_id     = aws_secretsmanager_secret.this[each.key].id
  secret_string = var.managed_values[each.key]
}
