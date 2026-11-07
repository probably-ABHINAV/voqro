# Automated release and availability checks

## GitHub release checks

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests and manual dispatch. The job uses Node.js 24, both lockfiles, pinned GitHub-maintained actions, read-only repository permission and no application/provider secrets. It runs:

1. JavaScript syntax validation and the complete backend suite, including authorization, Clerk identity, invoices, media, backups and restored-application acceptance.
2. Frontend TypeScript checks.
3. All modern browser workflows against a temporary local database and synthetic accounts, with cloud AI, publishing and email disabled.
4. A production-mode Next.js build with the configured public backend origin. Clerk UI is disabled in this secret-free build; real Clerk sign-in still needs separate production verification.

Failed browser traces contain only the synthetic local test data and are retained for three days. Pull requests do not receive deployment credentials. The checks report regressions; this workflow does not change branch protection or make Vercel wait for CI. Vercel's existing Git integration continues to manage deployments independently.

## Public availability checks

`.github/workflows/availability.yml` schedules six unauthenticated GET checks at minutes 17 and 47 of each hour, and allows a manual run:

- Vercel homepage and login return Voqro HTML with HTTP 200.
- Frontend-proxied API and direct Azure backend return production health JSON.
- Public identity configuration still specifies Clerk, verified-email open signup, optional Brand/Creator selection and one agency.
- Private workspace returns only a JSON authentication error with HTTP 401.
- Every API response carries `Cache-Control: no-store`.

Run the same checks locally with:

```sh
node --use-env-proxy scripts/check-production.mjs
```

Each request has a 15-second deadline and a 2 MiB body ceiling. Redirects fail instead of silently following a login wall or replacement host. Logs contain check names, durations and bounded validation errors, not response bodies or raw transport exceptions. The checks do not sign in, submit forms, inspect private data, write records or call providers on behalf of users.

Failed checks produce a failed GitHub Actions run. Notification delivery depends on the repository owner's existing GitHub Actions notification settings; no external email, SMS or webhook destination has been configured or delivery-tested. GitHub schedules can be delayed and scheduled workflows in inactive public repositories can be disabled. This is a low-cost periodic check, not continuous monitoring or an availability guarantee. It does not detect disk exhaustion, stalled workers, backup age, or authenticated UI failures; a dedicated monitoring integration remains useful.

## Restored application acceptance

`tests/recovery-application.test.mjs` creates synthetic production-mode password accounts in an isolated database, takes a live WAL backup, and starts a second Express application on its restored copy. It verifies:

- Existing sessions are rejected and a fresh login succeeds without re-running owner setup.
- Brand, campaign and exact invoice amounts survive recovery.
- Completed private video bytes and HTTP range playback survive recovery.
- Unauthenticated users and an unrelated brand cannot read the recovered media/invoice.
- New writes and sessions in the recovered application do not change the original live fixture or saved snapshot.

The password fixture avoids using production Clerk credentials. Separate Clerk tests cover signed token verification, verified email, membership mapping, revocation and optional signup profiles. This test does not establish a real Clerk re-login after restoring production data. Existing off-site backup verification covers actual Azure upload/readback and isolated file/database restoration; a supervised production-identity recovery exercise and cross-region recovery remain separate acceptance work.
