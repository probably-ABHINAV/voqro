# AWS Agent Toolkit setup status

**Paused at the user's request.** The current deployment work targets a Vercel website and a separate persistent backend. The AWS account is on the Free account plan; do not pursue AWS Organizations or the Identity Center organization route to bypass plan limits. The notes below preserve earlier investigation and are not current setup instructions. No AWS resources or account-plan changes were made.

Requested guide: [AWS official setup instructions](https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup.md), with [official troubleshooting](https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup-troubleshooting.md).

The guide and troubleshooting were read on 6 November 2026. **AWS CLI v2 is installed; account sign-in is pending.** The Agent Toolkit wizard, MCP configuration, AWS rules installation and authenticated remote skill-catalogue verification are not complete.

## Verified prerequisites

- Execution OS is Linux; `curl`, `uv`, `unzip` and `gpg` are installed.
- Application region preference is Mumbai, `ap-south-1`; overall AWS spending target is under US$50/month.
- AWS CLI **v2.39.5** is installed at `$HOME/.local/bin/aws` using the inspected official installer with its default GPG signature verification enabled. The user-local binary directory was added idempotently to `.bashrc`. Optional legacy `.data/aws-tools/bin/aws` v1 tooling was preserved.
- The user-selected `voqro` profile has region `ap-south-1` in `$HOME/.aws/config` (mode `0600`). This is configuration, not authenticated account access.
- The CLI recognizes `agent-toolkit list-available-skills`; generating its input skeleton succeeded without calling AWS. This does not verify the remote catalogue.
- The managed identity manifest is version 1 with an empty connections list. No ready AWS identity, secret binding or runtime configuration exists.
- No desktop-control tool or active display is exposed in this session. An AWS tab open on the user's own computer is not accessible from this workspace.

## Current blocker

The user published a new environment. Its current network policy is enforced and unrestricted; the earlier download-host 403 is resolved. No further network draft change or publication was performed by the agent.

Browser authentication is now the outstanding step. The official `aws login --remote` flow successfully displayed its sign-in URL and authorization-code prompt. It was cancelled without entering a code so the user can complete the entire flow in their cloud terminal. No usable credentials were obtained. Do not reuse the cancelled login URL.

During setup, the runtime supplied protected AWS selectors under `/run/codex-environment/outbound-identity/`, with profile `__oai_no_aws_identity__` and no configured connection. Writing the profile through the default selector consequently returned `Permission denied`. Those managed files and credential guards were not changed. A read-only check of the separate local config confirmed the previously saved Mumbai profile; it is not the managed runtime's active configuration.

The earlier conclusion that a managed identity connection was mandatory was too restrictive. The user explicitly requested AWS's manual CLI login procedure for `voqro`; this is not an attempt to discover or silently substitute a managed identity. Use AWS's supported, command-scoped `AWS_CONFIG_FILE="$HOME/.aws/config"` selector for this manually authenticated profile. Keep managed files, inherited proxy/authentication headers, shared-credentials selector and metadata guards intact. Do not change the global environment or claim that the managed identity manifest contains this manual connection. The [cloud runtime skill](skill://plugin_connector_1p_c5b7d5df5d7081918f2c4be5a633ed5d/cloud-environment-runtime/SKILL.md) still governs selection of platform-managed identities. Never request keys or browser authorization codes in chat.

The user confirmed that they have only this chat and the AWS browser, with no terminal attached to this environment. Available tools can start a CLI login but cannot expose an interactive terminal or securely accept the user's browser code. The prescribed `aws login --remote` flow cannot finish through the currently available interface. A login run in AWS CloudShell or on another computer would authenticate that other machine instead. Do not ask again whether the user has this terminal.

There is a documented alternative for an existing IAM Identity Center setup: `aws sso login --no-browser --use-device-code --profile voqro`. It displays a browser verification link and polls for completion, so it does not require the user to return a browser authorization code to the CLI. This is a separate supported authentication method, not another flag for `aws login`. It requires the actual access-portal URL or issuer, SSO region, and assigned account/role. Console/root sign-in does not establish those prerequisites. The next user action is to inspect [IAM Identity Center](https://console.aws.amazon.com/singlesignon), whose link is confirmed in the [AWS enablement documentation](https://docs.aws.amazon.com/singlesignon/latest/userguide/enable-identity-center.html), and share the page or non-secret access-portal details. Do not enable a new instance, create an organization, or guess an account/role merely to make login work.

The required guide inputs have been supplied: named AWS CLI profile `voqro`, an existing/advanced AWS account, and Mumbai (`ap-south-1`) for application resources. The Agent Toolkit service requires `us-east-1`, separately from the application region. No inputs need to be requested again.

## Resume at the blocked step

1. If an existing IAM Identity Center portal and assigned role are confirmed, configure an SSO session/profile in the user-owned config, preserving unrelated profiles, and use the documented device authorization flow. Preserve managed files and inherited guards. Verify the signed-in account and role before using AWS. The previously prescribed manual-login route would instead require a terminal attached to this environment:

   ```bash
   AWS_CONFIG_FILE="$HOME/.aws/config" "$HOME/.local/bin/aws" login --region ap-south-1 --profile voqro --remote
   ```

   Open the URL produced by that command and enter the resulting authorization code directly into that terminal. The [official guide, Step 3](https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup.md) says: “The human user will authenticate.” If the user has no terminal attached to this environment, report that actual limitation instead of sending them to an unverified settings control. Do not request access keys, passwords, MFA codes or browser authorization codes in chat.
2. After successful login, use the same command-scoped config selector and CLI binary to run `sts get-caller-identity --profile voqro --region ap-south-1`. It must actually succeed before claiming AWS access. The setup guide states credentials last 12 hours and can be renewed for up to 90 days without browser re-authentication.
3. Run `configure agent-toolkit --yes --region us-east-1 --profile voqro` using the same selector. Let the user complete interactive prompts if any. This setup is not an app deployment.
4. Preserve every existing MCP server entry and the generated command, arguments, timeout and transport. Add `AWS_MCP_PROXY_PROFILES=voqro` in the generated `aws-mcp` environment. This runtime also needs the absolute user-owned config path (`/home/agent/.aws/config`) as `AWS_CONFIG_FILE` in that server's environment so it can resolve the manually authenticated profile; preserve all other environment fields. At the latest inspection, `$HOME/.codex/config.toml` was empty and no existing `aws-mcp` entry was found. Recheck before writing; reconcile any pre-existing AWS entry with the user. A new server configuration does not make tools callable in this chat until its client loads it.
5. Verify the remote skill catalogue using `agent-toolkit list-available-skills --region us-east-1 --profile voqro` with the same command-scoped selector. Fetch and inspect the [advanced-account rules](https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/rules/aws-agent-rules.md), then append them idempotently to project `AGENTS.md` without removing project instructions. No rules file has been installed yet.

Preserve the session proxy, CA trust, managed credential files and guard variables. Do not print credentials, browser tokens or credential-file contents. If a later environment restores restricted networking, add verified exact destinations through its supported configuration workflow. Do not claim any of these unrun steps are complete.

## Reusable environment draft

The existing application install/start instructions were preserved, with the verified, pinned CLI v2.39.5 installation appended and the AWS resume status corrected. The draft save returned `status: saved` and `requires_publish: true`. Review and save the instructions in environment settings, then publish to retain this preparation in the reusable environment. Saving this draft did not connect an AWS account, apply credentials or publish anything.
