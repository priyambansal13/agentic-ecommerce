output "public_ip" {
  description = "Point your DNS A record for var.domain here, then put it into deploy/envs/prod.env as SSH_HOST."
  value       = oci_core_instance.k3s.public_ip
}
output "ssh" {
  value = "ssh ubuntu@${oci_core_instance.k3s.public_ip}"
}
output "next_steps" {
  value = <<-EOT
    1. DNS: ${var.domain} → ${oci_core_instance.k3s.public_ip}  (wait ~3 min for cloud-init: ssh in, `cloud-init status --wait`)
    2. deploy/envs/prod.env: SSH_HOST=${oci_core_instance.k3s.public_ip}   then: ac k8s kubeconfig prod
    3. ac k8s secrets prod · push images (ac docker push <name> --tag X) · ac k8s deploy prod
  EOT
}
