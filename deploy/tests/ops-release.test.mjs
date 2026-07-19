import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/deploy.yml');
const releaseScript = path.join(repoRoot, 'deploy/ecs-release.sh');
const exactSha = '1234567890abcdef1234567890abcdef12345678';

async function runRelease({ migrateExit = 0 } = {}) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'petscape-ops-release-'));
  const remoteDir = path.join(fixtureRoot, 'remote');
  const fakeBin = path.join(fixtureRoot, 'bin');
  const dockerLog = path.join(fixtureRoot, 'docker.log');
  await mkdir(remoteDir);
  await mkdir(fakeBin);
  await writeFile(path.join(remoteDir, 'web.env'), 'DATABASE_URL=postgresql://fixture\n');
  await writeFile(path.join(remoteDir, 'compose.yml'), 'services: {}\n');
  const fakeDocker = path.join(fakeBin, 'docker');
  await writeFile(
    fakeDocker,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ " $* " == *" run "* ]]; then
  echo "Prisma migrate deploy fixture"
  if [[ "$FAKE_MIGRATE_EXIT" != "0" ]]; then
    echo "fixture migration failed" >&2
    exit "$FAKE_MIGRATE_EXIT"
  fi
  echo "No pending migrations to apply."
fi
`,
  );
  await chmod(fakeDocker, 0o755);

  const result = await new Promise((resolve) => {
    const child = spawn('bash', [releaseScript, exactSha, 'registry.internal'], {
      // Production uploads this script to /tmp, so the release primitive must
      // not depend on being launched from the Compose project directory.
      cwd: fixtureRoot,
      env: {
        ...process.env,
        REMOTE_DIR: remoteDir,
        DOCKER_BIN: fakeDocker,
        DOCKER_CONFIG_DIR: path.join(fixtureRoot, 'docker-config'),
        FAKE_DOCKER_LOG: dockerLog,
        FAKE_MIGRATE_EXIT: String(migrateExit),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  const calls = await readFile(dockerLog, 'utf8').catch(() => '');
  return { ...result, calls };
}

test('Deploy consumes the successful main CI run for one exact SHA and serializes production', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\[CI\]/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /group:\s*production-deploy/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /target_sha/);
  assert.match(workflow, /ref:\s*\$\{\{ needs\.resolve\.outputs\.target_sha \}\}/);
  assert.match(workflow, /git ls-remote origin refs\/heads\/main/);
  assert.match(workflow, /Skipping stale release/);
  assert.match(workflow, /Migrate then switch exact-SHA application images/);
  assert.doesNotMatch(workflow, /uses:\s*\.\/\.github\/workflows\/ci\.yml/);
});

test('migration failure stops before application pull or restart', async () => {
  const result = await runRelease({ migrateExit: 42 });
  assert.equal(result.code, 42, result.stderr);
  assert.match(result.calls, /petscape\/worker:/);
  assert.doesNotMatch(result.calls, /compose .*pull web worker/);
  assert.doesNotMatch(result.calls, /compose .*up -d web worker/);
});

test('successful no-op migration switches via REMOTE_DIR from an arbitrary cwd', async () => {
  const result = await runRelease();
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /No pending migrations to apply/);

  const migrateAt = result.calls.indexOf('run --rm');
  const pullAt = result.calls.indexOf('compose --project-directory', migrateAt);
  const restartAt = result.calls.indexOf('up -d web worker');
  assert.ok(migrateAt >= 0, result.calls);
  assert.ok(pullAt > migrateAt, result.calls);
  assert.ok(restartAt > pullAt, result.calls);
  assert.match(
    result.calls,
    /compose --project-directory (\/.*\/remote) --file \1\/compose\.yml --env-file \1\/\.deploy\.env pull web worker/,
  );
});
