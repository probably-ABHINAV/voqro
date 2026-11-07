#!/usr/bin/env bash
# Read-only. This script does not create resources, upgrade billing or remove limits.
set -euo pipefail
AZ_BIN=${AZ_BIN:-"$HOME/.local/share/voqro-azure-cli/bin/az"}
VOQRO_AZURE_LOCATION=${VOQRO_AZURE_LOCATION:-centralindia}
VOQRO_AZURE_SIZE=${VOQRO_AZURE_SIZE:-Standard_B2ats_v2}
command -v "$AZ_BIN" >/dev/null
subscription_id=$("$AZ_BIN" account show --query id --output tsv)
"$AZ_BIN" rest --method get --url "https://management.azure.com/subscriptions/${subscription_id}?api-version=2022-12-01" --query '{state:state,offer:subscriptionPolicies.quotaId,spendingLimit:subscriptionPolicies.spendingLimit}' --output json > /tmp/voqro-azure-subscription-policy.json
python3 - <<'PY'
import json
p=json.load(open('/tmp/voqro-azure-subscription-policy.json'))
print(json.dumps(p,indent=2))
assert p.get('state')=='Enabled', 'The subscription must be enabled before deployment.'
assert p.get('spendingLimit')=='On', 'Credit-only deployment requires an active spending limit. Do not upgrade or remove it.'
offer=str(p.get('offer','')).lower()
assert 'student' in offer or '0170' in offer, 'Verify this is the intended Azure for Students offer before deployment.'
PY
"$AZ_BIN" vm list-skus --location "$VOQRO_AZURE_LOCATION" --resource-type virtualMachines --size "$VOQRO_AZURE_SIZE" --all --query "[?name=='${VOQRO_AZURE_SIZE}'].{name:name,restrictions:restrictions,capabilities:capabilities[?name=='vCPUs'||name=='MemoryGB']}" --output json
"$AZ_BIN" vm list-usage --location "$VOQRO_AZURE_LOCATION" --query "[?name.value=='cores'||contains(name.value, 'BSFamily')||contains(name.value, 'Basv2')].{name:name.value,current:currentValue,limit:limit}" --output table
printf '%s\n' 'Read-only checks finished. Confirm remaining credit, free-service eligibility, SKU restrictions and regional quota before a separately authorized deployment.'
