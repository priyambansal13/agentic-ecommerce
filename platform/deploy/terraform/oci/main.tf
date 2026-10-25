# One Oracle Cloud Always Free Ampere A1 VM running k3s for agentic-commerce (all microservices, zones and
# backing services in namespaces ac-apps / ac-infra — see ../../helm). Single node: no HA by design (cost €0).

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.20.0.0/16"]
  display_name   = "${var.name}-vcn"
  dns_label      = "agentic"
}

resource "oci_core_internet_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-igw"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-public"
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this.id
  }
}

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-public"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  # HTTP (ACME challenge + redirect) and HTTPS for everyone
  dynamic "ingress_security_rules" {
    for_each = { http = 80, https = 443 }
    content {
      source      = "0.0.0.0/0"
      protocol    = "6"
      description = ingress_security_rules.key
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }
  ingress_security_rules {
    source      = var.ssh_cidr
    protocol    = "6"
    description = "ssh"
    tcp_options {
      min = 22
      max = 22
    }
  }
  ingress_security_rules {
    source      = var.admin_cidr
    protocol    = "6"
    description = "k3s API (kubectl/helm from the admin machine only)"
    tcp_options {
      min = 6443
      max = 6443
    }
  }
  # Path MTU discovery
  ingress_security_rules {
    source   = "0.0.0.0/0"
    protocol = "1"
    icmp_options {
      type = 3
      code = 4
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.this.id
  cidr_block        = "10.20.1.0/24"
  display_name      = "${var.name}-public"
  dns_label         = "public"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.public.id]
}

resource "oci_core_instance" "k3s" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name
  display_name        = "${var.name}-k3s"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gb
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "k3s"
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(pathexpand(var.ssh_public_key_path)))
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      domain               = var.domain
      acme_email           = var.acme_email
      k3s_version          = var.k3s_version
      cert_manager_version = var.cert_manager_version
      traefik_config       = file("${path.module}/../../k3s/traefik-config.yaml")
    }))
  }

  lifecycle {
    # a newer Ubuntu image must not replace the running cluster
    ignore_changes = [source_details[0].source_id, metadata["user_data"]]
  }
}
