# GitHub Student Developer Pack for Voqro

Offer inventory checked on 7 November 2026 against the [official GitHub Student Developer Pack](https://education.github.com/pack). Offers require individual eligibility/redemption and can change. A listing is not evidence that an account has been activated. No new paid subscription or billing upgrade was purchased.

| Benefit currently listed | Practical use for Voqro | Current status |
| --- | --- | --- |
| Azure: $100 credit and 25+ free services | Existing backend, persistent media/database, and metered Azure OpenAI | Student subscription already active; spending limit On. Credit is finite. |
| Name.com: one select domain among 25+ extensions | A branded frontend domain | Needs the owner's domain choice and redemption. Changing the canonical domain also needs auth/OAuth configuration changes. |
| Namecheap: .me registration for one year; .TECH: one standard domain for one year | Alternative domain options | Choose one useful domain; check renewal prices before claiming. Vercel/Caddy already supply HTTPS, so a separate SSL certificate is unnecessary. |
| Sentry: 50K errors, 100K transactions, 1GB attachments, 500 replays, Team features, one-year renewable offer, on-demand disabled | Production error monitoring | Needs redemption and project connection. Start with error monitoring; avoid recording private agency forms or enabling session replay by default. |
| BrowserStack: Automate Mobile, one parallel session and one user for one year | Real mobile/device QA beyond existing local Chromium tests | Needs redemption and a secure automation connection. |
| Testmail: Essential plan while a student | Test invitation and password-recovery email delivery once implemented | Testing inboxes, not a production transactional-email sending service. |
| 1Password: two years including Developer Tools | Human ownership and recovery of provider credentials | Optional owner redemption. Existing runtime secrets stay in Azure's secure infrastructure. |
| Clerk Pro free while a student | Verified identity, password recovery, social sign-in and managed sessions | Valuable next authentication migration; existing owner ID, roles and records must be preserved. Not activated. |
| GitHub Pro while a student; Copilot Student | Repository collaboration and coding assistance | Copilot student access is not a production model API entitlement for Voqro users. |
| Heroku: $13/month for 24 months | Possible later hosted-service alternative | Do not duplicate the working Azure backend solely to consume another benefit. SQLite and uploads need durable storage; ordinary ephemeral dyno storage is unsuitable. |
| MongoDB Atlas: $50 credit | Potential future document-database work | No migration needed: Voqro's current relational workflow and SQLite database already work. |
| New Relic: student offer | Alternative observability | Prefer one monitoring service initially rather than duplicating Sentry and telemetry. |

No DocuSign, Dropbox Sign, PandaDoc or other electronic-signature provider offer was found in the current pack page. This does not prove no separate promotion exists. A free developer signing sandbox is useful for integration tests but does not establish a production signing entitlement. Provider selection, account authorization, exact document/recipient approval and live plan eligibility remain separate steps.

## Immediate activation boundaries

- Instagram: the owner has not yet created the professional account or Meta developer app. The existing adapter uses Facebook Login, requiring a linked Facebook Page and the app's approved permissions. Register `https://voqro.vercel.app/api/instagram/oauth/callback`; configure secrets securely, then authorize and select the account in Voqro. Keep publishing disabled until provider access, private-media delivery and an explicitly approved post are ready.
- AI: Azure OpenAI in UAE North supports the selected `gpt-4.1-mini` GlobalStandard deployment. GlobalStandard can process globally; the database remains in Central India. No provisioned-capacity or fine-tuned hosting meter was selected. See [Azure AI](azure-ai.md) for exact coverage and limits.
- Signing: no provider account is connected. Existing agreement acknowledgements must remain labelled as acknowledgements. Never mark an agreement signed merely because an email or signing link was created.

Redeem benefits from the official pack page using the owner's GitHub account. Provider passwords, API keys, OAuth codes and recovery codes must not be pasted into chat. Domain registration, provider redemption and third-party consent may require the human account owner; the current chat has no authenticated provider browser tools for those services.

## Signing cost check

The [DocuSeal pricing page](https://www.docuseal.com/pricing), checked on the same date, lists a free Basic web plan with 10 request emails per month. Its production API/embedding requires a Pro seat (US$20/month) plus US$0.20 per completed document; sandbox API documents are free. Free web signing therefore must not be represented as a free production API integration. No DocuSeal subscription, signing request or recipient email was created.

Clerk migration details are recorded in [the proposed migration plan](clerk-migration.md). Current login remains unchanged.
