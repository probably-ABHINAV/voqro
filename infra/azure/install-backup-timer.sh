#!/usr/bin/env bash
# Install only after the live backend can complete a verified off-site backup.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Run as root through Azure VM Run Command.' >&2; exit 1; }
mountpoint -q /var/lib/voqro
cat >/etc/systemd/system/voqro-backup.service <<'UNIT'
[Unit]
Description=Voqro verified private Azure backup
Requires=docker.service
After=docker.service network-online.target
RequiresMountsFor=/var/lib/voqro
[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec voqro-backend node --disable-warning=ExperimentalWarning scripts/offsite-backup.mjs run
TimeoutStartSec=20min
Nice=10
IOSchedulingClass=idle
UNIT
# Preserve a previously installed daily schedule during application upgrades.
if [ ! -f /etc/systemd/system/voqro-backup.timer ]; then
  backup_time=$(date -u +%H:%M)
  cat >/etc/systemd/system/voqro-backup.timer <<UNIT
[Unit]
Description=Daily Voqro backup schedule
[Timer]
OnCalendar=*-*-* ${backup_time}:00 UTC
RandomizedDelaySec=5min
Persistent=true
[Install]
WantedBy=timers.target
UNIT
fi
systemctl daemon-reload
systemctl enable --now voqro-backup.timer
systemctl list-timers voqro-backup.timer --no-pager
