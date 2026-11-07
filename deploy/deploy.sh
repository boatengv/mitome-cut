#!/usr/bin/env bash
# Ships the repo to the server and (re)starts the stack. No registry needed:
# the server builds the image itself.
#
#   ./deploy/deploy.sh <server-ip>
#
# First time: copy deploy/.env.production.example to /opt/mitome/.env.production
# on the server and fill it in (this script never uploads secrets).
set -euo pipefail

HOST="${1:?usage: deploy.sh <server-ip>}"
DEST=/opt/mitome
SSH="ssh -o StrictHostKeyChecking=accept-new deploy@${HOST}"

cd "$(dirname "$0")/.."

echo "→ Syncing code to ${HOST}:${DEST}"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude data --exclude .git \
  --exclude '.env*' --exclude 'infra/terraform/.terraform' --exclude '*.tfstate*' --exclude '*.tfvars' \
  ./ "deploy@${HOST}:${DEST}/"

echo "→ Building and starting"
$SSH "cd ${DEST} && test -f .env.production || { echo 'Missing ${DEST}/.env.production'; exit 1; }
  docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d --build --remove-orphans
  docker image prune -f >/dev/null"

echo "→ Health check"
$SSH "for i in \$(seq 1 30); do docker compose -f ${DEST}/deploy/docker-compose.prod.yml --env-file ${DEST}/.env.production exec -T api node -e \"fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\" && exit 0; sleep 2; done; exit 1"
echo "✓ Deployed"
