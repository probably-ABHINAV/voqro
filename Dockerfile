# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS runtime-base

# The optional build secret extends HTTPS trust in managed/proxied builders.
# It is never copied into an image layer.
RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    if [ -f /run/secrets/proxy_ca ]; then \
      cat /run/secrets/proxy_ca > /tmp/voqro-build-ca.pem; \
      if [ -f /etc/ssl/certs/ca-certificates.crt ]; then cat /etc/ssl/certs/ca-certificates.crt >> /tmp/voqro-build-ca.pem; fi; \
      apt-get -o Acquire::https::CaInfo=/tmp/voqro-build-ca.pem update; \
      apt-get -o Acquire::https::CaInfo=/tmp/voqro-build-ca.pem install -y --no-install-recommends ca-certificates ffmpeg; \
      unlink /tmp/voqro-build-ca.pem; \
    else \
      apt-get update; \
      apt-get install -y --no-install-recommends ca-certificates ffmpeg; \
    fi; \
    apt-get clean; \
    find /var/lib/apt/lists -mindepth 1 -delete

WORKDIR /opt/voqro

FROM runtime-base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --strict-ssl=true --no-audit --no-fund

FROM runtime-base AS backend
ENV NODE_ENV=production \
    DEMO_MODE=0 \
    HOST=0.0.0.0 \
    PORT=3000 \
    COOKIE_SECURE=1 \
    DB_PATH=/var/lib/voqro/production.sqlite \
    UPLOAD_PATH=/var/lib/voqro/uploads \
    AWS_MEDIA_ENABLED=0 \
    AWS_AI_ENABLED=0 \
    INSTAGRAM_PUBLISH_ENABLED=0 \
    NOTIFICATION_EMAIL_ENABLED=0

COPY --from=dependencies /opt/voqro/node_modules ./node_modules
COPY package.json package-lock.json LICENSE ./
COPY *.mjs ./
COPY public ./public
COPY scripts/backup.mjs ./scripts/backup.mjs

COPY <<'JS' /usr/local/bin/voqro-start.mjs
import {identityConfig} from '/opt/voqro/identity.mjs';

const identity = identityConfig();
if (process.env.DEMO_MODE !== '0' || !identity.configured || identity.insecureLocal || (identity.provider !== 'password' && !identity.bootstrapEmail)) {
  console.error('Production container requires DEMO_MODE=0 and a valid HTTPS APP_BASE_URL with AUTH_PROVIDER=password or configured Cognito. Password first-owner setup also requires the server bootstrap email and secret.');
  process.exit(1);
}
await import('/opt/voqro/server.mjs');
JS

RUN chmod -R a+rX /opt/voqro \
    && install -d -m 0700 -o node -g node /var/lib/voqro /var/lib/voqro/uploads \
    && node --check /usr/local/bin/voqro-start.mjs \
    && node --use-env-proxy --version \
    && ffmpeg -version >/dev/null \
    && ffprobe -version >/dev/null

USER node
VOLUME ["/var/lib/voqro"]
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(async r=>{const b=await r.json();if(!r.ok||!b.ok||b.demo)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--use-env-proxy", "--disable-warning=ExperimentalWarning", "/usr/local/bin/voqro-start.mjs"]
