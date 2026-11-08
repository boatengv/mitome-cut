# Mitome Cut

Mitome Studios' AI film editor:
1. Write a script and split it into scenes.
2. Build the cast, locations and props, and sketch a storyboard.
3. Generate each scene with fal.ai video models, then add ElevenLabs voiceover and a music bed.
4. Render the film on the server as MP4, MOV or GIF.

Projects can be single movies or TV shows with seasons and episodes. Shows and seasons pass their style and shared assets down to every episode.

Built to start on about €6 a month and grow without a rewrite.

## How it fits together

```
Browser  ──HTTPS──▶  Caddy  ──▶  API (Fastify)  ──▶  Postgres
  │  sign-in: Clerk                │  ▲                 ▲
  │  signed URLs                   │  │ jobs (pg-boss)  │
  ▼                                ▼  │                 │
Cloudflare R2  ◀───────────  Worker (FFmpeg, fal.ai) ───┘
(media, renders, backups)          │
                                   ▼
                      fal.ai · ElevenLabs · Claude API
```

- **Sign-in** is [Clerk](https://dashboard.clerk.com). `apps/web/src/` holds only the sign-in page (React and Clerk components). Once someone is signed in, it starts the editor and gives it a token getter. The API checks the Clerk session token on every request and maps it to a row in its own `users` table.
- **The editor** lives in `apps/web/public/` and is plain HTML, CSS and JavaScript:
  - `app.js` is the editor itself.
  - `backend.js` connects it to the server: the project library, files, AI calls and exports.
  - `styles.css` holds the base styles and the theme variables (Graphite dark, Layered white light).
  - `design.css` is the redesign layer from `docs/design/app-redesign.md`.
- **The library** is a set of JSON documents per user in Postgres: the project, show and season lists, plus one document per project, show and season. The editor keeps a copy in memory and saves changes in the background a moment after you stop typing. The last save wins.
- **Files** live in object storage: R2 in production, local disk or MinIO in development. That covers clips, voiceovers, asset images, storyboard frames, references, music and renders.
  - The browser uploads and streams them directly with short-lived signed URLs.
  - Each file has a readable path, such as `projects/<id>/media/clips/<scene>.mp4`.
- **AI keys stay on the server.** The browser asks the API, and the API calls the provider. fal.ai video and image jobs run in the worker, which submits them, polls, honours **Stop**, and times out. Voiceover and the prompt AI are quick, direct calls.
- **Exports render on the server** from the saved project:
  - Scenes play back to back. Each scene lasts as long as its clip or its voiceover, whichever is longer; if the voiceover runs on, the last frame holds with a slow push-in.
  - The render adds transitions, clip sound, voiceover, a looped music bed that ducks under speech, and optional word-by-word captions.
  - Scenes that aren't generated yet render as labelled slates.
- **Jobs** run from a queue stored in Postgres (pg-boss), so there's no Redis. The worker also backs up the database nightly and cleans up abandoned uploads and stuck jobs.

## Run it locally

You need Node 22+ and FFmpeg (`brew install ffmpeg` or `apt install ffmpeg`).

```bash
cp .env.example .env               # then fill in the values below
docker compose up -d postgres      # or point DATABASE_URL at any Postgres 13+
npm install
npm run dev                        # API :3000, worker, web :5173
```

In `.env`:
- **Clerk (required).** Create an application in the Clerk dashboard and set:
  - `CLERK_PUBLISHABLE_KEY`;
  - `CLERK_SECRET_KEY`;
  - `VITE_CLERK_PUBLISHABLE_KEY`, set to the same publishable key.

  Use a development instance locally. Who can sign up (allowlist or invite-only) is set in the Clerk dashboard.
- **AI providers (optional):** `FAL_KEY`, `ELEVENLABS_API_KEY` and `ANTHROPIC_API_KEY`. Leave a key empty to switch that feature off. Without fal.ai, choose **Demo** under Settings → Video generation. Demo makes placeholder clips and spends nothing.

Open http://localhost:5173 and sign up. Media is stored under `./data/storage` by default. To use MinIO instead, run `docker compose up -d` and switch to the `S3_*` settings in `.env`.

To try the AI features without spending credits, run the stand-in providers and point the API at them. The commented lines in `.env.example` show the URLs.

```bash
npm run mock:providers             # fake fal.ai, ElevenLabs and Claude on :4010
```

No Node on your machine? `docker compose --profile app up --build` runs everything at http://localhost:3000. It reads the Clerk keys from `.env`.

### Checks

```bash
npm run typecheck
npm test                           # scene timing, captions, audio mix, schemas
```

There are two end-to-end tests. Both need the API and worker running, plus the mock providers if you don't want to spend credits.

**Against real Clerk.** This is what CI runs. It needs `CLERK_SECRET_KEY` from a development instance, and it creates and deletes a throwaway Clerk user.

```bash
npm run build
WEB_DIST_DIR=apps/web/dist node apps/server/dist/api.js & node apps/server/dist/worker.js &
node scripts/smoke.mjs
```

**Without Clerk.** `npm run build:stub` makes test-only builds in `dist-stub/` folders. In these builds Clerk is replaced by `scripts/clerk-stub`, which accepts any email as a sign-in. **Never deploy a `dist-stub` build.** Production builds and images only ever use `dist/`.

```bash
npm run build:stub
cd apps/server && WEB_DIST_DIR=../web/dist-stub node --env-file=../../.env dist-stub/api.js &
node --env-file=../../.env dist-stub/worker.js & cd ../..
SMOKE_AUTH=stub node scripts/smoke.mjs        # API: 32 checks
python scripts/ui_test.py                     # the editor in Chrome (pip install playwright)
```

What the two scripts check:
- **The smoke test:**
  - rejects anonymous and bad tokens;
  - saves a project and uploads media;
  - makes a voiceover, two prompt-AI calls and a fal.ai video job;
  - renders MP4 and GIF exports and checks them with ffprobe;
  - checks path, type and delete rules, then cleans up.
- **The browser test:**
  - signs in and confirms Settings has no key fields;
  - generates a clip, voices every scene and adds music;
  - reloads and checks everything came back;
  - renders and downloads an export;
  - sketches and approves a storyboard frame;
  - checks the settings page saves, and that the theme survives a reload.

After rebuilding the web app, restart the API: it only serves the files that existed when it started.

## Repository layout

```
packages/shared            API schemas and types (zod) used by both sides
apps/server                API, worker, database schema and migrations, scene render
apps/web/src               Sign-in page (React + Clerk) and the hand-off to the editor
apps/web/public            The editor: app.js, backend.js, styles.css, design.css
docs/design                Design handover for the app redesign
deploy/                    Production Compose file, Caddyfile, deploy script
infra/terraform            Hetzner server + firewall, Cloudflare R2 bucket + CORS, DNS
scripts/smoke.mjs          End-to-end API test (real Clerk or the stub)
scripts/ui_test.py         End-to-end browser test (stub builds)
scripts/mock-providers.mjs Stand-in for fal.ai, ElevenLabs and Claude
scripts/clerk-stub/        TEST ONLY: Clerk stand-ins for the dist-stub builds
```

## Look and feel

The app follows the approved redesign (`docs/design/app-redesign.md`; the canvas is linked there). Its main rules:
- **Themes:** Graphite (dark) and Layered white (light). The first visit follows the operating system. The sun/moon button switches theme, and the choice is remembered in `localStorage` (`mitome-theme`), shared with the sign-in page.
- **Colour:** every colour comes from the variables at the top of `styles.css`. Orange appears only on primary actions, selection, the current stage and the playhead.
- **Layout:** each signed-in screen has the 56px top bar with the stage stepper and the 240px sidebar of productions. The Studio swaps the sidebar for its icon rail.
- **Status:** shown as a dot plus a label. Sun means ready or approved; an orange ring means working or needs review; a hollow ring means not started.

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

There is also a rate limit of 300 requests a minute per IP. Who can sign up is controlled in the Clerk dashboard.

## Deploying (Hetzner + Cloudflare R2, about €6/month)

1. **Provision.** In `infra/terraform`, copy `terraform.tfvars.example` to `terraform.tfvars`, fill it in, then run:
   ```bash
   terraform init && terraform apply
   ```
   This creates the server, firewall, R2 bucket with CORS, and (optionally) DNS records. Check `server_type` against Hetzner's current plans and prices first.
2. **R2 credentials.** In the Cloudflare dashboard go to R2 → Manage API tokens, and create a token with Object Read & Write on the bucket.
3. **Configure.** SSH in (`terraform output ssh`) and create `/opt/mitome/.env.production` from `deploy/.env.production.example`. Add the Clerk production keys and your AI keys there; they never leave the server. The Clerk publishable key is also baked into the browser bundle at build time, which is fine because it is public.
4. **Deploy** from your machine. Run this again for every update:
   ```bash
   ./deploy/deploy.sh $(terraform -chdir=infra/terraform output -raw server_ipv4)
   ```
5. In the Clerk dashboard, restrict sign-ups (allowlist or invite-only) before you share the URL.

Caddy gets the TLS certificate automatically. Migrations run when the API starts.

**Upgrading from v1:** migration `0002` replaces v1's project tables with the new library and files tables. Projects made in v1 are not carried over. Accounts are kept.

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

- Projects belong to one person; there's no sharing or real-time collaboration yet. If the same project is open in two tabs, the last save wins.
- Signed media URLs last six hours. After a very long session, reopen the project to refresh them.
- The **Quick record** option in the export dialog plays the preview in real time in the browser. Use **Export video** for the final file.
- The design shows a 4K export option. Server renders currently go up to 1080p.
