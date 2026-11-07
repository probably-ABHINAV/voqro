# Proposed Clerk migration — not executed

The [GitHub Student Developer Pack](https://education.github.com/pack) currently lists **Clerk Pro free while you are a student** (checked 7 November 2026). Redemption and production activation have not occurred. The user supplied Clerk setup instructions and asked whether Clerk fits Voqro; no existing authentication has been replaced.

Clerk is a useful candidate for verified email, password recovery, social sign-in and managed sessions. It does not provide electronic signatures, Instagram publishing permission, or production AI inference. Provider billing features are separate from connecting a payment processor or executing payments.

## Existing account contract

The Next.js frontend uses the Express backend's password authentication and HttpOnly sessions. `users.id` anchors roles and campaign/brand/creator ownership. `identity_accounts` maps identity to those records; `password_credentials` stores separate salts and scrypt hashes. The existing owner must retain the same application user ID and all related business records.

## Reviewable migration plan

1. Redeem the Clerk student benefit into an owner-controlled Clerk account. Select the production application and verify its domain requirements, SDK compatibility with Next16/Express5, and student-plan limits. Temporary accountless development keys alone are not a production migration.
2. Prepare an isolated development/staging integration first. Add Clerk to both Next.js and Express. Verify session issuer, signature, intended audience/authorized frontend parties and expiry on the backend; never trust browser role claims.
3. Preserve Voqro's `users.id`, memberships, invitations and all business records. Map the stable Clerk subject to that existing application identity. Keep agency authorization in Voqro rather than assuming a Clerk organization role equals a brand/creator role.
4. Verify Clerk's current support for the application's exact scrypt parameters and encoding before proposing a password import. Do not export real password hashes merely to investigate compatibility. If unsupported, use verified account enrollment/recovery and explicit owner-approved linking; never silently merge accounts based only on a matching email address.
5. Require owner reauthentication before account linking, test both the Next frontend and Express API, and retain a rollback path. Test brand/creator isolation, revoked memberships, invitation reuse, OAuth callbacks, password recovery and private media access.
6. Switch production only after the owner migration plan is approved and the user can access the existing workspace through Clerk. Define session cutover and password-account retirement deliberately; do not remove existing sessions or credentials during unapproved setup.

The supplied setup guide explicitly says: “Do not modify or remove existing auth without approval.” Therefore `clerk init` has not been run against the live application. The completed Azure AI integration is independent of this migration.
