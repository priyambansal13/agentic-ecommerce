data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name = var.name
  cidr = var.cidr
  azs  = local.azs

  public_subnets   = [for i, _ in local.azs : cidrsubnet(var.cidr, 8, i)]
  private_subnets  = [for i, _ in local.azs : cidrsubnet(var.cidr, 4, i + 1)]
  database_subnets = [for i, _ in local.azs : cidrsubnet(var.cidr, 8, i + 200)]

  create_database_subnet_group = false

  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway
  one_nat_gateway_per_az = !var.single_nat_gateway

  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = var.tags
}

# Gateway endpoint keeps S3 traffic (images, evidence, audit) off the NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids
  tags              = merge(var.tags, { Name = "${var.name}-s3" })
}
