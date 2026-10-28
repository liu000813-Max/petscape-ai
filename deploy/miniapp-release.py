#!/usr/bin/env python3
"""Explicit prepare/restore/release for the isolated miniapp API only."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path('/opt/petscape-miniapp')
ENV = ROOT / 'api.env'
KNOWN_WEB = 'petscape-compose-web-1'
NAME = 'petscape-miniapp-api'


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError('command_failed_' + Path(args[0]).name)
    return result.stdout


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def values(file):
    return dict(line.split('=', 1) for line in file.read_text().splitlines()
                if '=' in line and not line.lstrip().startswith('#'))


def pg_env():
    parsed = urllib.parse.urlsplit(values(Path('/opt/petscape-compose/web.env'))['DATABASE_URL'].strip('"\''))
    return dict(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
                PGUSER=urllib.parse.unquote(parsed.username), PGPASSWORD=urllib.parse.unquote(parsed.password),
                PGDATABASE=urllib.parse.unquote(parsed.path.lstrip('/')), PGCONNECT_TIMEOUT='10')


def public_history():
    query = 'SELECT coalesce(json_agg(row_to_json(t)),\'[]\'::json) FROM (SELECT migration_name,checksum FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name) t'
    data = run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], env={**os.environ, **pg_env()}, timeout=20)
    return json.loads(data)


def probe(path):
    try:
        with urllib.request.urlopen('http://127.0.0.1:3011' + path, timeout=5) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None


def main():
    phase, target, registry = sys.argv[1:]
    if phase not in ('prepare', 'release') or not re.fullmatch('[0-9a-f]{40}', target):
        raise RuntimeError('invalid_release_target')
    if not re.fullmatch(r'[a-z0-9-]+-vpc\.cn-hangzhou\.personal\.cr\.aliyuncs\.com', registry):
        raise RuntimeError('invalid_registry')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    folder = ROOT / 'releases' / target
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    if ENV.stat().st_mode & 0o077:
        raise RuntimeError('environment_permissions_too_broad')
    db_url = urllib.parse.urlsplit(values(ENV)['DATABASE_URL'].strip('"\''))
    if urllib.parse.parse_qs(db_url.query).get('schema') != ['petscape_miniapp']:
        raise RuntimeError('isolated_schema_required')
    image = registry + '/petscape/miniapp-api:' + target
    migrate = registry + '/petscape/miniapp-migrate:' + target
    docker = ['docker', '--config', '/root/.docker-acr']
    if phase == 'prepare':
        if shutil.disk_usage(ROOT).free < 4 * 1024 ** 3:
            raise RuntimeError('insufficient_disk')
        for ref in (image, migrate):
            run(docker + ['pull', ref], timeout=360)
        receipt = folder / 'backup.json'
        if receipt.exists():
            existing = json.loads(receipt.read_text())
            if existing['sha256'] != sha256(folder / 'backup.dump'):
                raise RuntimeError('existing_backup_mismatch')
            print(json.dumps({'phase': phase, 'target': target, 'backup': 'existing_verified', 'sha256': existing['sha256']}))
            return
        pg_file = folder / '.pg.env'
        pg_file.write_text(''.join(k + '=' + v + '\n' for k, v in pg_env().items()))
        os.chmod(pg_file, 0o600)
        try:
            with (folder / 'backup.dump').open('xb') as output:
                args = docker + ['run', '--rm', '--network', 'host', '--memory=192m', '--cpus=0.5',
                                 '--env-file', str(pg_file), '--entrypoint', 'pg_dump', migrate,
                                 '--format=custom', '--no-owner', '--no-acl']
                result = subprocess.run(args, stdout=output, stderr=subprocess.PIPE, timeout=180)
                if result.returncode:
                    raise RuntimeError('postgres16_backup_failed')
            info = {'target': target, 'sha256': sha256(folder / 'backup.dump'), 'publicHistory': public_history(),
                    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'restoreVerified': False}
            receipt.write_text(json.dumps(info, indent=2) + '\n')
            shutil.copy2('/opt/petscape-compose/compose.yml', folder / 'website-compose.before')
            print(json.dumps({'phase': phase, 'target': target, 'sha256': info['sha256'], 'backupBytes': (folder / 'backup.dump').stat().st_size}))
        finally:
            pg_file.unlink(missing_ok=True)
        return

    # Local PostgreSQL 16 restore proof is required before any migration or ingress change.
    backup = json.loads((folder / 'backup.json').read_text())
    proof = json.loads((folder / 'restore-verified.json').read_text())
    if proof.get('restored') is not True or proof.get('target') != target or proof.get('sha256') != backup['sha256'] or sha256(folder / 'backup.dump') != backup['sha256']:
        raise RuntimeError('backup_restore_proof_missing_or_mismatched')
    if proof.get('publicMigrations') != len(backup['publicHistory']) or public_history() != backup['publicHistory']:
        raise RuntimeError('website_history_changed_since_backup')
    api_env = values(ENV)
    if api_env.get('WEB_DB_POOL_MAX') != '2':
        raise RuntimeError('miniapp_pool_budget_required')
    command = 'node scripts/verify-deploy-migration-history.mjs && ./node_modules/.bin/prisma migrate deploy'
    run(docker + ['run', '--rm', '--network', 'host', '--memory=256m', '--cpus=0.5', '--env-file', str(ENV),
                  '--entrypoint', '/bin/sh', migrate, '-lc', command], timeout=180)
    if public_history() != backup['publicHistory']:
        raise RuntimeError('website_history_changed_during_miniapp_migration')
    old = subprocess.run(['docker', 'inspect', NAME], capture_output=True).returncode == 0
    if old:
        if subprocess.run(['docker', 'inspect', NAME + '-previous'], capture_output=True).returncode == 0:
            raise RuntimeError('previous_miniapp_container_requires_review')
        run(['docker', 'stop', NAME], timeout=30)
        run(['docker', 'rename', NAME, NAME + '-previous'])
    nginx_file = Path('/etc/nginx/sites-enabled/petscape').resolve()
    nginx_before = nginx_file.read_bytes()
    (folder / 'nginx.before').write_bytes(nginx_before)
    try:
        run(docker + ['run', '-d', '--name', NAME, '--restart', 'unless-stopped', '--init',
                      '--memory=256m', '--cpus=0.75', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                      '--env-file', str(ENV), '-e', 'NODE_OPTIONS=--max-old-space-size=160',
                      '-p', '127.0.0.1:3011:3000', '--label', 'petscape.component=miniapp-api', image], timeout=45)
        ready = False
        for attempt in range(60):
            try:
                status, body = probe('/api/healthz')
                if status == 200 and body.get('db') is True and body.get('version') == target:
                    ready = True
                    break
            except (OSError, ValueError):
                pass
            time.sleep(2)
        if not ready:
            raise RuntimeError('miniapp_readiness_failed')
        for route, expected in [('/api/v1/content/articles', 200), ('/api/v1/community/posts', 200),
                                ('/api/v1/service-providers', 200), ('/api/v1/pets', 401), ('/api/v1/care-logs', 401)]:
            if probe(route)[0] != expected:
                raise RuntimeError('miniapp_api_acceptance_failed')
        snippet = Path('/etc/nginx/snippets/petscape-miniapp.conf')
        snippet.write_bytes(Path('/tmp/petscape-miniapp-nginx.conf').read_bytes())
        os.chmod(snippet, 0o644)
        include = '    include /etc/nginx/snippets/petscape-miniapp.conf;'
        text = nginx_before.decode()
        anchor = '    server_name petscape3d.com;'
        if include not in text:
            if text.count(anchor) != 1:
                raise RuntimeError('nginx_target_ambiguous')
            nginx_file.write_text(text.replace(anchor, anchor + '\n' + include, 1))
        run(['nginx', '-t'], timeout=15)
        run(['systemctl', 'reload', 'nginx'], timeout=20)
        if public_history() != backup['publicHistory']:
            raise RuntimeError('website_history_changed')
        result = {'target': target, 'status': 'deployed', 'url': 'https://petscape3d.com/miniapp-api/api/healthz',
                  'websiteHistoryUnchanged': True, 'backupRestoreVerified': True, 'logicalSchema': 'petscape_miniapp'}
        (folder / 'release.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        nginx_file.write_bytes(nginx_before)
        subprocess.run(['nginx', '-t'], capture_output=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], capture_output=True)
        subprocess.run(['docker', 'rm', '-f', NAME], capture_output=True)
        if old:
            run(['docker', 'rename', NAME + '-previous', NAME])
            run(['docker', 'start', NAME])
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        safe = str(error) if re.fullmatch('[a-z0-9_]+', str(error)) else 'miniapp_release_failed'
        print(json.dumps({'status': 'failed', 'error': safe}), file=sys.stderr)
        sys.exit(1)
