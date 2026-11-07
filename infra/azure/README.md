# Azure for Students backend

This is a deployment preparation for the real Express/Node backend. Vercel hosts the Next.js frontend; one Azure Linux VM hosts the backend, SQLite database, private media, FFmpeg and durable workers. It does not run the public sample adapter. No Azure resources or billing changes are made by these files.

## Credits and realistic sizing

Verified against Microsoft's public pages on **7 November 2026**:

- [Azure for Students](https://azure.microsoft.com/en-us/free/students/) provides **US$100 credit usable within 12 months**, without a credit card at signup. Students can renew eligibility annually. The subscription is disabled when credit is exhausted unless its owner explicitly upgrades; this plan does not authorize an upgrade.
- The same page advertises **750 monthly hours each of B1s, B2pts v2 and B2ats v2** for the first 12 months for **new Azure customers only**. GitHub Student Pack membership or an active credit balance alone does not prove this subscription has those free allowances. Verify the subscription's free-services meter, age, selected region and VM SKU first.
- [B2ats v2 has 2 vCPUs but only 1 GiB of RAM](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/basv2-series). B1s also has only 1 GiB. These free-hour sizes require workload testing and are tight for media processing. The selected credit-conscious candidate is **nonzonal B2ats v2**, with a 2 GiB OS-disk swap file for short memory bursts. Swap is slower than RAM and does not establish workload capacity; verify constrained-memory uploads and processing. B1ms (2 GiB) and B2s (4 GiB) have more RAM, but this subscription currently blocks those sizes in Central India.
- The [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) returned the following **Linux consumption compute-only** rates for `centralindia`. At 730 running hours, B1s is about **$8.18**, B1ms **$16.35**, B2s **$32.70**, and B2ats v2 **$4.49** before any eligible free allowance. These are reference retail rates, not a bill or an uptime guarantee. Current account pricing and availability control the actual charge.
- **Managed disks, Standard public IPv4, disk operations, outbound bandwidth and backups are additional meters.** A successful later retail API query confirmed E4 LRS Standard SSD at **$2.64 per 32 GiB disk/month**, Standard static IPv4 at **$0.005/hour**, and E4 disk operations at **$0.002 per 10,000 operations**. This design has two 32 GiB disks and one public IP. At 730 hours, the **B2ats v2 baseline is about $13.42/month**: $4.49 compute + $5.28 disks + $3.65 IPv4. If this subscription's free B2ats v2 compute allowance is confirmed, the baseline falls to **$8.93/month**. Both exclude disk transactions, outbound bandwidth, backups, applicable tax and account-specific adjustments. No free disk allowance is assumed. The unused shared-disk mount meter does not apply to this single-VM, non-shared disk configuration.
- For comparison only, B1ms would total about **$25.28/month** on the same baseline; B2s about **$41.63/month**. Those sizes currently have location restrictions here. $100 is roughly 7.5 months at the B2ats retail baseline or 11.2 months at the compute-free baseline before variable charges; it is not a guarantee that credit lasts the full year.
- Keep the [subscription spending limit](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit) **On**. It protects most credit-funded Azure usage, but is not a configurable $50 monthly budget and does not cover all separately billed Marketplace/support products. This design uses only first-party Azure resources and a standard Ubuntu image; it does not subscribe to a paid Marketplace appliance. [Student offer exclusions and terms](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p/) apply.

The site can run independently of the user's device, while the subscription remains active and funded. An always-running backend consumes resources; a $100 grant does not establish indefinite free hosting. Keep an off-VM backup before credit expiry. Stopping/deallocating a VM stops its compute meter, but retained disks and the public IP can still consume credit.

## Local tools

Azure CLI **2.92.0** was installed from the official `azure-cli` Python distribution in the isolated user environment:

```text
/home/agent/.local/share/voqro-azure-cli/bin/az
```

The CLI's `version` command was verified. No login or credentials were accessed as part of this installation. Official Bicep **0.48.1** was installed at `/home/agent/.azure/bin/bicep`; `main.bicep` compiles locally. Azure CLI set its user configuration `bicep.use_binary_from_path=false` for that official binary. This does not configure an Azure identity.

Use the user's browser device authorization through the CLI; do not ask for access keys, passwords or callback codes in chat. Preserve the cloud's inherited HTTPS proxy and CA trust. Existing managed Azure identity guards must not be repurposed or bypassed.

## Read-only preflight

After the intended user has authenticated and selected the Students subscription, run:

```bash
AZ_BIN=/home/agent/.local/share/voqro-azure-cli/bin/az \
VOQRO_AZURE_LOCATION=centralindia \
VOQRO_AZURE_SIZE=Standard_B2ats_v2 \
bash infra/azure/preflight.sh
```

This reads subscription offer/state/spending-limit metadata, SKU restrictions and regional CPU quotas. It refuses a disabled subscription, a missing/off spending limit or an unrecognized Students offer. It creates no resources. It does not retrieve the remaining dollar balance or establish free-service eligibility; those still require account evidence. Regional policy and free-tier SKU restrictions can differ from public availability. The authenticated subscription was confirmed Enabled with offer `AzureForStudents_2018-01-01` and spending limit On. Its enforced allowed-location policy lists `centralindia`, `malaysiawest`, `uaenorth`, `koreacentral` and `indonesiacentral`; **Central India is the only currently allowed Indian region**. Read-only regional SKU metadata reports B1ms/B1s/B2s `NotAvailableForSubscription` location restrictions. B2ats v2 has zone restrictions for zones 1/2/3 but no location restriction, making a **nonzonal deployment** a candidate. The template sets no availability zone. SKU metadata does not guarantee sufficient quota or allocation capacity; inspect both before creating resources. If allocation fails, inspect the existing resource state and policy-allowed alternatives rather than repeatedly creating disks/IPs or removing the spending limit.

## Infrastructure

`main.bicep` declares a resource-group-scoped deployment:

- One Ubuntu 22.04 LTS x64 VM, single backend process, no autoscaling.
- One **32 GiB Standard SSD managed data disk**, mounted ext4 at `/var/lib/voqro`; the OS disk is a separate 32 GiB Standard SSD.
- Static Standard public IPv4 with an Azure-managed `*.centralindia.cloudapp.azure.com` DNS name, a NIC, VNet and NSG.
- Public ports **80 and 443 only**. Port 80 is used for ACME certificates and HTTPS redirect. Explicit rules deny port 22 and 3000. VM administration uses Azure VM Run Command; the required provisioning SSH public key does not open network SSH access.
- No extra database service, NAT Gateway, load balancer, Application Gateway, paid registry, paid AI or email provider.

`cloud-init.yaml` mounts only the intended LUN0. It formats only a demonstrably empty disk, refuses other signatures/partitions, and never erases an existing filesystem. SQLite WAL lives on that local ext4 disk, **not Azure Files/SMB/NFS or a temporary VM disk**. A Docker systemd prerequisite requires the mounted disk on every boot, preventing silent writes to the underlying OS directory if mounting fails. Docker is installed from its official signed apt repository, with an explicitly checked signing-key fingerprint. A root-only 2 GiB swap file is created on the OS disk only if its dedicated path is absent; an existing unknown file is never overwritten. No global performance tuning is applied.

The persistent data disk's VM deletion option is **Detach**. Removing a VM does not destroy the database disk; an orphaned retained disk still incurs storage charges. Deleting the entire resource group is destructive and must not be used as an automatic cleanup step.

Before deployment, inspect the compiled template, run ARM validation/what-if under the selected subscription, and confirm quota and total estimated meters. Template parameters include the Indian region, VM size, unique DNS label and an SSH **public** key. Never put application passwords, bootstrap secrets, access tokens or private keys into Bicep parameters, customData, Git or deployment logs.

## Application deployment

`install-app.sh` is designed to run **on the VM** through Azure VM Run Command. It is not a cloud resource creation command. It takes the assigned Azure DNS hostname and an exact, pushed Git commit SHA. It fetches that public repository revision, builds the backend Dockerfile, and starts one non-root backend container with persistent storage. A previous container is stopped before the replacement is started; if the new health check fails, it restores the previous container without deleting records. The latest app's migration/backup policy must be reviewed before relying on code rollback after schema changes.

The script requires a root-owned mode-0600 `/etc/voqro/backend.env`, provisioned through the protected Run Command flow in [owner bootstrap](owner-bootstrap.md) before application startup. The file must contain at least:

```dotenv
DEMO_MODE=0
AUTH_PROVIDER=password
APP_BASE_URL=https://your-stable-vercel-frontend.vercel.app
IDENTITY_BOOTSTRAP_EMAIL=owner@example.com
# Generate a strong random value in the secure host environment; never commit it.
IDENTITY_BOOTSTRAP_SECRET=<securely-provisioned-value-at-least-32-characters>
COOKIE_SECURE=1
DB_PATH=/var/lib/voqro/production.sqlite
UPLOAD_PATH=/var/lib/voqro/uploads
```

Do not load the example placeholder as an actual secret. Do not print the environment file. No shared demo users or fabricated business records are seeded. Provision the first owner once; later members join through single-use invitations. Preserve password hashes in private backups; existing recovery tools revoke sessions and outstanding invitation tokens.

The backend is bound to loopback port 3000 and a dedicated Docker network. Caddy handles trusted HTTPS on the Azure DNS name. Its official `2.10.2-alpine` image is pinned by the verified image-index SHA-256 in the deployment script. Certificate storage persists on the VM OS disk separately from the application data directory. Caddy routes to `voqro-backend:3000`; it does not expose database or upload files directly.

After backend health and TLS pass:

1. Set Vercel's `VOQRO_BACKEND_ORIGIN` to the actual HTTPS backend origin; keep `APP_BASE_URL` equal to the stable public frontend origin used by the browser.
2. Deploy the Next.js app in `apps/web` with its real API routing. Remove the legacy `VOQRO_PREVIEW=1` sample configuration from the environment being migrated; do not point the modern frontend at the static adapter.
3. Verify actual HTTPS sign-in and HttpOnly/Secure cookies through the frontend origin, an enquiry saved after restart, owner invitation acceptance, brand isolation, a private media upload, revision and approval cycle, and a backup/restore into an isolated target.
4. Keep AWS, paid AI, Instagram publishing and email disabled until the relevant credentials/permissions and live checks are completed separately.

Syntax validation and a compiled Bicep template do not prove subscription access, regional capacity, TLS issuance, container execution or a successful live release. Those are explicit deployment checks still to perform.

## Daily private backups

See [Azure backup operations](../../docs/azure-backups.md) and `backups.bicep` for the separate private storage account, container-scoped managed identity, retention and bounded daily verification. These resources preserve the existing VM and AI identity assignment.
