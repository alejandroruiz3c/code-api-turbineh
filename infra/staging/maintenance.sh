#!/usr/bin/env bash
# Daily disk maintenance on a worker host (installed by deploy.sh as turbineh-maintenance.timer).
# Each lockfile hash produces a multi-GB sandbox base image; without pruning the disk fills up and every build fails
# at `install` (happened on 2026-10-12 with 64 GB of images).
set -uo pipefail
KEEP_BASE_IMAGES="${KEEP_BASE_IMAGES:-8}"
BUILD_DIR_DAYS="${BUILD_DIR_DAYS:-3}"
before=$(df --output=used -BG / | tail -1 | tr -dc 0-9)
# Newest base images stay (the common recipe lockfiles); older ones are rebuilt on demand.
docker images turbineh/sandbox-base --format '{{.CreatedAt}}|{{.Repository}}:{{.Tag}}' | sort -r \
  | tail -n +$((KEEP_BASE_IMAGES + 1)) | cut -d'|' -f2 | xargs -r docker rmi >/dev/null 2>&1
docker image prune -f >/dev/null 2>&1                         # dangling layers only
docker builder prune -f --filter until=72h >/dev/null 2>&1
docker volume prune -f >/dev/null 2>&1                        # anonymous, unused volumes (named stores stay)
# Local build directories: the delivered package is in object storage; keep a few days for debugging.
find /opt/code-api-turbineh*/builds -mindepth 1 -maxdepth 1 -type d -mtime +"$BUILD_DIR_DAYS" -exec rm -rf {} + 2>/dev/null
after=$(df --output=used -BG / | tail -1 | tr -dc 0-9)
echo "maintenance: used ${before}G -> ${after}G ($(df --output=pcent / | tail -1 | tr -d ' ') of disk)"
