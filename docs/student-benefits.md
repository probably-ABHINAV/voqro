# GitHub Student Developer Pack: Voqro benefit plan

Reviewed **7 November 2026** against the [official Pack](https://education.github.com/pack): **83 offer cards**. This is a research inventory, not a record of redeemed subscriptions. Azure for Students is already active. Clerk authentication is live, but redemption of the student Pro offer has not been verified. No new provider was activated by this review.

## Recommended activation order

| Priority | Offer currently advertised | Use in Voqro | Decision / limit |
| --- | --- | --- | --- |
| 1 | [Clerk](https://education.github.com/pack#clerk): Pro free while a student | Existing sign-in, profiles and sessions | Redeem against the existing Clerk application/account. Keep a single login; business roles and workspaces remain in Voqro. Do not re-enable Clerk Organizations just to use this offer. Check included quotas and add-ons. |
| 2 | [Sentry](https://education.github.com/pack#sentry): 50K errors, 100K transactions, 1GB attachments, 500 replays, Team features; one year, renewable; on-demand disabled | Next.js and Express production errors | Add scrubbed error reporting. Leave session replay disabled initially and exclude tokens, private documents and personal data. |
| 3 | [Datadog](https://education.github.com/pack#datadog): Pro including 10 servers, free two years | Azure VM CPU, memory, disk and service monitoring | One small monitoring installation, with an alert recipient. Pro does not imply every logs/APM add-on is included. Measure agent memory use on the small VM. |
| 4 | [SimpleAnalytics](https://education.github.com/pack#simpleanalytics): Starter one year, 100K page views/month | Public website traffic and conversion events | Measure visitor → enquiry → signup. This does not supply verified Instagram campaign results. |
| 5 | [Name.com](https://education.github.com/pack#namecom): select free domain from 25+ extensions | Branded public URL and production login domain | Check availability, eligible extension, included term and renewal before registering. The offer does not guarantee voqro.social. Coordinate Vercel, Clerk and OAuth URLs when changing domain. |
| 6 | [BrowserStack](https://education.github.com/pack#browserstack): Automate Mobile, one parallel session and one user for one year | Test signup, creator uploads and brand approvals on real mobile devices | Redeem when ready to run mobile QA; it is not an unlimited team license. |
| 7 | [Testmail](https://education.github.com/pack#testmail): Essential while a student | Automated signup and recovery email tests | Testing inboxes, not production email sending. |
| 8 | [1Password](https://education.github.com/pack#1password): two years including Developer Tools | Provider account recovery and human access to credentials | Runtime secrets remain in Azure Key Vault; do not copy credentials into chat or Git. |
| 9 | [Codecov](https://education.github.com/pack#codecov): public/private repository access | Spot untested changes in workflow and permission code | Connect to existing meaningful tests; coverage is not proof of correctness. |
| 10 | [Stripe](https://education.github.com/pack#stripe): $25 credits against product fees | Payments and billing if an eligible business account is approved | India accounts are currently invite-only. Credits do not bypass account eligibility, KYC or provider fees after the credit is spent. |

Azure stays the primary backend, database, private upload, backup and AI platform for now; Vercel stays the frontend. The original Azure grant is $100, not a claim about today's remaining balance. Student credit is finite and existing service costs still count against it.

## Other useful benefits, activated when needed

| Benefit | Verified Pack offer | Appropriate use |
| --- | --- | --- |
| Heroku | $13/month for 24 months | Later staging or a deliberate Postgres/worker plan. Not an automatic migration of the existing SQLite/private upload backend. |
| Honeybadger | Small account free one year | Alternative error/uptime/cron monitoring, including a possible backup heartbeat. Choose a coherent monitoring setup rather than collecting overlapping tools. |
| New Relic | Free while a student; advertised $300/month value | Alternative observability stack; this is not transferable cloud credit. |
| Camber | Student plan while enrolled: 40 compute hours, 50GB storage, 50 agent messages/month | Campaign data analysis and long-running data work. Its jobs can continue after a laptop closes; this does not make this ChatGPT session run indefinitely. |
| GitHub Pro / Codespaces / Copilot Student | Pro while a student, Pro-level Codespaces access, Copilot Student allowance | Repository and cloud development. Codespaces has usage limits. Current Copilot wording promises unlimited completions with limited chat/agent usage and auto-selected models, not unlimited premium AI. |
| MongoDB Atlas | $50 credit; free certification also advertised | Future document-data experiments, not a reason to replace a working relational workflow. Certification value is not hosting credit. |
| Appwrite | Two education projects with Pro-equivalent limits for six months | Isolated prototypes. No reason to duplicate Clerk, Express and Azure merely to redeem it. |
| Deepnote | Team plan while a student; basic machines up to 5GB RAM / 2 vCPU | Collaborative analysis experiments with approved datasets. |
| Polypane / LambdaTest | Individual / Live plan respectively for one year | Responsive and accessibility review / manual cross-browser QA. Use according to actual gaps in existing tests. |
| Requestly | Professional plan for one year | Test webhook failures and API responses without pretending mocked providers are connected. |
| Doppler | Team plan while an active student | Optional local/staging secret management. Avoid duplicating existing runtime secret storage unnecessarily. |
| ConfigCat / DevCycle | ConfigCat: 1,000 flags, unlimited users; DevCycle: Starter for one year | Optional staged feature rollout. Choose one only if release complexity warrants it. |
| IconScout / Icons8 / Visme | 60 premium icons/month for one year / three months / Starter three months | Agency visuals, proposals and media kits; check asset licensing for commercial use and client redistribution. |
| Notion | Education plan with Plus features and additional AI responses | Agency procedures and planning; not unlimited AI or a promise of free seats for the whole agency. |
| POEditor | Plus one year | Hindi/English localization when ready. |
| FrontendMasters / Educative / Boot.dev / DataCamp | Six / six / three / three months | Targeted Next.js, backend and data skills. Start short offers when there is time to use them. |
| LocalStack | Free license to the advertised AWS emulator | Future AWS integration tests. AWS is currently paused; this is not a production AWS credit. |

Domain alternatives: Namecheap advertises a **.me domain for one year**, and .TECH a **standard .tech domain for one year**. Choose a useful name rather than registering unnecessary domains with future renewal costs. Vercel already provides HTTPS; the Pack SSL offer adds no immediate value here.

## Credit arithmetic and important terms

Azure $100 + Heroku $13 × 24 ($312) + MongoDB $50 + Stripe $25 = **$487 in advertised service-credit face value**. These are separate, conditional offers with different periods and uses, not cash or a single budget. Azure is already active, so the total is not all new benefit. Actual savings depend on use and eligibility.

The [Heroku student FAQ](https://www.heroku.com/github-students/) requires a valid credit/debit card, charges excess usage, excludes third-party add-ons, and says unused monthly credits expire rather than roll over. Activation begins on the first day of the current month; redeeming near the beginning of a month preserves more useful time. Dyno local storage is ephemeral and cannot directly replace Voqro's persistent SQLite and upload storage.

[Stripe's official India support notice](https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india) identifies India accounts as invite-only. Confirm access before treating Stripe as the production payment solution.

Check each provider's commercial-use, individual-seat, renewal and usage terms before applying a student license to agency work. A free personal developer license does not automatically license all agency staff. The [Azure offer terms](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p/) describe the credit period and eligibility; their separate Software Download Benefits restrictions should not be confused with a blanket restriction on all cloud credit usage.

## What the Pack does not resolve

- No production e-signature provider offer was found among the current cards. Signing-provider selection and an eligible live plan remain necessary.
- Instagram still needs the professional account, Meta app, permissions and explicit account authorization. A developer-tool benefit does not grant Instagram API access.
- Copilot Student and Camber are not a general production AI API entitlement for Voqro users. Existing Azure OpenAI usage is metered separately.
- Testmail does not replace a production transactional email sender.
- No Vercel Pro or DigitalOcean offer was found on the current page. Do not rely on older promotional lists.

## Redemption and status

Open [GitHub Education benefits](https://github.com/settings/education/benefits) with the approved student account, select the offer, and follow the partner's redemption flow. For Clerk, use the existing account/application. For any integration, place provider credentials in secure environment settings, never in chat or the repository.

Recommended sequence: **Clerk Pro → Sentry → infrastructure/uptime alerts → SimpleAnalytics → domain → mobile/email QA**. Activate short-duration design and course subscriptions only when ready. Evaluate Stripe after confirming India account eligibility; reserve Heroku for a concrete workload.

## Complete current offer inventory

The entries below preserve the offer text from the public Pack cards, excluding descriptions and category tags. They are a dated listing, not verification that each offer is redeemable by this account.

| Partner | Advertised offer text |
| --- | --- |
| [Namecheap](https://education.github.com/pack#namecheap) | #1 1 year domain name registration on the .me TLD. |
| [Name.com](https://education.github.com/pack#namecom) | Build your project on a select free domain with over 25 domain extensions like .live, .studio, .software, .app, and .dev. Be sure your Name.com account includes a unique address, otherwise the system may assume your request is a duplicate. |
| [Microsoft Azure](https://education.github.com/pack#microsoft) | Free access to 25+ Microsoft Azure cloud services plus $100 in Azure credit. For students aged 18+. |
| [.TECH](https://education.github.com/pack#tech) | One standard .TECH domain free for 1 year. |
| [Microsoft 365](https://education.github.com/pack#microsoft-365) | Students can now get free or discounted access to our powerful productivity apps with AI built in, 1TB of cloud Storage, and and advanced security for your data and devices. Sign up today to unlock all your benefits. |
| [GitHub](https://education.github.com/pack#github) | Free GitHub Pro while you are a student. |
| [Notion](https://education.github.com/pack#notion) | Everything in the Notion Education plan with additional AI responses. Notion Education plan offers everything in our Plus plan + increased sharing & collaboration capabilities and longer page history. |
| [DataCamp](https://education.github.com/pack#datacamp) | DataCamp has partnered with GitHub Education to offer three months of free access when you sign up for a DataCamp subscription with your GitHub student account. |
| [GitHub Copilot](https://education.github.com/pack#github-copilot) | GitHub Copilot Student is available to verified students. The plan includes unlimited code completions and an allowance of GitHub AI Credits, plus limited chat and agent usage with models available through auto model selection only. |
| [Heroku](https://education.github.com/pack#heroku) | Enjoy a credit of $13 USD per month for 24 months. |
| [JetBrains](https://education.github.com/pack#jetbrains) | A free subscription for students, to be renewed annually. |
| [Boot.dev](https://education.github.com/pack#boot-dev) | Master Python, Golang, TypeScript and more in our immersive programming curriculum. Learn Backend Development, DevOps, and Data Analysis with 3 months of free access to Boot.dev’s complete interactive membership. |
| [1Password](https://education.github.com/pack#1password) | Get 1Password free for 2 years, including 1Password Developer Tools |
| [Testmail](https://education.github.com/pack#testmail) | Free Essential plan while you're a student. |
| [Termius](https://education.github.com/pack#termius) | Free access to all Termius Pro and Termius Team features, while you're a student. |
| [Microsoft Azure (for ages 13-17)](https://education.github.com/pack#microsoft-azure-13-17) | For students age 13-17. Free access to Azure App Services, Azure Functions, Notification Hubs, MySQL database from MySQL in-app, Application Insights, Azure DevOps. |
| [Codedex](https://education.github.com/pack#codedex) | Effective Nov. 1: Verified students receive 1 month of Codédex Club, a premium membership for free. |
| [Educative](https://education.github.com/pack#educative) | Dive into 6 months of free access to over 70 practical courses, covering hot topics like Web Development, Python, Java, and Machine Learning. Plus, students enjoy an awesome 30% discount on any subscription they pick! |
| [Datadog](https://education.github.com/pack#datadog) | Pro Account, including 10 servers. Free for 2 years. |
| [MongoDB](https://education.github.com/pack#mongodb) | $50 in MongoDB Atlas Credits, plus access to MongoDB Compass and MongoDB University including free certification valued at $150. |
| [Camber](https://education.github.com/pack#cambercloud) | Free Camber Student plan for as long as you're enrolled. Camber is a coding agent built for data and scientific work: connect Postgres, Trino, or S3, and have it write, debug, and run real analysis against your own data. Drive it from Cursor or Claude Code via the Camber MCP server, or from the browser. Long jobs keep running in the cloud after you close your laptop. Includes 40 compute hours, 50 GB storage, and 50 agent messages per month. |
| [GitHub Codespaces](https://education.github.com/pack#github-codespaces) | Free Pro level access to Codespaces to use anywhere in your account. |
| [Stripe](https://education.github.com/pack#stripe) | Get $25 in Stripe credits to offset fees on products including Stripe Payments, Billing, and more. |
| [GitHub Pages](https://education.github.com/pack#github-pages) | Get one site per GitHub account and organization, and unlimited project sites. |
| [Visual Studio Code](https://education.github.com/pack#student-vscode) | These coding packs help you download everything you need to start coding in Java, Python, or .NET. |
| [Microsoft Visual Studio Dev Essentials](https://education.github.com/pack#microsoftvisualstudio) | Visual Studio Community, Visual Studio Community for Mac, access to Pluralsight training, 1 free year of Azure services with $200 credit for the 1st month and more. |
| [Clerk](https://education.github.com/pack#clerk) | Free Pro plan while you're a student. |
| [Notion Template Collection](https://education.github.com/pack#notion-templates) | From setting up your CS course dashboard to running your hackathons to building your portfolios — this collection of templates has got you covered, in the classroom and beyond. |
| [Sentry](https://education.github.com/pack#sentry) | Students enjoy: 50K errors, 100K transactions, 1GB attachments, 500 replays, Team features, 1 yr limit (can renew), Disabled On-demand |
| [FrontendMasters](https://education.github.com/pack#frontendmasters) | Free 6-months access to all courses and workshops. |
| [Github Campus Experts](https://education.github.com/pack#github-campus-experts) | Apply to become part of the program while you’re a student. |
| [PomoDone](https://education.github.com/pack#pomodone) | PomoDone Lite plan free for 2-years. |
| [LocalStack](https://education.github.com/pack#localstack) | Free license to LocalStack’s most powerful AWS emulator in a ready-to-use cloud environment |
| [Icons8](https://education.github.com/pack#icons8) | Free 3-month subscription that includes: icons, photos, illustrations, and music. |
| [BrowserStack](https://education.github.com/pack#browserstack) | Free Automate Mobile Plan for 1 parallel and 1 user for 1 year. |
| [New Relic](https://education.github.com/pack#newrelic) | Free New Relic while you are a student. ($300/month value) |
| [Bootstrap Studio](https://education.github.com/pack#bootstrapstudio) | A free license for Bootstrap Studio while you are a student. |
| [Deepnote](https://education.github.com/pack#deepnote) | Our offer includes free use of the Deepnote Team plan while you are a student. The Deepnote Team Plan includes: Unlimited team members & projects, 30-day version history, unlimited basic machines with up to 5GB RAM and 2vCPU, premium integrations (Snowflake, SQL Server, BigQuery, Redshift, and more), and 30-day revision history. |
| [Appwrite](https://education.github.com/pack#appwrite) | Free access to Appwrite's Education plan (2 projects with equivalent resource limits as Appwrite Pro, worth $40/month) for six months. |
| [Polypane](https://education.github.com/pack#polypane) | You'll get free use of Polypane's individual plan for 1 year. |
| [Zyte](https://education.github.com/pack#scrapinghub) | 1 Free Forever Scrapy Cloud Unit - unlimited team members, projects or requests. Unlimited crawl time and 120 day data retention. |
| [Arduino](https://education.github.com/pack#arduino) | Free Arduino Cloud for 6 months and discounts on selected hardware. |
| [CodeScene](https://education.github.com/pack#codescene) | A free Student account to analyze private GitHub repositories. |
| [HazeOver](https://education.github.com/pack#hazeover) | Free app license, including minor updates. |
| [GitLens](https://education.github.com/pack#gitlens) | The GitKraken Student plan: free for 6 months and then up to 80% off the Pro price as long as you’re a student. |
| [LambdaTest](https://education.github.com/pack#lambdatest) | Free LambdaTest Live Plan for one year. |
| [Visme](https://education.github.com/pack#visme) | Get 3 free months free access to Visme's Starter plan. |
| [Scrimba](https://education.github.com/pack#scrimba) | Level up your coding skills with interactive courses, projects, and challenges. Learn JavaScript, CSS, React, Python, and more. Enjoy 1 month of free access to Full access to Scrimba’s Pro courses, projects, and coding challenges, which includes 40+ courses. |
| [Pageclip](https://education.github.com/pack#pageclip) | Free basic plan while you are a student. |
| [Blackfire](https://education.github.com/pack#blackfire) | Free Developer subscription for students. |
| [Adafruit](https://education.github.com/pack#adafruit) | One year of Adafruit IO+ and discounts on selected hardware. |
| [IconScout](https://education.github.com/pack#iconscout) | Free access to 60 premium icons from selected contributors every month for 1 year. |
| [Doppler](https://education.github.com/pack#doppler) | Free Doppler Team subscription while the user is an active student. |
| [Octicons](https://education.github.com/pack#octicons) | Using Figma designs to build the Octicons icon library |
| [Travis CI](https://education.github.com/pack#travis) | Private builds for free while you're a student. |
| [Requestly](https://education.github.com/pack#requestly) | Requestly Professional plan (worth $270) free for one year. |
| [AlgoExpert](https://education.github.com/pack#algoexpert) | Free access to 20 coding interview questions on AlgoExpert as well as a 10% discount on all AlgoExpert products. |
| [GitHub Desktop](https://education.github.com/pack#ghdesktop) | Open Source by GitHub, free for everyone. |
| [ToDiagram](https://education.github.com/pack#todiagram) | ToDiagram Pro Plan including full editor access, no data limits, and up to 10 documents stored in the cloud. This offer does not include AI-assistant functionality. |
| [Codecov](https://education.github.com/pack#codecov) | Free access to Codecov on public and private repositories. |
| [CARTO](https://education.github.com/pack#cartodb) | Free account upgrades with increased database storage, real time data, Location Data Services Credits, and premium features for 2 years. |
| [Imgbot](https://education.github.com/pack#imgbot) | Free image optimization for all your public and private projects while you are a student. |
| [GitKraken](https://education.github.com/pack#gitkraken) | The GitKraken Student Plan: Free for 6 months and then up to 80% off the Pro price as long as you’re a student. |
| [AstraSecurity](https://education.github.com/pack#astra) | 6 month access to website firewall & malware scanner |
| [WorkingCopy](https://education.github.com/pack#workingcopy) | All Pro features for free while you are a student. |
| [GoRails](https://education.github.com/pack#gorails) | Free access to all videos and lessons for 12 months. |
| [SQLGate](https://education.github.com/pack#sqlgate) | Access to most Standard Subscription features for 1 year. |
| [Xojo](https://education.github.com/pack#xojo) | Xojo Pro license free while you are a student. |
| [PopSQL](https://education.github.com/pack#popsql) | Free Premium subscription for PopSQL while you're a student. |
| [Tower](https://education.github.com/pack#tower) | Free license for Tower Pro while you are a student. |
| [Blockchair](https://education.github.com/pack#blockchair) | 100,000 free requests. |
| [InterviewCake](https://education.github.com/pack#interviewcake) | Access to the full coding interview prep course for 1 week. |
| [Vaadin](https://education.github.com/pack#vaadin) | Free Pro subscription license to access the commercial components and tools. |
| [POEditor](https://education.github.com/pack#poeditor) | Plus Plan for free for one year. |
| [Honeybadger](https://education.github.com/pack#honeybadger) | Free Small account for 1 year. |
| [DeepScan](https://education.github.com/pack#deepscan) | Free 6-month trial while you are a student. |
| [ConfigCat](https://education.github.com/pack#configcat) | 1000 feature flags, ∞ users for free. |
| [DevCycle](https://education.github.com/pack#devcycle) | 1 Free Year on our Starter Plan to Verified Students. Includes unlimited seats, unlimited feature flags, and unlimited usage. |
| [Themeisle](https://education.github.com/pack#themeisle) | Free year of Neve Agency WordPress theme exclusively for students. |
| [SimpleAnalytics](https://education.github.com/pack#simpleanalytics) | Starter plan free for one year, including 100k page views per month. |
| [Appfigures](https://education.github.com/pack#appfigures) | "Free access to universal analytics and performance reports for one year. |
| [SymfonyCasts](https://education.github.com/pack#symfonycasts) | Free 3-month subscription for students. |
| [Dashlane](https://education.github.com/pack#dashlane) | Dashlane Premium free for 6 months. |
