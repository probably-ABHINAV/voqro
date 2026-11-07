# Persistent backend for the Vercel website

The Vercel deployment serves the website. Run this repository's Node backend as one continuously running container behind HTTPS, with a persistent local disk. It owns SQLite, private originals, derived media, authentication sessions and the durable workers. Those files must survive container replacement and redeployment.

The Docker image includes Node 24, FFmpeg/ffprobe, production npm dependencies and the online-backup command. It runs as the unprivileged `node` user (UID/GID 1000). The build context allows only application files; `.env`, `.data`, credentials, local dependencies and test output are excluded. No cloud account or hosting resources are created by these files.

## Host requirements

- One running replica and one writable persistent volume mounted at `/var/lib/voqro`. Use a local/block filesystem with reliable SQLite locking. Do not share the SQLite database across independently running instances or autoscale replicas.
- Keep the process running for scheduled work; a host that sleeps or runs only on HTTP requests delays jobs and reminders. Configure replacement deployments so only one application instance uses this volume.
- Supply HTTPS ingress to the backend's port 3000 (or the configured `PORT`). It must preserve cookies, redirects, query strings and byte-range requests. Keep request limits compatible with the app's 1 MB upload chunks and support streaming protected media responses.
- Allow HTTPS egress to the configured Cognito domain and issuer/JWKS. Add provider-specific destinations only for integrations that are explicitly enabled. If the host uses a network proxy, retain that proxy and mount its CA read-only with the relevant runtime trust settings.
- Size disk and memory against actual uploads and concurrent FFmpeg work. Budget for original media, temporary chunks, analysis files and backups; no provider price or under-US$50 guarantee is implied by the container.

## Production settings

Set these through the backend host's runtime configuration or a private Docker `--env-file`. Keep production values out of Git and the browser bundle.

| Variable | Required value |
| --- | --- |
| `DEMO_MODE` | `0`; the production image refuses shared demonstration mode |
| `APP_BASE_URL` | The exact HTTPS **Vercel production website origin**, such as `https://your-verified-domain.example`; no path or trailing URL parameters |
| `AUTH_PROVIDER` | `password` for built-in invitation accounts; omit or use `cognito` for the existing Cognito integration |
| `IDENTITY_BOOTSTRAP_SECRET` | Password mode only: a strong random setup key, supplied privately for the first owner and removed afterward |
| `COGNITO_ISSUER` | Cognito mode only: actual pool issuer, such as `https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_YOURPOOL` |
| `COGNITO_CLIENT_ID` | Cognito mode only: actual public app-client ID; authorization-code grant with PKCE and no client secret |
| `COGNITO_DOMAIN` | Cognito mode only: actual HTTPS Cognito hosted-login origin |
| `IDENTITY_BOOTSTRAP_EMAIL` | Exact email of the intended first owner; password mode does not independently verify mailbox ownership |
| `DB_PATH` | Defaults to `/var/lib/voqro/production.sqlite`; any override must stay on persistent storage |
| `UPLOAD_PATH` | Defaults to `/var/lib/voqro/uploads`; any override must stay on persistent storage |
| `PORT` / `HOST` | Default `3000` / `0.0.0.0`; match the host's ingress port |
| `COOKIE_SECURE` | `1` |

Password mode creates the first owner at `/setup` using the configured email and one-time setup key; subsequent members register with scoped invitation links. Password changes require the current password; email password recovery is not implemented. Keep keys and invitation links private.

The image validates the required identity configuration before opening the server. This is a configuration check, not proof that the provider exists or that sign-in succeeds. An empty production database contains no demo records. Never mount a demonstration database into this production container; the application's existing guard rejects it without deleting the source data.

