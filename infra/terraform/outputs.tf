output "server_ipv4" {
  value = hcloud_server.app.ipv4_address
}

output "server_ipv6" {
  value = hcloud_server.app.ipv6_address
}

output "ssh" {
  value = "ssh deploy@${hcloud_server.app.ipv4_address}"
}

output "r2_bucket" {
  value = cloudflare_r2_bucket.media.name
}

output "r2_s3_endpoint" {
  value = local.r2_endpoint
}

output "next_steps" {
  value = <<-EOT
    1. Wait ~3 minutes for cloud-init, then: ssh deploy@${hcloud_server.app.ipv4_address}
    2. Create an R2 API token (Object Read & Write, bucket ${cloudflare_r2_bucket.media.name}).
    3. On the server, create /opt/mitome/.env.production from deploy/.env.production.example.
    4. From your machine: ./deploy/deploy.sh ${hcloud_server.app.ipv4_address}
  EOT
}
