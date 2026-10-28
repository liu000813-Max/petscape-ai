import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
test('miniapp release preserves exact-SHA CI and full regression gates', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-miniapp.yml', root), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /head_sha=\$\{env.GITHUB_SHA\}/);
  assert.match(workflow, /j.name === 'ci-gate'/);
  assert.match(workflow, /name: Deploy Miniapp Backend/);
  assert.match(workflow, /server-integration/);
  assert.match(workflow, /ci-gate/);
  assert.match(workflow, /needs: resolve/);
  assert.match(workflow, /needs: \[resolve, build\]/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(workflow, /ssh-keyscan|StrictHostKeyChecking=no/);
});

test('miniapp release requires bound restore proof before migration and has a separate port and container', async () => {
  const release = await readFile(new URL('deploy/miniapp-release.py', root), 'utf8');
  assert.ok(release.indexOf('backup_restore_proof_missing_or_mismatched') < release.indexOf('prisma migrate deploy'));
  assert.match(release, /petscape_miniapp/);
  assert.match(release, /127\.0\.0\.1:3011:3000/);
  assert.match(release, /NAME = 'petscape-miniapp-api'/);
  assert.doesNotMatch(release, /\['docker', 'stop', 'petscape-compose/);
  assert.match(release, /website_history_changed_during_miniapp_migration/);
  assert.match(release, /BEGIN PETSCAPE MINIAPP API MANAGED/);
  assert.match(release, /END PETSCAPE MINIAPP API MANAGED/);
  assert.match(release, /nginx_snippet_path_exists/);
});

test('public ingress allows only the miniapp API prefix and blocks application pages', async () => {
  const nginx = await readFile(new URL('deploy/miniapp-nginx.conf', root), 'utf8');
  assert.match(nginx, /location \^~ \/miniapp-api\//);
  assert.match(nginx, /return 404/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3011/);
  assert.match(nginx, /client_max_body_size 1m/);
  assert.match(nginx, /admin\/content/);
});
