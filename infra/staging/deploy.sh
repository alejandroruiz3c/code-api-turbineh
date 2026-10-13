#!/usr/bin/env bash
# Deploys the current checkout to one environment (ADR-0022): staging first, production only from main.
#
#   infra/staging/deploy.sh staging    [worker|web|all]   worker /opt/code-api-turbineh-staging + staging.software.turbineh.com
#   infra/staging/deploy.sh production [worker|web|all]   worker /opt/code-api-turbineh + software.turbineh.com
#
# Secrets stay in .env.local and /etc/turbineh/*.env; this script never prints them.
set -euo pipefail
TARGET="${1:?staging|production}"
WHAT="${2:-all}"
HOST="${WORKER_HOST:-78.232.56.12}"
KEY="${WORKER_SSH_KEY:-$HOME/.ssh/id_ed25519_turbineh_staging}"
TEAM="team_BBQ9Gyb31uDAzUkxSLx2AJqs"
# The operator's network to the workers can drop connections: retry and keep sessions alive.
SSH_OPTS="-o ConnectTimeout=15 -o ConnectionAttempts=6 -o ServerAliveInterval=30 -o ServerAliveCountMax=6"
cd "$(dirname "$0")/../.."

case "$TARGET" in
  staging) DIR=/opt/code-api-turbineh-staging; UNIT=turbineh-worker-staging; UNITFILE=worker-staging.service; ENVFILE=/etc/turbineh/worker-staging.env
           PROJECT=code-frontiers-web-staging; URL=https://staging.software.turbineh.com ;;
  production)
    [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "production deploys only from main"; exit 1; }
    git diff --quiet HEAD || { echo "uncommitted changes: commit or stash first"; exit 1; }
    DIR=/opt/code-api-turbineh; UNIT=turbineh-worker; UNITFILE=worker.service; ENVFILE=/etc/turbineh/worker.env
    PROJECT=code-frontiers-web; URL=https://software.turbineh.com ;;
  *) echo "unknown target $TARGET"; exit 1 ;;
esac

# One deploy per environment at a time (parallel agents share staging): wait for the lock instead of overwriting a
# deploy in progress. mkdir is atomic; a lock older than 45 min is considered stale.
LOCK="${TMPDIR:-/tmp}/turbineh-deploy-$TARGET.lock"
REV="$(git rev-parse --abbrev-ref HEAD)@$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo +dirty)"
for i in $(seq 1 180); do
  mkdir "$LOCK" 2>/dev/null && { echo "$REV" >"$LOCK/rev"; break; }
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +45 2>/dev/null)" ]; then rm -rf "$LOCK"; continue; fi
  [ "$i" = 1 ] && echo "waiting: $TARGET deploy in progress ($(cat "$LOCK/rev" 2>/dev/null || echo unknown))"
  sleep 10
done
[ "$(cat "$LOCK/rev" 2>/dev/null)" = "$REV" ] || { echo "could not take the $TARGET deploy lock"; exit 1; }
trap 'rm -rf "$LOCK"' EXIT

if [ "$WHAT" = worker ] || [ "$WHAT" = all ]; then
  echo "$TARGET worker: replacing $(ssh -i "$KEY" $SSH_OPTS "root@$HOST" "cat $DIR/.deployed-rev 2>/dev/null || echo unknown") with $REV"
  rsync -az --delete -e "ssh -i $KEY $SSH_OPTS" --exclude node_modules --exclude .git --exclude '.env*.local' \
    --exclude /builds --exclude /artifacts --exclude .next --exclude .turbo --exclude .vercel \
    --exclude bench/results/runs --exclude /.claude --exclude /ingest/.cache ./ "root@$HOST:$DIR/"
  ssh -i "$KEY" $SSH_OPTS "root@$HOST" "set -e; cd $DIR && echo '$REV' > .deployed-rev && chown -R turbineh:turbineh . \
    && sudo -u turbineh pnpm install --frozen-lockfile >/dev/null \
    && sudo -u turbineh pnpm turbo build --filter=@turbineh/worker... | grep -E 'Tasks:' \
    && (docker image inspect turbineh/sandbox:1 >/dev/null 2>&1 || docker build -q -t turbineh/sandbox:1 services/sandbox >/dev/null) \
    && set -a && . $ENVFILE && set +a \
    && sudo -E -H -u turbineh env PATH=\$PATH pnpm -s db:migrate \
    && install -m 644 infra/staging/$UNITFILE /etc/systemd/system/$UNIT.service \
    && install -m 755 infra/staging/maintenance.sh /opt/code-api-turbineh-maintenance.sh \
    && install -m 644 infra/staging/turbineh-maintenance.service infra/staging/turbineh-maintenance.timer /etc/systemd/system/ \
    && systemctl daemon-reload && systemctl enable --now turbineh-maintenance.timer >/dev/null 2>&1 \
    && systemctl enable --now $UNIT >/dev/null 2>&1; systemctl restart $UNIT \
    && sleep 5 && echo \"$UNIT: \$(systemctl is-active $UNIT)\""
fi

if [ "$WHAT" = web ] || [ "$WHAT" = all ]; then
  TOKEN="$(grep '^VERCEL_TOKEN=' .env.local | cut -d= -f2-)"
  PID="$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects/$PROJECT?teamId=$TEAM" \
    | python3 -I -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
  # A failed web deploy must stop the script (it used to be filtered out, leaving the old web online).
  OUT="$(VERCEL_ORG_ID="$TEAM" VERCEL_PROJECT_ID="$PID" vercel deploy --prod --yes --token "$TOKEN" 2>&1)" || true
  # The CLI prints text (Production: …) or, in non-interactive shells, JSON ("status": "error" on failure).
  if printf '%s\n' "$OUT" | grep -qE '"status": *"error"|^Error'; then
    echo "web deploy FAILED:"; printf '%s\n' "$OUT" | grep -v -i token | head -12; exit 1
  fi
  echo "web: $(printf '%s\n' "$OUT" | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | head -1)"
  for _ in $(seq 1 30); do curl -fs "$URL/health" >/dev/null && break; sleep 5; done
  echo "$URL/health → $(curl -s "$URL/health")"
fi