For Cognito mode, register `${APP_BASE_URL}/api/identity/callback` as the exact Cognito callback, enable `openid email profile`, and provision the intended owner with verified email and MFA. The Vercel API routing must forward that callback to this backend under the same website origin. Production `__Host-` cookies deliberately have no `Domain` attribute. Use one stable production website origin; a different preview hostname needs its own isolated backend configuration and callback rather than sharing production cookies and data. See [production identity](identity.md) for invitations and revocation.

AWS media/AI, Instagram publication and SES delivery default to disabled in the image. AWS account setup remains separate and is currently paused. Configure optional integration values only when that integration is intentionally being enabled; do not enable them to pass a health check.

## Build and run

From the repository root on a Docker host:

```sh
docker build -t voqro-backend:local .
docker volume create voqro-data
docker run -d --name voqro-backend --init --restart unless-stopped \
  --env-file /secure/path/voqro.production.env \
  --mount type=volume,source=voqro-data,target=/var/lib/voqro \
  -p 127.0.0.1:3000:3000 \
  voqro-backend:local
```

The loopback binding is for a trusted HTTPS reverse proxy on the Docker host. On a managed container host, configure its internal port and HTTPS ingress instead of copying that port binding. The private environment file must contain real values from the settings table. `docker volume create` creates local storage only; it does not provision a cloud service. On hosts that supply bind mounts or existing volumes, arrange ownership for UID/GID 1000 before starting the non-root container. Do not make the private data directory world-writable.

For builds inside the managed Codex environment, pass its CA as a temporary BuildKit secret while keeping the supplied Docker proxy configuration:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t voqro-backend:local .
```

The optional CA secret is used only during networked build steps and is not retained in the image. A deployment using another proxy needs its own runtime CA mount and `NODE_EXTRA_CA_CERTS`; build trust does not configure runtime trust. Use the deployment platform's identity mechanism for any optional AWS API credentials.

Before routing real traffic, verify `/api/health` returns `ok: true` and `demo: false`, complete a real owner sign-in through the Vercel origin, check scoped brand/creator access, upload and retrieve a private media version, and restart the container to confirm that its records and media persist. The health endpoint alone does not verify Cognito, tenant access or paid-provider integrations.

## Backup and recovery

Run the application's consistent SQLite-and-media snapshot command against a unique new directory:

```sh
docker exec voqro-backend npm run backup -- create /var/lib/voqro/backups/backup-001
docker exec voqro-backend npm run backup -- verify /var/lib/voqro/backups/backup-001
docker cp voqro-backend:/var/lib/voqro/backups/backup-001 ./backup-001
```

Use a new snapshot name each time. Keep an encrypted copy outside the backend's disk and test recovery; a backup on the same volume does not survive loss of that volume. Schedule this with the hosting platform's private operations tooling rather than exposing a public backup endpoint.

Restore into a new directory using `npm run backup -- restore <snapshot-directory> <new-restore-directory>`, verify it, stop the old instance, and then point `DB_PATH` at the restored `voqro.sqlite` and `UPLOAD_PATH` at its `uploads` directory. The application never restores over a running database. Restored sessions/OAuth state and usable Meta tokens are removed; unfinished provider work remains held for review. Reconnect and reconcile providers before re-enabling workers that can cause external effects. See the [backup documentation](../README.md#backup-and-recovery) for the snapshot's scope.

## Validation status

The image was built locally with Node **24.22.2** and FFmpeg/ffprobe **5.1.9** using the managed proxy and temporary build CA. Container smoke checks passed for missing-identity startup refusal, non-root execution, excluded local configuration/data, an empty production database, `demo: false` health, disabled demo login, SQLite and private-file persistence across restart, FFmpeg encoding/ffprobe inspection, and online backup creation/verification. Temporary test containers and volumes were removed.

The smoke check supplied fixture identity configuration and made no provider authentication or paid API calls. Live Cognito sign-in, the deployed Vercel-to-backend connection, real private uploads through that ingress, host restart/recovery, and external provider operations still need verification on the chosen host. No external backend host, production volume or provider account was provisioned.
