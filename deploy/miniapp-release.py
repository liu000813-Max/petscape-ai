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


def miniapp_history():
    query = "SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT migration_name,checksum FROM petscape_miniapp._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name) t"
    if run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', "SELECT to_regclass('petscape_miniapp._prisma_migrations') IS NOT NULL"], env={**os.environ, **pg_env()}, timeout=20).strip() != b't':
        return []
    return json.loads(run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], env={**os.environ, **pg_env()}, timeout=20))


def dump_schemas():
    found = run(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', "SELECT nspname FROM pg_namespace WHERE nspname IN ('public','petscape_miniapp') ORDER BY nspname"], env={**os.environ, **pg_env()}, timeout=20).decode().splitlines()
    if 'public' not in found or any(item not in ('public', 'petscape_miniapp') for item in found):
        raise RuntimeError('unexpected_backup_schema_set')
    return found


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
                for schema in dump_schemas():
                    args.extend(['--schema', schema])
                result = subprocess.run(args, stdout=output, stderr=subprocess.PIPE, timeout=180)
                if result.returncode:
                    raise RuntimeError('postgres16_backup_failed')
            info = {'target': target, 'sha256': sha256(folder / 'backup.dump'), 'schemas': dump_schemas(),
                    'publicHistory': public_history(), 'miniappHistory': miniapp_history(),
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
    if (proof.get('publicMigrations') != len(backup['publicHistory']) or public_history() != backup['publicHistory']
            or proof.get('miniappMigrations') != len(backup['miniappHistory'])):
        raise RuntimeError('website_history_changed_since_backup')
    deployed = folder / 'release.json'
    if deployed.exists():
        current = json.loads(deployed.read_text())
        if current.get('target') != target or probe('/api/healthz') != (200, {'ok': True, 'db': True, 'version': target}):
            raise RuntimeError('existing_release_requires_review')
        print(json.dumps(current))
        return
    api_env = values(ENV)
    if api_env.get('WEB_DB_POOL_MAX') != '2':
        raise RuntimeError('miniapp_pool_budget_required')
    command = 'node scripts/verify-deploy-migration-history.mjs && ./node_modules/.bin/prisma migrate deploy'
    run(docker + ['run', '--rm', '--network', 'host', '--memory=256m', '--cpus=0.5', '--env-file', str(ENV),
                  '--entrypoint', '/bin/sh', migrate, '-lc', command], timeout=180)
    if public_history() != backup['publicHistory'] or miniapp_history() != backup['miniappHistory']:
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
    snippet = Path('/etc/nginx/snippets/petscape-miniapp-' + target + '.conf')
    snippet_created = False
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
        if snippet.exists():
            raise RuntimeError('nginx_snippet_path_exists')
        snippet.write_bytes(Path('/tmp/petscape-miniapp-nginx.conf').read_bytes())
        snippet_created = True
        os.chmod(snippet, 0o644)
        include = '    include ' + str(snippet) + ';'
        begin_marker = '    # BEGIN PETSCAPE MINIAPP API MANAGED'
        end_marker = '    # END PETSCAPE MINIAPP API MANAGED'
        managed_block = begin_marker + '\n' + include + '\n' + end_marker
        text = nginx_before.decode()
        anchor = '    server_name petscape3d.com;'
        begin_count, end_count = text.count(begin_marker), text.count(end_marker)
        if begin_count != end_count or begin_count > 1:
            raise RuntimeError('nginx_managed_block_ambiguous')
        if begin_count == 1:
            start = text.index(begin_marker)
            finish = text.index(end_marker, start) + len(end_marker)
            text = text[:start] + managed_block + text[finish:]
        else:
            if text.count(anchor) != 1:
                raise RuntimeError('nginx_target_ambiguous')
            text = text.replace(anchor, anchor + '\n' + managed_block, 1)
        nginx_file.write_text(text)
        run(['nginx', '-t'], timeout=15)
        run(['systemctl', 'reload', 'nginx'], timeout=20)
        if public_history() != backup['publicHistory'] or len(miniapp_history()) == 0:
            raise RuntimeError('website_history_changed')
        result = {'target': target, 'status': 'deployed', 'url': 'https://petscape3d.com/miniapp-api/api/healthz',
                  'websiteHistoryUnchanged': True, 'backupRestoreVerified': True, 'logicalSchema': 'petscape_miniapp'}
        (folder / 'release.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except Exception:
        nginx_file.write_bytes(nginx_before)
        if snippet_created:
            snippet.unlink(missing_ok=True)
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
