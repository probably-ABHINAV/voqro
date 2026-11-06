"""Read-only AWS discovery. Uses the CLI's configured identity; never creates resources."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', default=str(ROOT / '.data/aws-inventory.json'))
args = parser.parse_args()
cli = os.environ.get('AWS_CLI') or shutil.which('aws') or str(ROOT / '.data/aws-tools/bin/aws')
environment = {**os.environ, 'AWS_PAGER': '', 'AWS_EC2_METADATA_DISABLED': 'true', 'AWS_MAX_ATTEMPTS': '1'}


def read(service, operation, *options, region='ap-south-1'):
    command = [cli, service, operation, *options, '--region', region,
               '--output', 'json', '--cli-connect-timeout', '5', '--cli-read-timeout', '10']
    try:
        result = subprocess.run(command, capture_output=True, text=True, env=environment, timeout=30)
        if result.returncode:
            # Do not persist arbitrary stderr: credential-process errors might include private data.
            error = result.stderr
            category = ('identity_not_configured' if any(s in error for s in ('could not be found', 'Unable to locate credentials'))
                        else 'access_denied' if 'AccessDenied' in error or 'Unauthorized' in error
                        else 'identity_expired' if 'ExpiredToken' in error or 'InvalidClientTokenId' in error
                        else 'network_or_service_error')
            return {'ok': False, 'error': category}
        return {'ok': True, 'data': json.loads(result.stdout)}
    except FileNotFoundError:
        return {'ok': False, 'error': 'aws_cli_missing'}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': 'request_timeout'}
    except (ValueError, OSError):
        return {'ok': False, 'error': 'invalid_cli_response'}


identity = read('sts', 'get-caller-identity')
if not identity['ok']:
    print(json.dumps({'connected': False, 'error': identity['error'],
                      'next_step': 'Connect an AWS IAM role in secure environment settings and select its supplied CLI profile. Do not paste access keys into chat.'}))
    raise SystemExit(1)

checks = [
    ('instances', 'ec2', 'describe-instances', ['--query', 'Reservations[].Instances[].{id:InstanceId,type:InstanceType,state:State.Name}']),
    ('nat_gateways', 'ec2', 'describe-nat-gateways', ['--query', 'NatGateways[].{id:NatGatewayId,state:State}']),
    ('public_ipv4_allocations', 'ec2', 'describe-addresses', ['--query', 'Addresses[].{allocation:AllocationId,instance:InstanceId}']),
    ('load_balancers', 'elbv2', 'describe-load-balancers', ['--query', 'LoadBalancers[].{name:LoadBalancerName,type:Type,state:State.Code}']),
    ('databases', 'rds', 'describe-db-instances', ['--query', 'DBInstances[].{id:DBInstanceIdentifier,class:DBInstanceClass,engine:Engine,multi_az:MultiAZ,state:DBInstanceStatus}']),
    ('buckets_global', 's3api', 'list-buckets', ['--query', 'Buckets[].Name']),
    ('queues', 'sqs', 'list-queues', ['--query', 'QueueUrls']),
    ('user_pools', 'cognito-idp', 'list-user-pools', ['--max-results', '60', '--query', 'UserPools[].{id:Id,name:Name}']),
    ('lightsail_instances', 'lightsail', 'get-instances', ['--query', 'instances[].{name:name,bundle:bundleId,state:state.name}']),
    ('stacks', 'cloudformation', 'list-stacks', ['--query', "StackSummaries[?StackStatus!='DELETE_COMPLETE'].{name:StackName,status:StackStatus}"]),
    ('bedrock_catalogue', 'bedrock', 'list-foundation-models', ['--query', 'modelSummaries[].{id:modelId,provider:providerName,inference:inferenceTypesSupported}']),
    ('email_capability', 'sesv2', 'get-account', ['--query', '{production:ProductionAccessEnabled,sending:SendingEnabled,quota:SendQuota}']),
]
report = {'created': datetime.now(timezone.utc).isoformat(), 'region': 'ap-south-1',
          'identity': identity['data'], 'checks': {},
          'limitations': ['Metadata only; no resource contents, credentials or user lists.',
                          'Regional checks cover Mumbai only; buckets and budgets cover the account.',
                          'Denied checks mean unknown, not absent. Catalogue listing does not prove model access.',
                          'No Cost Explorer queries, paid AI invocations, resource mutations or deployment. No live price or credit verification.']}
for name, service, operation, options in checks:
    report['checks'][name] = read(service, operation, *options)
report['checks']['budgets_global'] = read('budgets', 'describe-budgets', '--account-id', identity['data']['Account'],
    '--query', 'Budgets[].{name:BudgetName,limit:BudgetLimit,spend:CalculatedSpend}', region='us-east-1')
destination = Path(args.output).resolve()
destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as handle:
    os.fchmod(handle.fileno(), 0o600)
    json.dump(report, handle, indent=2)
    handle.write('\n')
print(json.dumps({'connected': True, 'region': report['region'], 'report': str(destination),
                  'checks': {name: 'read' if check['ok'] else check['error'] for name, check in report['checks'].items()}}, indent=2))
