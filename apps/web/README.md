# Voqro web application

This is the React application for the real Voqro API: Next.js App Router, TypeScript and Tailwind CSS. It does not load the browser-only preview adapter or keep business records in localStorage.

## Development

From the repository root, use the full-stack development launcher documented in the root README. To run the frontend independently:

```bash
npm ci --prefix apps/web
VOQRO_BACKEND_ORIGIN=http://127.0.0.1:3001 npm run dev --prefix apps/web -- --port 3000
```

The backend's `APP_BASE_URL` must match the frontend origin. The default development rewrite targets `http://127.0.0.1:3001`. HTTP localhost password authentication needs the backend's explicit `AUTH_ALLOW_INSECURE_LOCAL=1` development setting.

## Deployment

Set the Vercel project root directory to `apps/web`, use the Next.js framework preset and configure `VOQRO_BACKEND_ORIGIN` with the persistent backend's public HTTPS origin. Use `npm ci` and `npm run build` in this directory. Do not publish a rewrite pointing at localhost or a fixture host. Local artifact builds can run without a backend, but a Vercel production build refuses to proceed without `VOQRO_BACKEND_ORIGIN`. A configured origin and successful frontend build do not establish backend reachability or a functioning full application; verify the deployed workflows against that backend.

The frontend routes `/api/*` to the backend without changing the API contracts. API responses are not cached. Authentication uses backend-issued HttpOnly cookies, and all authorization remains on the server. Invitation tokens are read from a URL fragment, removed from the address bar, and kept only in component memory while the registration form is open.

## Checks

```bash
npm run typecheck --prefix apps/web
npm run build --prefix apps/web
```

The repository's modern browser suite verifies complete workflows against an isolated real Express backend. Static sample-preview tests exercise a different application mode and are not evidence for this frontend.
