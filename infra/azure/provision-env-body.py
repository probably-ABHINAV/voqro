#!/usr/bin/env python3
"""Prepare an encrypted-parameter Azure Run Command body, never execute it.

Input and output files must stay outside the repository and be private. This
helper deliberately emits no credentials and never invokes az or a network API.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import stat
from urllib.parse import urlsplit

ALLOWED_KEYS = {
    'NODE_ENV', 'DEMO_MODE', 'AUTH_PROVIDER', 'APP_BASE_URL',
    'IDENTITY_BOOTSTRAP_EMAIL', 'IDENTITY_BOOTSTRAP_SECRET', 'COOKIE_SECURE',
    'AUTH_ALLOW_INSECURE_LOCAL', 'DB_PATH', 'UPLOAD_PATH', 'HOST', 'PORT',
    'AWS_MEDIA_ENABLED', 'AWS_AI_ENABLED', 'INSTAGRAM_PUBLISH_ENABLED',
    'NOTIFICATION_EMAIL_ENABLED',
}

# Linux managed Run Command passes named protected parameters as environment
# variables. The script is identical for every environment; no secret is
# interpolated into its source. Azure owns protection of protectedParameters.
REMOTE_SCRIPT = r'''#!/usr/bin/env bash
set -euo pipefail
umask 077
python3 - <<'PY'
import base64, os, pathlib, stat
if os.geteuid() != 0: raise SystemExit('Environment provisioning requires the VM root account.')
encoded = os.environ.pop('VOQRO_ENV_B64', '')
if not encoded or len(encoded) > 32768: raise SystemExit('Protected environment input is missing or too large.')
try: content = base64.b64decode(encoded, validate=True)
except Exception: raise SystemExit('Protected environment input is invalid.')
if len(content) > 16384: raise SystemExit('Environment file is too large.')
directory = pathlib.Path('/etc/voqro')
if directory.is_symlink(): raise SystemExit('Environment directory must not be a symbolic link.')
directory.mkdir(mode=0o700, exist_ok=True)
os.chmod(directory, 0o700)
os.chown(directory, 0, 0)
path = directory / 'backend.env'
try:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
except FileExistsError:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise SystemExit('Existing environment file is not a private regular root-owned file.')
    if path.read_bytes() != content:
        raise SystemExit('A different environment already exists. Explicit review is required before replacement.')
    print('The identical private environment file is already installed.')
else:
    with os.fdopen(fd, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    print('Private backend environment installed with root-only permissions.')
PY
'''


def private_source(path: Path) -> bytes:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
        raise ValueError('Input must be a current-user-owned regular file with mode 0600; symbolic links are refused.')
    content = path.read_bytes()
    if not content or len(content) > 16384:
        raise ValueError('Environment file must be nonempty and at most 16 KiB.')
    return content


def validate(content: bytes) -> dict[str, str]:
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError('Use a UTF-8 environment file.') from None
    if '\x00' in text or '\r' in text:
        raise ValueError('Use plain LF-separated KEY=value records without NUL bytes.')
    values: dict[str, str] = {}
    for line in text.splitlines():
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key not in ALLOWED_KEYS or key in values:
            raise ValueError('An environment key is unknown, duplicated or malformed.')
        values[key] = value
    if values.get('NODE_ENV') != 'production' or values.get('DEMO_MODE') != '0' or values.get('AUTH_PROVIDER') != 'password':
        raise ValueError('Require NODE_ENV=production, DEMO_MODE=0 and AUTH_PROVIDER=password.')
    if values.get('COOKIE_SECURE') != '1' or values.get('AUTH_ALLOW_INSECURE_LOCAL', '0') != '0':
        raise ValueError('Production cookies must be Secure; insecure local authentication must stay disabled.')
    origin = urlsplit(values.get('APP_BASE_URL', ''))
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment:
        raise ValueError('APP_BASE_URL must be the exact public frontend HTTPS origin.')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', values.get('IDENTITY_BOOTSTRAP_EMAIL', '')):
        raise ValueError('Configure the confirmed owner email.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', values.get('IDENTITY_BOOTSTRAP_SECRET', '')):
        raise ValueError('Use a cryptographically random, URL-safe bootstrap secret of 32–256 characters.')
    if values.get('DB_PATH') != '/var/lib/voqro/production.sqlite' or values.get('UPLOAD_PATH') != '/var/lib/voqro/uploads':
        raise ValueError('Database and uploads must use the persistent container paths.')
    if values.get('HOST', '0.0.0.0') != '0.0.0.0' or values.get('PORT', '3000') != '3000':
        raise ValueError('Use the Docker network listener on port 3000.')
    for key in ['AWS_MEDIA_ENABLED', 'AWS_AI_ENABLED', 'INSTAGRAM_PUBLISH_ENABLED', 'NOTIFICATION_EMAIL_ENABLED']:
        if values.get(key, '0') != '0':
            raise ValueError('External provider actions must remain disabled during initial deployment.')
    return values


def create_private(path: Path, data: bytes) -> None:
    if not path.parent.is_dir():
        raise ValueError('The private output directory must already exist.')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--location', default='centralindia')
    parser.add_argument('--bootstrap-file', type=Path, help='Optional private bootstrap-only file for az keyvault secret set --file; never printed.')
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    paths = [args.env_file, args.output] + ([args.bootstrap_file] if args.bootstrap_file else [])
    if any(path.resolve().is_relative_to(repository) for path in paths):
        raise ValueError('Private input/output files must remain outside the Git checkout.')
    if not re.fullmatch(r'[a-z][a-z0-9]{2,40}', args.location):
        raise ValueError('Use an Azure region identifier.')
    content = private_source(args.env_file)
    values = validate(content)
    body = {
        'location': args.location,
        'properties': {
            'source': {'script': REMOTE_SCRIPT},
            'protectedParameters': [{'name': 'VOQRO_ENV_B64', 'value': base64.b64encode(content).decode('ascii')}],
            'timeoutInSeconds': 120,
            'asyncExecution': False,
        },
    }
    create_private(args.output, (json.dumps(body) + '\n').encode('utf-8'))
    if args.bootstrap_file:
        create_private(args.bootstrap_file, values['IDENTITY_BOOTSTRAP_SECRET'].encode('ascii'))
    print('Protected Run Command body prepared. Credential values were not printed; no Azure operation was performed.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
