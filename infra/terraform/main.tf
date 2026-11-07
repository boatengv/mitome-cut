# One small server for the app, Cloudflare R2 for media.
# Hetzner bills hourly with a monthly cap; R2 has no egress fees.

locals {
  r2_endpoint = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
}

/* ---------------- Hetzner ---------------- */

resource "hcloud_ssh_key" "admin" {
  name       = "${var.name}-admin"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "app" {
  name = "${var.name}-fw"

  rule {
    description = "SSH (admins only)"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.admin_ips
  }
  rule {
    description = "HTTP (ACME challenges, redirect to HTTPS)"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
  rule {
    description = "HTTPS"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
  rule {
    description = "HTTP/3"
    direction   = "in"
    protocol    = "udp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "app" {
  name         = "${var.name}-app"
  server_type  = var.server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.admin.id]
  firewall_ids = [hcloud_firewall.app.id]
  backups      = var.enable_backups
  user_data    = templatefile("${path.module}/cloud-init.yaml", { ssh_public_key = var.ssh_public_key })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  labels = { app = var.name }

  lifecycle {
    # Changing cloud-init should not rebuild a live server.
    ignore_changes = [user_data, ssh_keys]
  }
}

/* ---------------- Cloudflare R2 ---------------- */

resource "cloudflare_r2_bucket" "media" {
  account_id = var.cloudflare_account_id
  name       = "${var.name}-media"
  location   = "WEUR"
}

# Browsers upload and play media straight from R2 with signed URLs.
resource "cloudflare_r2_bucket_cors" "media" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name
  rules = [{
    allowed = {
      methods = ["GET", "PUT", "HEAD"]
      origins = ["https://${var.domain}"]
      headers = ["Content-Type", "Range"]
    }
    expose_headers  = ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"]
    max_age_seconds = 3600
  }]
}

/* ---------------- DNS (optional) ---------------- */

resource "cloudflare_dns_record" "app" {
  count   = var.manage_dns ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "A"
  content = hcloud_server.app.ipv4_address
  ttl     = 300
  # DNS only: Caddy terminates TLS on the server.
  proxied = false
}

resource "cloudflare_dns_record" "app_v6" {
  count   = var.manage_dns ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "AAAA"
  content = hcloud_server.app.ipv6_address
  ttl     = 300
  proxied = false
}
