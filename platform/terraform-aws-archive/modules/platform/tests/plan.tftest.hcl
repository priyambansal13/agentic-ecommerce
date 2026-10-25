# terraform test (mocked AWS, no credentials): one ECS service per microservice/zone, database per
# service, secrets scoped per owner, dedicated clusters on demand.
mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "ap-south-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"] }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
  mock_resource "aws_msk_serverless_cluster" {
    defaults = { arn = "arn:aws:kafka:ap-south-1:111111111111:cluster/ac-test-events/abc-123" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:mock" }
  }
}
mock_provider "random" {}

variables {
  environment = "test"
}

run "one_deployable_per_service_and_zone" {
  command = plan

  assert {
    condition     = length(output.ecs_services) == 18
    error_message = "expected 12 services + 5 zones + edge"
  }
  assert {
    condition     = output.service_connect_urls["catalog"] == "http://catalog:4102" && output.service_connect_urls["admin-web"] == "http://admin-web:3304"
    error_message = "Service Connect names/ports must match local dev"
  }
  assert {
    condition     = length(output.database_placement) == 11 && !contains(keys(output.database_placement), "search")
    error_message = "11 services own a database; search has none"
  }
  assert {
    condition     = alltrue([for k, c in output.database_placement : c == "shared"])
    error_message = "without dedicated_db_services everything is on the shared cluster"
  }
  assert {
    condition     = contains(keys(output.secrets_to_set), "payment/STRIPE_SECRET_KEY") && contains(keys(output.secrets_to_set), "storefront/AUTH_SECRET") && !contains(keys(output.secrets_to_set), "payment/database-url")
    error_message = "third-party secrets are per owner; database-url secrets are generated"
  }
  assert {
    condition     = length(output.db_bootstrap_run_commands) == 1
    error_message = "one bootstrap task for the shared cluster"
  }
}

run "dedicated_payment_cluster" {
  command = plan

  variables {
    dedicated_db_services = ["payment", "not-a-service"]
  }

  assert {
    condition     = output.database_placement["payment"] == "payment" && output.database_placement["order"] == "shared"
    error_message = "payment must move to its own cluster"
  }
  assert {
    condition     = length(output.db_bootstrap_run_commands) == 2 && length(output.postgres_endpoints) == 2
    error_message = "shared + payment clusters, each with a bootstrap task"
  }
}

run "scale_to_zero_dev" {
  command = plan

  variables {
    scale_to_zero_noncritical = true
  }

  assert {
    condition     = module.service["notification"].service_name == "notification"
    error_message = "notification still exists when scaled to zero"
  }
}
