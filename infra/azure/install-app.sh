#!/usr/bin/env bash
# Run on the VM as root using Azure VM Run Command, after infrastructure approval.
# The reviewed /etc/voqro/backend.env must already exist; it is never printed.
set -euo pipefail
umask 077
if [ "$#" != 2 ]; then echo 'Usage: install-app.sh <azure-public-dns-hostname> <full-github-commit-sha>' >&2; exit 2; fi
backend_hostname=$1
source_commit=$2
[[ "$backend_hostname" =~ ^[a-z0-9][a-z0-9.-]+\.cloudapp\.azure\.com$ ]] || { echo 'Use the assigned Azure public DNS hostname.' >&2; exit 2; }
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Use an exact committed source SHA.' >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo 'Run through Azure VM Run Command as root.' >&2; exit 2; }
mountpoint -q /var/lib/voqro || { echo 'Persistent data disk is not mounted; application startup refused.' >&2; exit 1; }
[ "$(findmnt -n -o FSTYPE --target /var/lib/voqro)" = ext4 ] || { echo 'Expected local ext4 storage; do not use SMB/NFS for SQLite WAL.' >&2; exit 1; }
[ -f /etc/voqro/backend.env ] && [ "$(stat -c '%U:%a' /etc/voqro/backend.env)" = 'root:600' ] || { echo 'Create the reviewed root-owned 0600 /etc/voqro/backend.env first.' >&2; exit 1; }
python3 - <<'PY'
from pathlib import Path
from urllib.parse import urlsplit
values={}
for line in Path('/etc/voqro/backend.env').read_text().splitlines():
    if not line or line.startswith('#'): continue
    key,sep,value=line.partition('=')
    assert sep and key.strip()==key, 'Use KEY=value lines in backend.env.'
    values[key]=value
assert values.get('DEMO_MODE')=='0', 'DEMO_MODE=0 is required.'
assert values.get('AUTH_PROVIDER')=='password', 'This deployment uses explicit password identity.'
u=urlsplit(values.get('APP_BASE_URL',''))
assert u.scheme=='https' and u.hostname and not u.username and not u.password and u.path in ('','/') and not u.query and not u.fragment, 'APP_BASE_URL must be the exact public Vercel HTTPS origin.'
assert '@' in values.get('IDENTITY_BOOTSTRAP_EMAIL',''), 'An explicit initial owner email is required.'
secret=values.get('IDENTITY_BOOTSTRAP_SECRET','')
if secret:
    assert len(secret)>=32, 'Use a strong bootstrap secret.'
else:
    import sqlite3
    try:
        connection=sqlite3.connect('file:/var/lib/voqro/production.sqlite?mode=ro', uri=True)
        with connection:
            initialized=connection.execute("SELECT 1 FROM identity_bootstrap WHERE id=1 AND EXISTS (SELECT 1 FROM users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.role='owner' AND a.status='Active')").fetchone()
        connection.close()
    except sqlite3.Error:
        initialized=None
    assert initialized, 'First owner setup requires a strong bootstrap secret; an initialized agency can omit it.'
assert values.get('COOKIE_SECURE','1')=='1' and values.get('AUTH_ALLOW_INSECURE_LOCAL','0')!='1', 'Production cookies must remain Secure.'
assert values.get('DB_PATH','/var/lib/voqro/production.sqlite')=='/var/lib/voqro/production.sqlite', 'Use the mounted persistent database path.'
assert values.get('UPLOAD_PATH','/var/lib/voqro/uploads')=='/var/lib/voqro/uploads', 'Use the mounted private upload path.'
PY
release_dir="/opt/voqro/releases/$source_commit"
if [ ! -d "$release_dir/.git" ]; then
  [ ! -e "$release_dir" ] || { echo 'Release path exists without expected Git metadata.' >&2; exit 1; }
  install -d -m 0755 "$release_dir"
  git -C "$release_dir" init --quiet
  git -C "$release_dir" remote add origin https://github.com/probably-ABHINAV/voqro.git
  git -C "$release_dir" fetch --quiet --depth 1 origin "$source_commit"
  git -C "$release_dir" checkout --quiet --detach "$source_commit"
fi
[ "$(git -C "$release_dir" rev-parse HEAD)" = "$source_commit" ] || { echo 'Release SHA mismatch.' >&2; exit 1; }
[ -z "$(git -C "$release_dir" status --porcelain)" ] || { echo 'Release source has local modifications; refusing deployment.' >&2; exit 1; }
image_name="voqro-backend:$source_commit"
caddy_image="caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d"
DOCKER_BUILDKIT=1 docker build --pull --target backend --tag "$image_name" "$release_dir"
docker network inspect voqro >/dev/null 2>&1 || docker network create voqro >/dev/null
if docker container inspect voqro-backend-previous >/dev/null 2>&1; then echo 'Resolve the existing previous container before another deployment.' >&2; exit 1; fi
had_previous=0
if docker container inspect voqro-backend >/dev/null 2>&1; then
  docker stop --time 30 voqro-backend >/dev/null
  docker rename voqro-backend voqro-backend-previous
  had_previous=1
fi
rollback(){
  docker rm --force voqro-backend >/dev/null 2>&1 || true
  if [ "$had_previous" = 1 ]; then docker rename voqro-backend-previous voqro-backend; docker start voqro-backend >/dev/null; fi
  echo 'New container did not pass health checks. Previous container restored when available; persistent records were not deleted.' >&2
}
if ! docker run --detach --name voqro-backend --restart unless-stopped --network voqro --publish 127.0.0.1:3000:3000 --env-file /etc/voqro/backend.env --mount type=bind,source=/var/lib/voqro,target=/var/lib/voqro --log-opt max-size=10m --log-opt max-file=3 "$image_name" >/dev/null; then rollback; exit 1; fi
healthy=0
for attempt in $(seq 1 20); do
  if docker exec voqro-backend node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(2000)}).then(async r=>{const b=await r.json();if(!r.ok||!b.ok||b.demo)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" != 1 ]; then rollback; exit 1; fi
if [ "$had_previous" = 1 ]; then docker rm voqro-backend-previous >/dev/null; fi
install -d -m 0700 /etc/voqro/caddy /var/lib/voqro-proxy/data /var/lib/voqro-proxy/config
printf '%s {\n  encode zstd gzip\n  reverse_proxy voqro-backend:3000\n}\n' "$backend_hostname" > /etc/voqro/caddy/Caddyfile
# Caddy owns ACME HTTPS. No inbound SSH or application port is opened.
docker pull "$caddy_image"
if docker container inspect voqro-caddy >/dev/null 2>&1; then docker rm --force voqro-caddy >/dev/null; fi
docker run --detach --name voqro-caddy --restart unless-stopped --network voqro --publish 80:80 --publish 443:443 --mount type=bind,source=/etc/voqro/caddy/Caddyfile,target=/etc/caddy/Caddyfile,readonly --mount type=bind,source=/var/lib/voqro-proxy/data,target=/data --mount type=bind,source=/var/lib/voqro-proxy/config,target=/config --log-opt max-size=10m --log-opt max-file=3 "$caddy_image" >/dev/null
printf 'Backend container is healthy. Verify HTTPS and ownership before setting Vercel backend origin: https://%s/api/health\n' "$backend_hostname"
