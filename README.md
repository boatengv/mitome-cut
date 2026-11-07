# Mitome Cut

Mitome Studios' browser video editor with AI scene generation: upload media, generate scenes from prompts, arrange them on a timeline with titles, voiceover and music, and export MP4, MOV or GIF.

Built to start on about €6 a month and grow without a rewrite.

## How it fits together

```
Browser (React)  ──HTTPS──▶  Caddy  ──▶  API (Fastify)  ──▶  Postgres
     │                                     │  ▲                 ▲
     │ signed URLs                         │  │ jobs (pg-boss)  │
     ▼                                     ▼  │                 │
Cloudflare R2  ◀──────────────────────  Worker (FFmpeg) ────────┘
(media, exports, backups)
```

- **Postgres** stores users, projects, assets, generations and exports. Each project's timeline is one versioned JSON document. Saves carry the revision they were based on, and a stale save gets `409` instead of overwriting another tab's work.
- **Object storage** (R2 in production, local disk or MinIO in development) holds every file. Browsers upload and stream directly with signed URLs, so file bytes never pass through the API. Files are never overwritten; each version gets a new key.
- **Jobs** run from a queue stored in Postgres (pg-boss), so there's no Redis. The worker probes uploads and makes thumbnails, runs scene generation, renders exports with FFmpeg, backs up the database nightly, and cleans up abandoned uploads.
- **Generation providers** plug in behind one interface. The built-in `demo` provider renders a test pattern with your prompt on it, so the whole pipeline works without an API key.

## Run it locally

You need Node 22+ and FFmpeg (`brew install ffmpeg` or `apt install ffmpeg`).

```bash
cp .env.example .env
docker compose up -d postgres     # or point DATABASE_URL at any Postgres 13+
npm install
npm run dev                       # API :3000, worker, web :5173
```

Sign-in is handled by [Clerk](https://dashboard.clerk.com). Create an application there and put its keys in `.env` (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and the same publishable key as `VITE_CLERK_PUBLISHABLE_KEY`). Then open http://localhost:5173 and create an account. Media is stored under `./data/storage` by default. To use MinIO instead, run `docker compose up -d` and switch to the `S3_*` settings in `.env`.

No Node on your machine? `docker compose --profile app up --build` runs everything at http://localhost:3000.

### Checks

```bash
npm run typecheck
npm test                          # unit tests: timeline maths, render graph
node scripts/smoke.mjs            # end to end against a running API + worker
```

The smoke test (currently written for the old email/password API, so it needs updating for Clerk) signs up, uploads video and audio, generates a scene, saves the timeline, checks conflict and ownership rules, exports MP4 and GIF, and verifies the output with ffprobe. `.github/workflows/ci.yml` runs all three on every push once the repo is on GitHub.

## Repository layout

```
packages/shared   Timeline schema (zod), API types, helpers used by both sides
apps/server       API, worker, database schema and migrations, render graph
apps/web          The editor (React + Vite)
deploy/           Production Compose file, Caddyfile, deploy script
infra/terraform   Hetzner server + firewall, Cloudflare R2 bucket + CORS, DNS
scripts/smoke.mjs End-to-end test
```

## Using the editor

- **Media**: import or drop files; click **+** on a ready item to add it to the end of V1 (video, images) or A1 (audio).
- **Generate**: write a prompt to create a scene, or add a placeholder scene and generate it later from the inspector.
- **Text**: titles, lower thirds and captions are added at the playhead on T1.
- **Timeline**: drag clips to move them and drag their edges to trim. Clips snap to other clips' edges and to the playhead. Ctrl/⌘+wheel zooms.
- **Keys**: Space plays and pauses, S splits at the playhead, Delete removes the selected clip, Ctrl/⌘+Z undoes, Ctrl/⌘+Shift+Z redoes.
- Changes save automatically.

## Adding a real video model

Implement `GenerationProvider` in `apps/server/src/providers/`: submit the job, poll until it finishes, download the MP4 to `outPath`, and return `costUsd`. Then register it in `PROVIDERS` and put its API key in the environment. Each generation's cost is recorded on its row.

Generations are never retried automatically, because with a paid model a retry is a second charge.

## Guardrails

These limits keep usage and cost bounded. All are environment variables:

| Setting | Default | What it limits |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | 500 | Size of one upload (checked before the upload URL is issued, and again after) |
| `STORAGE_QUOTA_MB` | 5000 | Total storage per user |
| `GENERATIONS_PER_DAY` | 20 | Scene generations per user per 24 h |
| `EXPORTS_PER_DAY` | 30 | Exports per user per 24 h |
| `MAX_PROJECTS_PER_USER` | 50 | Projects per user |

There is also a rate limit of 300 requests a minute per IP. Who can sign up is controlled in the Clerk dashboard (allowlist or invite-only).

## Deploying (Hetzner + Cloudflare R2, about €6/month)

1. **Provision.** In `infra/terraform`, copy `terraform.tfvars.example` to `terraform.tfvars`, fill it in, then run:
   ```bash
   terraform init && terraform apply
   ```
   This creates the server, firewall, R2 bucket with CORS, and (optionally) DNS records. Check `server_type` against Hetzner's current plans and prices first.
2. **R2 credentials.** In the Cloudflare dashboard go to R2 → Manage API tokens, and create a token with Object Read & Write on the bucket.
3. **Configure.** SSH in (`terraform output ssh`) and create `/opt/mitome/.env.production` from `deploy/.env.production.example`.
4. **Deploy** from your machine. Run this again for every update:
   ```bash
   ./deploy/deploy.sh $(terraform -chdir=infra/terraform output -raw server_ipv4)
   ```
5. In the Clerk dashboard, restrict sign-ups (allowlist or invite-only) before you share the URL.

Caddy gets the TLS certificate automatically. Migrations run when the API starts.

### Backups and restore

With `BACKUP_CRON` set, the worker uploads `pg_dump` output to `backups/postgres/` in R2 every night and deletes copies older than `BACKUP_RETENTION_DAYS`. To restore:

```bash
gunzip -c backup.sql.gz | docker compose -f deploy/docker-compose.prod.yml --env-file .env.production exec -T postgres psql -U mitome mitome
```

### Growing

- More users: move to a larger server type (one Terraform variable).
- Heavy rendering: run the worker on a second server pointed at the same database.
- Database: move to managed Postgres by changing `DATABASE_URL`.

None of these need code changes.

## Known limits of this version

- Single-user projects; no sharing or real-time collaboration yet. The timeline format is ready for a CRDT sync layer later.
- The editor preview syncs HTML video elements to the timeline clock. It's accurate enough for editing; the export is frame-accurate.
- No transitions, keyframes or multiple video tracks yet.
