#!/usr/bin/env bash
# Checks out TurbineH's private packages at the releases pinned in infra/private/versions.json (ADR-0057).
#
#   infra/private/sync.sh [--for <target>] [name…]            clone/fetch and check out the pinned tag + commit
#   infra/private/sync.sh --check [--for <target>] [name…]    verify only (offline): present, pinned commit, clean
#   infra/private/sync.sh --validate                          validate versions.json only (no git, no network)
#
# Each package goes to private/<name> (git-ignored; its own private repository). Verified for every package: the
# checkout's origin is the pinned repository, the pinned tag resolves to the pinned commit, HEAD is that commit, the
# working tree is clean, and the optional contract file matches this repository. --for <target> selects the packages
# whose requiredBy lists that deploy target (infra/staging/deploy.sh). Exits non-zero when any selected package fails.
# Authentication: the GitHub CLI's credentials when `gh` is logged in, else git's own; nothing is printed or stored.
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSIONS=infra/private/versions.json
MODE=sync
TARGET=""
NAMES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --validate) MODE=validate ;;
    --for) TARGET="${2:?--for needs a deploy target}"; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) NAMES+=("$1") ;;
  esac
  shift
done

# One tab-separated line per selected package: name, repo, tag, commit, vendored contract, public contract.
ENTRIES="$(node --input-type=commonjs - "$VERSIONS" "$TARGET" "${NAMES[@]+"${NAMES[@]}"}" <<'NODE'
const fs = require("node:fs");
const [file, target, ...names] = process.argv.slice(2);
const fail = (m) => { console.error(`${file}: ${m}`); process.exit(1); };
let doc;
try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { fail(`unreadable (${e.message})`); }
const pkgs = doc?.packages;
if (!pkgs || typeof pkgs !== "object" || Array.isArray(pkgs)) fail('"packages" must be an object');
const safePath = (p) => typeof p === "string" && /^[A-Za-z0-9._/-]+$/.test(p) && !p.split("/").includes("..") && !p.startsWith("/");
for (const [name, p] of Object.entries(pkgs)) {
  const where = `packages.${name}`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) fail(`${where}: name must be lowercase letters, digits and dashes`);
  if (name === "orchestration") fail(`${where}: reserved (legacy location before ADR-0057)`);
  if (typeof p?.repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p.repo)) fail(`${where}.repo must be owner/name`);
  if (typeof p.tag !== "string" || !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(p.tag)) fail(`${where}.tag must be a semver tag (vX.Y.Z)`);
  if (typeof p.commit !== "string" || !/^[0-9a-f]{40}$/.test(p.commit)) fail(`${where}.commit must be a full commit SHA`);
  if (!Array.isArray(p.requiredBy) || !p.requiredBy.every((t) => ["web", "worker"].includes(t)))
    fail(`${where}.requiredBy must list deploy targets (web, worker)`);
  if (p.contract !== undefined && !(safePath(p.contract?.vendored) && safePath(p.contract?.public)))
    fail(`${where}.contract needs relative "vendored" and "public" paths`);
  const extra = Object.keys(p).filter((k) => !["repo", "tag", "commit", "requiredBy", "contract"].includes(k));
  if (extra.length) fail(`${where}: unknown fields ${extra.join(", ")} (pins only, never code)`);
}
for (const n of names) if (!(n in pkgs)) fail(`no package "${n}"`);
for (const [name, p] of Object.entries(pkgs)) {
  if (names.length && !names.includes(name)) continue;
  if (target && !p.requiredBy.includes(target)) continue;
  console.log([name, p.repo, p.tag, p.commit, p.contract?.vendored ?? "", p.contract?.public ?? ""].join("\t"));
}
NODE
)"
if [ "$MODE" = validate ]; then echo "$VERSIONS: valid"; exit 0; fi
[ -n "$ENTRIES" ] || { echo "private packages${TARGET:+ for $TARGET}: none pinned"; exit 0; }

GIT_AUTH=()
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  GIT_AUTH=(-c credential.helper= -c 'credential.helper=!gh auth git-credential')
fi
BASE="${TURBINEH_PRIVATE_GIT_BASE:-https://github.com/}"

FAILED=0
fail() { echo "private/$1: $2" >&2; FAILED=1; }

sync_one() {
  local name="$1" repo="$2" tag="$3" commit="$4" vendored="$5" public="$6"
  local dir="private/$name" url="${BASE}${repo}.git" fresh=0
  if [ ! -e "$dir" ]; then
    [ "$MODE" = check ] && { fail "$name" "missing (run infra/private/sync.sh)"; return; }
    mkdir -p private
    git "${GIT_AUTH[@]+"${GIT_AUTH[@]}"}" clone --quiet --no-checkout "$url" "$dir" \
      || { fail "$name" "could not clone $repo (access to the private repository is required)"; return; }
    fresh=1
  fi
  [ -d "$dir/.git" ] || { fail "$name" "exists but is not a git checkout"; return; }
  local origin
  origin="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  case "${origin%.git}" in
    */"$repo"|*:"$repo") ;;
    *) fail "$name" "origin is not $repo"; return ;;
  esac
  # A fresh --no-checkout clone has no working tree yet; anything else must be clean before it is moved.
  if [ "$fresh" = 0 ] && [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then
    fail "$name" "has local changes: commit them in $repo or discard them"; return
  fi
  local tagged
  tagged="$(git -C "$dir" rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null || true)"
  if [ "$MODE" = sync ] && { [ "$tagged" != "$commit" ] || [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$commit" ]; }; then
    git "${GIT_AUTH[@]+"${GIT_AUTH[@]}"}" -C "$dir" fetch --quiet --force origin "refs/tags/$tag:refs/tags/$tag" \
      || { fail "$name" "could not fetch $tag from $repo"; return; }
    tagged="$(git -C "$dir" rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null || true)"
  fi
  [ "$tagged" = "$commit" ] || { fail "$name" "tag $tag is ${tagged:-missing}, pinned commit is $commit"; return; }
  if [ "$MODE" = sync ]; then
    git -C "$dir" -c advice.detachedHead=false checkout --quiet --detach "$commit" \
      || { fail "$name" "could not check out $commit"; return; }
  fi
  [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$commit" ] \
    || { fail "$name" "HEAD is not the pinned commit $commit"; return; }
  [ -z "$(git -C "$dir" status --porcelain 2>/dev/null)" ] || { fail "$name" "working tree is not clean"; return; }
  if [ -n "$vendored" ] && ! cmp -s "$dir/$vendored" "$public"; then
    fail "$name" "$vendored differs from $public: release a version built for this interface (or pin the matching one)"
    return
  fi
  echo "private/$name: $repo $tag (${commit:0:12})${vendored:+, contract in sync}"
}

while IFS=$'\t' read -r name repo tag commit vendored public; do
  sync_one "$name" "$repo" "$tag" "$commit" "$vendored" "$public"
done <<<"$ENTRIES"
exit "$FAILED"
