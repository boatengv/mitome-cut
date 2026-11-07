variable "hcloud_token" {
  description = "Hetzner Cloud API token (Project → Security → API tokens, read & write)."
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with R2 Edit, plus DNS Edit on the zone if manage_dns is true."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard sidebar)."
  type        = string
}

variable "name" {
  description = "Name prefix for every resource."
  type        = string
  default     = "mitome"
}

variable "domain" {
  description = "Hostname the app is served on, e.g. studio.example.com."
  type        = string
}

variable "manage_dns" {
  description = "Create the DNS A record in Cloudflare. Set false if your DNS is elsewhere."
  type        = bool
  default     = true
}

variable "cloudflare_zone_id" {
  description = "Zone ID of the domain in Cloudflare (needed when manage_dns is true)."
  type        = string
  default     = ""
}

variable "server_type" {
  description = "Hetzner server type. cx23 = 2 vCPU / 4 GB. Check current types and prices before applying."
  type        = string
  default     = "cx23"
}

variable "location" {
  description = "Hetzner location: nbg1, fsn1 (Germany), hel1 (Finland)."
  type        = string
  default     = "nbg1"
}

variable "ssh_public_key" {
  description = "Your SSH public key, e.g. the contents of ~/.ssh/id_ed25519.pub."
  type        = string
}

variable "admin_ips" {
  description = "CIDRs allowed to SSH in. Lock this to your IP, e.g. [\"203.0.113.7/32\"]."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "enable_backups" {
  description = "Hetzner server backups (adds a percentage of the server price). Database backups to R2 run regardless."
  type        = bool
  default     = false
}
