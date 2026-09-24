#!/usr/bin/env bash
# Set up a fresh Ubuntu 22.04/24.04 (ARM or x86) VM as the executor's GitHub Actions runner.
# Usage, on the VM, as a user with sudo:
#   curl -fsSL https://raw.githubusercontent.com/SproutHouse/AiFi_Executor/main/ops/runner/setup.sh -o setup.sh
#   bash setup.sh <registration token from GitHub: Settings → Actions → Runners → New self-hosted runner>
# The token is valid for one hour and is only used to register; it is not stored.
set -euo pipefail
TOKEN="${1:-}"; [ -n "$TOKEN" ] || { echo "usage: bash setup.sh <registration token>"; exit 1; }
REPO_URL="https://github.com/SproutHouse/AiFi_Executor"
sudo apt-get update -qq && sudo apt-get install -y -qq git python3 python3-venv python3-pip curl jq unattended-upgrades ufw >/dev/null
sudo timedatectl set-timezone UTC
sudo ufw --force enable >/dev/null; sudo ufw allow OpenSSH >/dev/null            # nothing inbound but SSH
sudo dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
id runner >/dev/null 2>&1 || sudo useradd -m -s /bin/bash runner
ARCH=$(uname -m); case "$ARCH" in aarch64|arm64) RARCH=arm64;; x86_64) RARCH=x64;; *) echo "unsupported arch $ARCH"; exit 1;; esac
VER=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')
sudo -u runner bash -c "
  set -e; mkdir -p ~/actions-runner && cd ~/actions-runner
  curl -fsSL -o runner.tgz https://github.com/actions/runner/releases/download/v${VER}/actions-runner-linux-${RARCH}-${VER}.tar.gz
  tar xzf runner.tgz && rm runner.tgz
  ./config.sh --unattended --url ${REPO_URL} --token ${TOKEN} --name executor-eu --labels self-hosted,executor,eu --replace
"
cd /home/runner/actions-runner && sudo ./svc.sh install runner >/dev/null && sudo ./svc.sh start >/dev/null
echo "runner installed and started. On GitHub: Settings → Actions → Runners should show executor-eu as Idle."
echo "then: Settings → Secrets and variables → Actions → Variables → New variable RUNNER_LABEL = self-hosted"
