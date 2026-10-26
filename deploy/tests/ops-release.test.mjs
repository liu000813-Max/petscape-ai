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

test('Deploy is manual, verifies current main exact-SHA gates, and serializes the full release', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const jobsAt = workflow.indexOf('\njobs:');
  const resolveJobAt = workflow.indexOf('\n  resolve:');
  const fullRegressionJobAt = workflow.indexOf('\n  full-regression:');
  const buildJobAt = workflow.indexOf('\n  build-and-push:');
  const deployJobAt = workflow.indexOf('\n  deploy:');
  const preJobs = workflow.slice(0, jobsAt);
  const buildJob = workflow.slice(buildJobAt, deployJobAt);
  const deployJob = workflow.slice(deployJobAt);

  assert.match(preJobs, /workflow_dispatch:/);
  assert.doesNotMatch(preJobs, /workflow_run:/);
  assert.doesNotMatch(preJobs, /inputs:/);
  assert.match(preJobs, /concurrency:\s*\n\s+group:\s*production-deploy\s*\n\s+cancel-in-progress:\s*false/);
  assert.equal((workflow.match(/group:\s*production-deploy/g) ?? []).length, 1);

  assert.ok(resolveJobAt > jobsAt);
  assert.ok(fullRegressionJobAt > resolveJobAt);
  assert.ok(buildJobAt > fullRegressionJobAt);
  assert.ok(deployJobAt > buildJobAt);
  assert.match(workflow, /target_sha/);
  assert.match(workflow, /DISPATCH_REF:\s*\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /DISPATCH_SHA:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /DISPATCH_REF" != "refs\/heads\/main"/);
  assert.match(workflow, /repos\/\$GITHUB_REPOSITORY\/branches\/main/);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs\?branch=main&event=push&status=success&head_sha=\$TARGET_SHA/);
  assert.match(workflow, /\.path == "\.github\/workflows\/ci\.yml"/);
  assert.match(workflow, /head_repository\.full_name/);
  assert.match(workflow, /actions\/runs\/\$CI_RUN_ID\/jobs\?filter=latest/);
  assert.match(workflow, /\.name == "ci-gate"/);
  assert.match(workflow, /\.head_sha == \$target_sha/);
  assert.match(workflow, /\.conclusion == "success"/);

  assert.match(workflow, /full-regression:\s*\n\s+needs:\s*resolve\s*\n\s+uses:\s*\.\/\.github\/workflows\/full-regression\.yml/);
  assert.match(workflow, /target_sha:\s*\$\{\{ needs\.resolve\.outputs\.target_sha \}\}/);
  assert.match(buildJob, /needs:\s*\[resolve, full-regression\]/);
  assert.match(buildJob, /needs\.full-regression\.result == 'success'/);
  assert.ok(buildJob.indexOf('Reject stale target before registry mutation') < buildJob.indexOf('Log in to ACR'));
  assert.match(buildJob, /push:\s*true/);
  assert.match(buildJob, /cache-to:\s*type=gha,mode=max,scope=web/);
  assert.match(buildJob, /cache-to:\s*type=gha,mode=max,scope=worker/);

  assert.match(deployJob, /needs:\s*\[resolve, full-regression, build-and-push\]/);
  assert.match(deployJob, /needs\.full-regression\.result == 'success'/);
  assert.match(deployJob, /needs\.build-and-push\.result == 'success'/);
  assert.doesNotMatch(deployJob, /always\(\)/);
  assert.ok(deployJob.indexOf('Reject stale release before production mutation') < deployJob.indexOf('Set up SSH'));
  assert.match(workflow, /ref:\s*\$\{\{ needs\.resolve\.outputs\.target_sha \}\}/);
  assert.match(workflow, /Migrate then switch exact-SHA application images/);
  assert.match(workflow, /Verify exact-SHA containers healthy/);

  assert.doesNotMatch(workflow, /deploy_required/);
  assert.doesNotMatch(workflow, /ci-release-metadata-/);
  assert.doesNotMatch(workflow, /release-freshness\.mjs/);
  assert.doesNotMatch(workflow, /skip_regression/i);
});

test('Deploy pins the approved SSH host before transmitting credentials or scripts', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const setupAt = workflow.indexOf('- name: Set up SSH');
  const uploadAt = workflow.indexOf('- name: Upload exact-SHA release scripts and preflight');
  const setup = workflow.slice(setupAt, uploadAt);
  assert.ok(setupAt >= 0 && uploadAt > setupAt);
  assert.match(setup, /DEPLOY_SSH_KNOWN_HOSTS:\s*\$\{\{ secrets\.DEPLOY_SSH_KNOWN_HOSTS \}\}/);
  assert.match(setup, /test -n "\$DEPLOY_SSH_KNOWN_HOSTS"/);
  assert.match(setup, /ssh-keygen -F "\$DEPLOY_SSH_HOST" -f ~\/\.ssh\/known_hosts/);
  assert.doesNotMatch(workflow, /ssh-keyscan|StrictHostKeyChecking=(?:no|accept-new)/);
  const connections = workflow.split('\n').filter((line) => /^\s*(?:ssh|scp) -i /.test(line));
  assert.ok(connections.length >= 5);
  for (const connection of connections) {
    assert.match(connection, /-o StrictHostKeyChecking=yes/);
    assert.match(connection, /-o IdentitiesOnly=yes/);
    assert.match(connection, /-o BatchMode=yes/);
  }
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
