#!/usr/bin/env bash
# Runs once on the staging host as root: Docker, Node 24, pnpm, gitleaks and an unprivileged worker user.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git rsync ufw >/dev/null
# Docker Engine (official repository)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list
apt-get update -qq && apt-get install -y -qq docker-ce docker-ce-cli containerd.io >/dev/null
# Node.js 24 (NodeSource) + pnpm 10.33.0
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
apt-get install -y -qq nodejs >/dev/null
npm install -g pnpm@10.33.0 >/dev/null
# gitleaks 8.30.1 (checksum verified)
V=8.30.1; cd /tmp
curl -sSfL -o gl.tgz "https://github.com/gitleaks/gitleaks/releases/download/v${V}/gitleaks_${V}_linux_x64.tar.gz"
curl -sSfL -o sums.txt "https://github.com/gitleaks/gitleaks/releases/download/v${V}/gitleaks_${V}_checksums.txt"
grep " gitleaks_${V}_linux_x64.tar.gz$" sums.txt | sed 's/gitleaks_.*$/gl.tgz/' | sha256sum -c - >/dev/null
tar -xzf gl.tgz gitleaks && install -m 0755 gitleaks /usr/local/bin/gitleaks
# Unprivileged worker user (docker group to run sandboxes)
id turbineh >/dev/null 2>&1 || useradd -m -s /bin/bash turbineh
usermod -aG docker turbineh
mkdir -p /opt/code-api-turbineh /etc/turbineh && chown turbineh:turbineh /opt/code-api-turbineh && chmod 700 /etc/turbineh
# Firewall: SSH only (the worker makes outbound connections; nothing listens publicly)
ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; ufw allow OpenSSH >/dev/null; ufw --force enable >/dev/null
echo "host ready: $(docker --version) · node $(node --version) · pnpm $(pnpm --version) · $(gitleaks version)"
