#!/usr/bin/env bash
# Hourly disk maintenance on a worker host (installed by deploy.sh as turbineh-maintenance.timer).
# Each lockfile hash produces a multi-GB sandbox base image; without pruning the disk fills up and every build fails
# at `install` (happened on 2026-10-12 with 64 GB of images).
set -uo pipefail
KEEP_BASE_IMAGES="${KEEP_BASE_IMAGES:-8}"
BUILD_DIR_DAYS="${BUILD_DIR_DAYS:-3}"
# Disk pressure: below this many free GB, older build directories and the whole build cache go too (the worker stops
# claiming builds below MIN_FREE_DISK_GB, 15 by default; this keeps it well above).
TARGET_FREE_GB="${TARGET_FREE_GB:-30}"
KEEP_RECENT_MIN="${KEEP_RECENT_MIN:-120}"
free_gb() { df --output=avail -BG / | tail -1 | tr -dc 0-9; }
before=$(df --output=used -BG / | tail -1 | tr -dc 0-9)
# Newest base images stay (the common recipe lockfiles); older ones are rebuilt on demand.
docker images turbineh/sandbox-base --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' | sort -r \
  | tail -n +$((KEEP_BASE_IMAGES + 1)) | cut -d'|' -f2 | xargs -r docker rmi >/dev/null 2>&1
docker image prune -f >/dev/null 2>&1                         # dangling layers only
docker builder prune -f --filter until=72h >/dev/null 2>&1
docker volume prune -f >/dev/null 2>&1                        # anonymous, unused volumes (named stores stay)
# Local build directories: the delivered package is in object storage; keep a few days for debugging.
find /opt/code-api-turbineh*/builds -mindepth 1 -maxdepth 1 -type d -mtime +"$BUILD_DIR_DAYS" -exec rm -rf {} + 2>/dev/null
# Under pressure: oldest build directories first (never the last KEEP_RECENT_MIN minutes: builds may be running), then
# the full build cache, until TARGET_FREE_GB is free again.
if [ "$(free_gb)" -lt "$TARGET_FREE_GB" ]; then
  docker builder prune -af >/dev/null 2>&1
  find /opt/code-api-turbineh*/builds -mindepth 1 -maxdepth 1 -type d -mmin +"$KEEP_RECENT_MIN" -printf '%T@ %p\n' 2>/dev/null \
    | sort -n | cut -d' ' -f2- | while read -r dir; do
        [ "$(free_gb)" -ge "$TARGET_FREE_GB" ] && break
        rm -rf "$dir"
      done
fi
after=$(df --output=used -BG / | tail -1 | tr -dc 0-9)
echo "maintenance: used ${before}G -> ${after}G ($(df --output=pcent / | tail -1 | tr -d ' ') of disk)"
