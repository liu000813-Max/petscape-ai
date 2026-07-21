import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  classifyPaths,
  isDocumentationPath,
  writeClassificationArtifact,
} from '../../.github/scripts/classify-changes.mjs';
import { evaluateReleaseFreshness } from '../../.github/scripts/release-freshness.mjs';

test('documentation allowlist is narrow and explicit', () => {
  for (const file of [
    'README.md',
    'PetScape-PRD.md',
    'docs/architecture/overview.md',
    'docs/operations/topology.png',
    'screenshots/browser-qa/result.png',
  ]) {
    assert.equal(isDocumentationPath(file), true, file);
  }

  for (const file of [
    '.github/workflows/ci.yml',
    '.github/README.md',
    'docs/operations/release.sh',
    'docs/contracts/schema.json',
    'package.json',
    'pnpm-lock.yaml',
    'web/README.md',
    'web/public/runtime-image.png',
    'packages/server/prisma/schema.prisma',
    'deploy/worker.Dockerfile',
  ]) {
    assert.equal(isDocumentationPath(file), false, file);
  }
});

test('only an entirely documented change is docs-only', () => {
  assert.deepEqual(classifyPaths(['README.md', 'docs/guide.md']), {
    docs_only: true,
    runtime_changed: false,
    deploy_required: false,
  });
  assert.deepEqual(classifyPaths(['README.md', 'web/app/page.tsx']), {
    docs_only: false,
    runtime_changed: true,
    deploy_required: true,
  });
  assert.deepEqual(classifyPaths([]), {
    docs_only: false,
    runtime_changed: true,
    deploy_required: true,
  });
});

test('release classification artifact binds decisions to the tested SHA', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'petscape-ci-classifier-'));
  const output = path.join(directory, 'release-classification.json');
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  writeClassificationArtifact({
    classification: classifyPaths(['docs/guide.md']),
    eventName: 'push',
    baseSha,
    headSha,
    files: ['docs/guide.md'],
    output,
    repository: 'AlfredGuquan/petscape-final',
    workflowRunId: '123456',
    ref: 'refs/heads/main',
  });

  const artifact = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(artifact.schema_version, 1);
  assert.equal(artifact.repository, 'AlfredGuquan/petscape-final');
  assert.equal(artifact.workflow_run_id, '123456');
  assert.equal(artifact.ref, 'refs/heads/main');
  assert.equal(artifact.head_sha, headSha);
  assert.equal(artifact.base_sha, baseSha);
  assert.equal(artifact.deploy_required, false);
  assert.deepEqual(artifact.changed_files, ['docs/guide.md']);
});

test('release freshness never loses a runtime release beneath documentation-only commits', () => {
  const runtimeSha = 'a'.repeat(40);
  const docsSha = 'b'.repeat(40);

  assert.deepEqual(evaluateReleaseFreshness({
    targetSha: runtimeSha,
    latestMainSha: runtimeSha,
    isAncestor: true,
  }), { deploy: true, reason: 'exact_head' });

  assert.deepEqual(evaluateReleaseFreshness({
    targetSha: runtimeSha,
    latestMainSha: docsSha,
    isAncestor: true,
    files: ['README.md', 'docs/guide.md'],
  }), { deploy: true, reason: 'documentation_only_gap' });

  for (const files of [
    ['README.md', '.github/workflows/ci.yml'],
    ['pnpm-lock.yaml'],
    ['deploy/web.Dockerfile'],
    ['web/public/runtime-image.png'],
    ['unknown.new-extension'],
    [],
  ]) {
    assert.deepEqual(evaluateReleaseFreshness({
      targetSha: runtimeSha,
      latestMainSha: docsSha,
      isAncestor: true,
      files,
    }), { deploy: false, reason: 'newer_runtime_change' }, JSON.stringify(files));
  }

  assert.deepEqual(evaluateReleaseFreshness({
    targetSha: runtimeSha,
    latestMainSha: docsSha,
    isAncestor: false,
    files: ['docs/guide.md'],
  }), { deploy: false, reason: 'not_ancestor' });
});
