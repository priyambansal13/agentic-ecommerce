# terraform test (mocked AWS, no credentials): the generated bootstrap script is well-formed.
mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { region = "ap-south-1" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{}" }
  }
}

variables {
  name              = "ac-test-shared"
  db_host           = "cluster.example.internal"
  master_username   = "ac_admin"
  master_secret_arn = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:rds-master"
  databases = [
    { service = "user", database = "users", secret_arn = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:ac/test/user/database-url" },
    { service = "seller-analytics", database = "analytics", secret_arn = "arn:aws:secretsmanager:ap-south-1:111111111111:secret:ac/test/seller-analytics/database-url" },
  ]
}

run "script_creates_each_database" {
  command = plan

  assert {
    condition     = strcontains(aws_ssm_parameter.script.value, "ensure svc_users ac_users \"$${PW_USERS}\"")
    error_message = "users database line missing"
  }
  assert {
    condition     = strcontains(aws_ssm_parameter.script.value, "ensure svc_analytics ac_analytics \"$${PW_ANALYTICS}\"")
    error_message = "analytics database line missing"
  }
  assert {
    condition     = strcontains(aws_ssm_parameter.script.value, "\nSQL\n") && strcontains(aws_ssm_parameter.script.value, "REVOKE ALL ON DATABASE")
    error_message = "inner SQL heredoc must be dedented and revoke PUBLIC access"
  }
  assert {
    condition     = length(regexall("\\\\gexec", aws_ssm_parameter.script.value)) == 6
    error_message = "expected 6 \\gexec statements"
  }
}
