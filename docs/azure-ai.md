# Azure AI review

Voqro's Media & AI workflow supports Azure OpenAI independently of AWS storage. It reviews the immutable caption, brief, snapshotted brand knowledge and at most three checksum-verified sampled video frames. **Audio and unsampled footage are not analysed.** The existing local preparation still extracts audio for possible later work; extraction is not transcription. Findings never create or replace human approvals.

## Deployment and access

The initial resource is `voqro-ai-14829c4d` in `uaenorth`, deployment `voqro-review`, model `gpt-4.1-mini` version `2025-04-14`, SKU `GlobalStandard`, capacity 10. GlobalStandard processing is not a regional data-residency guarantee. Central India rejected the OpenAI S0 resource; UAE North is both service-supported and allowed by this subscription's region policy.

The VM's system-assigned managed identity has **Cognitive Services OpenAI User** only on this AI resource. The container obtains short-lived access tokens from Azure Instance Metadata Service; tokens are never logged, returned to the browser or persisted. No account API key is needed. A synthetic live request from the deployed backend container succeeded on 7 November 2026 using managed identity (22 input tokens and 5 output tokens). The deployed image-review adapter also completed a synthetic frame review with schema-valid findings (226 input tokens and 107 output tokens). No customer content was used for either connectivity check.

Runtime configuration (no credentials):

- `AZURE_AI_ENABLED=1`
- `AZURE_AI_ENDPOINT=https://voqro-ai-14829c4d.openai.azure.com/`
- `AZURE_AI_DEPLOYMENT=voqro-review`
- `AZURE_AI_REGION=uaenorth`
- `AZURE_AI_PRICING_VERIFIED=1` only after current rate review
- `AI_JOB_RESERVATION_CENTS=10`
- `AI_MONTHLY_LIMIT_CENTS=200`

The owner must also set a campaign allowance in **Media & AI → Processing allowances**. The initial application deployment does not silently grant every campaign a spending allowance. Owner/manager can request Azure review; other roles cannot spend it. One job per immutable version/provider prevents duplicate submission. Unknown or invalid responses retain their reservation and are not retried automatically. These reservations constrain this application, not independent Azure usage or the final bill.

On 7 November 2026, Azure's [Retail Prices API](https://prices.azure.com/api/retail/prices) reported UAE North `gpt 4.1 mini Inp glbl Tokens` at US$0.0004 per 1K input tokens and `gpt 4.1 mini Outp glbl Tokens` at US$0.0016 per 1K output tokens. This is the ordinary global input/output meter, not Batch, fine-tuned hosting or provisioned capacity. Requests are bounded to 40,000 text characters, three low-detail images and 1,200 output tokens. The 10-cent reservation is conservative and is not labelled as actual cost. Student spendingLimit remains On; credit eligibility and remaining balance are controlled by Azure.

## Verification

`tests/azure-ai.test.mjs` checks endpoint restrictions, managed-identity credential handling, evidence boundaries, request limits, no retries and malformed/truncated response rejection. Azure cases in `tests/cloud.test.mjs` exercise durable reservations, permission/tenant isolation, immutable local media, absence of S3 dependency and preservation of human approval. Provider-fixture tests do not establish live access.

Keep AWS disabled unless separately authorized. Instagram still needs its account/app and verified media-delivery path. There is no automatic posting or emailing from AI findings.
