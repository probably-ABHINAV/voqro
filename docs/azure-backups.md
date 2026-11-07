# Private daily Azure backups

The production VM uses its existing managed identity to copy a consistent SQLite snapshot and completed original uploads into a private Azure Blob container. No account key, SAS token or browser credential is stored. Public blob access and shared-key authentication are disabled; HTTPS/TLS 1.2 and platform encryption at rest are required. The VM's data role is scoped to this backup container and does not replace its Azure OpenAI role.

`infra/azure/backups.bicep` provisions a Standard LRS Hot storage account, the `backups` container, seven-day lifecycle expiry for `daily/`, seven-day blob/container soft deletion, and the scoped identity grant. Lifecycle deletion is asynchronous, so actual retained bytes can briefly exceed the nominal seven-day window. Soft-deleted bytes still consume storage. This is an off-VM recovery copy in the same subscription and region, not a cross-region disaster recovery guarantee or immutable ransomware vault.

## Verification and limits

Each run:

1. Checks the source database/media size, file count and available local staging space.
2. Creates and verifies a consistent snapshot using the existing backup tool, removing live sessions, usable provider tokens and incomplete uploads from the copy.
3. Uploads to a fresh random prefix using conditional writes that refuse to overwrite existing blobs.
4. Downloads every object, checks lengths and SHA-256 hashes, checks SQLite integrity/foreign keys, then restores another isolated copy.
5. Publishes `complete.json` only after verification succeeds. Incomplete prefixes never qualify for recovery and expire through the same lifecycle policy.
6. Writes an atomic local status record and removes only its own temporary staging directory. Failure preserves the previous successful recovery reference.

The initial ceiling is **128 MiB and 100 files per snapshot**. Runs normally refuse another attempt within 20 hours; the daily systemd timer uses a fixed UTC minute selected on its first installation and preserves that schedule during upgrades. A two-hour stale lock can recover a crashed run. Network work has a 15-minute deadline and the systemd service has a 20-minute timeout. These are operational limits, not guaranteed Azure billing caps. Review capacity deliberately as media grows; oversized snapshots fail visibly instead of silently increasing cloud usage.

A seven-day retained window plus soft-deletion retention at this ceiling is approximately 1.75 GiB before lifecycle delays and metadata. Azure storage, transactions and any applicable egress use student credit; free-service eligibility is not assumed. The subscription spending limit remains enabled.

## Owner visibility

The owner's **Connections → Daily backups** card shows the last successful backup/restore verification and status. Other roles receive no backup configuration/status. A failed run, missing verification, or last success older than 36 hours is not healthy. A stale Running state becomes Needs attention. This is in-app visibility; no external email or alert delivery has been configured.

## Administration and recovery

After deploying the backend and configuring `AZURE_BACKUP_ACCOUNT`, `AZURE_BACKUP_CONTAINER=backups` and `BACKUP_STATE_PATH=/var/lib/voqro/offsite-backup-state` privately on the VM:

```sh
docker exec voqro-backend node --disable-warning=ExperimentalWarning scripts/offsite-backup.mjs run
# Install the timer only after this first real run succeeds:
bash infra/azure/install-backup-timer.sh
systemctl list-timers voqro-backup.timer
journalctl -u voqro-backup.service --no-pager
```

The returned `remote_prefix` identifies the recovery point. List `daily/` through the authorized Azure portal/Blob APIs if the VM/status file is lost. Only prefixes with a valid `complete.json` are completed recovery points. Read access to the private container is needed on a replacement VM; grant its managed identity the narrowly scoped role before recovery.

```sh
docker exec voqro-backend node --disable-warning=ExperimentalWarning scripts/offsite-backup.mjs recover daily/EXACT_PREFIX /var/lib/voqro/restores/NEW_DIRECTORY
```

Recovery refuses any existing destination, checks completion paths/limits, downloads and verifies the files. Do not point production at a recovered database until identity/provider configuration is restored, uncertain external jobs reconciled and application acceptance checks pass. Recovery deliberately does not start workers, reconnect accounts, send messages, publish media or overwrite live data. Password hashes and business/membership records remain private in the snapshot. `--force` on the `run` command is an explicit administrative retry that bypasses the frequency check; never put it in the scheduled service.
