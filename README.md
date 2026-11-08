# Mitome Cut

Mitome Studios' AI film editor. Write a script, split it into scenes, build the cast, locations and props, sketch a storyboard, generate each scene with fal.ai video models, add ElevenLabs voiceover and a music bed, and render the film on the server as MP4, MOV or GIF.

Projects can be single movies or TV shows with seasons and episodes. Shows and seasons pass their style and shared assets down to every episode.

Built to start on about €6 a month and grow without a rewrite.

## How it fits together

```
Browser (editor)  ──HTTPS──▶  Caddy  ──▶  API (Fastify)  ──▶  Postgres
     │                                     │  ▲                 ▲
     │ signed URLs                         │  │ jobs (pg-boss)  │
     ▼                                     ▼  │                 │
Cloudflare R2  ◀──────────────────────  Worker (FFmpeg, fal.ai) ┘
(media, renders, backups)                   │
                                            ▼
                               fal.ai · ElevenLabs · Claude API
```

- **The editor** (`apps/web/public/app.js`) is plain HTML, CSS and JavaScript. `backend.js` connects it to the server: sign-in, the project library, files, AI calls and exports.
- **The library** is a set of JSON documents per user in Postgres: the project, show and season lists (`ms_projects`, `ms_shows`, `ms_seasons`) and one document per project, show and season. The editor keeps a copy in memory and saves changes in the background a moment after you stop typing. The last save wins.
- **Files** (clips, voiceovers, asset images, storyboard frames, references, music, renders) live in object storage: R2 in production, local disk or MinIO in development. The browser uploads and streams them directly with short-lived signed URLs. Each file has a readable path such as `projects/<id>/media/clips/<scene>.mp4`.
- **AI keys stay on the server.** The browser asks the API, and the API calls the provider. fal.ai video and image jobs run in the worker, which submits, polls, honours **Stop**, and times out. Voiceover and the prompt AI are quick, direct calls.
- **Exports render on the server** from the saved project: scenes back to back, each scene as long as its clip or its voiceover, whichever is longer. If the voiceover runs on, the last frame holds with a slow push-in. The render adds transitions (fade, dip to black or white, wipe, zoom), clip sound, voiceover, a looped music bed that ducks under speech, and optional word-by-word captions. Scenes that aren't generated yet render as labelled slates.
- **Jobs** run from a queue stored in Postgres (pg-boss), so there's no Redis. The worker also backs up the database nightly and cleans up abandoned uploads and stuck jobs.

## Run it locally

You need Node 22+ and FFmpeg (`brew install ffmpeg` or `apt install ffmpeg`).

```bash
cp .env.example .env               # add FAL_KEY / ELEVENLABS_API_KEY / ANTHROPIC_API_KEY if you have them
docker compose up -d postgres      # or point DATABASE_URL at any Postgres 13+
npm install
npm run dev                        # API :3000, worker, web :5173
```

Open http://localhost:5173 and create an account. Without keys, use **Demo** as the video provider in Settings. Demo makes placeholder clips and spends nothing.

To try the AI features without spending credits, run the mock providers and point the API at them (see the commented lines in `.env.example`):

```bash
node scripts/mock-providers.mjs    # fake fal.ai, ElevenLabs and Claude on :4010
```

No Node on your machine? `docker compose --profile app up --build` runs everything at http://localhost:3000.

### Checks

```bash
npm run typecheck
npm test                           # scene timing, captions, audio mix, schemas
node scripts/smoke.mjs             # end to end against a running API + worker (+ mocks)
```

The smoke test does the following:
- signs up and saves a project;
- uploads a clip and a music bed;
- makes a voiceover, two prompt-AI calls and a fal.ai video job;
- renders MP4 and GIF exports and checks them with ffprobe (size, soundtrack, length including the voiceover hold);
- checks path, type and delete rules, then cleans up.

CI runs all three on every push and pull request.

## Repository layout

```
packages/shared            API schemas and types (zod) used by both sides
apps/server                API, worker, database schema and migrations, scene render
apps/web                   The editor: index.html, public/app.js, public/backend.js, public/styles.css
deploy/                    Production Compose file, Caddyfile, deploy script
infra/terraform            Hetzner server + firewall, Cloudflare R2 bucket + CORS, DNS
scripts/smoke.mjs          End-to-end test
scripts/mock-providers.mjs Stand-in for fal.ai, ElevenLabs and Claude
```

## Credits and limits

Every fal.ai, ElevenLabs and Claude call spends credits on the account whose key is on the server. Nothing is retried automatically, because a retry would be a second charge. Per-person daily limits cap the spend. All of these are environment variables:

| Setting | Default | What it limits |
| --- | --- | --- |
| `VIDEO_JOBS_PER_DAY` | 40 | fal.ai video generations per person per 24 h |
| `IMAGE_JOBS_PER_DAY` | 150 | Asset images and storyboard sketches per 24 h |
| `TTS_CHARS_PER_DAY` | 30000 | Voiceover characters per 24 h |
| `LLM_CALLS_PER_DAY` | 100 | Prompt AI calls per 24 h |
| `AI_JOB_TIMEOUT_MIN` | 20 | How long a fal.ai job may run before it's abandoned |
| `EXPORTS_PER_DAY` | 30 | Server renders per 24 h |
| `MAX_UPLOAD_MB` | 500 | Size of one file |
| `STORAGE_QUOTA_MB` | 5000 | Total storage per person |
| `ALLOW_SIGNUP` | false in production | Who can create accounts |

There are also rate limits: 300 requests a minute per IP overall, and 10 a minute on login and sign-up.

## Deploying (Hetzner + Cloudflare R2, about €6/month)

1. **Provision.** In `infra/terraform`, copy `terraform.tfvars.example` to `terraform.tfvars`, fill it in, then run:
   ```bash
   terraform init && terraform apply
   ```
   This creates the server, firewall, R2 bucket with CORS, and (optionally) DNS records. Check `server_type` against Hetzner's current plans and prices first.
2. **R2 credentials.** In the Cloudflare dashboard go to R2 → Manage API tokens, and create a token with Object Read & Write on the bucket.
3. **Configure.** SSH in (`terraform output ssh`) and create `/opt/mitome/.env.production` from `deploy/.env.production.example`. Add your AI keys there. They never leave the server.
4. **Deploy** from your machine. Run this again for every update:
   ```bash
   ./deploy/deploy.sh $(terraform -chdir=infra/terraform output -raw server_ipv4)
   ```
5. Set `ALLOW_SIGNUP=true`, deploy, create your account, then set it back to `false` and deploy again.

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

- Projects belong to one person; no sharing or real-time collaboration yet. If the same project is open in two tabs, the last save wins.
- Signed media URLs last six hours. After a very long session, reopen the project to refresh them.
- The in-browser **Quick record** export plays the preview in real time. Use **Render** for the final file.
- Email verification and password reset are not built yet.
