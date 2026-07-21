#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ZERO_SHA = /^0{40}$/;
const SHA = /^[0-9a-f]{40}$/;

export function isDocumentationPath(file) {
  const normalized = file.replaceAll('\\', '/');
  const documentAsset = /\.(?:md|txt|pdf|png|jpe?g|webp|gif|svg)$/i;
  return (
    (!normalized.includes('/') && normalized.endsWith('.md'))
    || (normalized.startsWith('docs/') && documentAsset.test(normalized))
    || (normalized.startsWith('screenshots/') && documentAsset.test(normalized))
  );
}

export function classifyPaths(files) {
  const docsOnly = files.length > 0 && files.every(isDocumentationPath);
  return {
    docs_only: docsOnly,
    runtime_changed: !docsOnly,
    deploy_required: !docsOnly,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument near ${key ?? '<end>'}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function assertSha(name, value, { allowZero = false } = {}) {
  if (!SHA.test(value) || (!allowZero && ZERO_SHA.test(value))) {
    throw new Error(`${name} must be a non-zero 40-character lowercase SHA`);
  }
}

export function changedFiles({ eventName, baseSha, headSha }) {
  assertSha('head-sha', headSha);
  assertSha('base-sha', baseSha, { allowZero: eventName === 'push' });

  // A new main branch or an empty/unknown base must fail safe to the full path.
  if (ZERO_SHA.test(baseSha)) return [];

  execFileSync('git', ['cat-file', '-e', `${baseSha}^{commit}`]);
  execFileSync('git', ['cat-file', '-e', `${headSha}^{commit}`]);

  const range = eventName === 'pull_request'
    ? `${baseSha}...${headSha}`
    : `${baseSha}..${headSha}`;
  const output = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', range], {
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean).sort();
}

function writeGithubOutputs(classification) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, [
    `docs_only=${classification.docs_only}`,
    `runtime_changed=${classification.runtime_changed}`,
    `deploy_required=${classification.deploy_required}`,
    '',
  ].join('\n'));
}

export function writeClassificationArtifact({
  classification,
  eventName,
  baseSha,
  headSha,
  files,
  output,
  repository,
  workflowRunId,
  ref,
}) {
  const artifact = {
    schema_version: 1,
    repository,
    workflow_run_id: workflowRunId,
    event_name: eventName,
    ref,
    base_sha: baseSha,
    head_sha: headSha,
    ...classification,
    changed_files: files,
  };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

const isEntrypoint = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  const args = parseArgs(process.argv.slice(2));
  const eventName = args.event;
  if (!['pull_request', 'push'].includes(eventName)) {
    throw new Error(`unsupported event: ${eventName}`);
  }

  const baseSha = args['base-sha'];
  const headSha = args['head-sha'];
  const output = args.output;
  const repository = args.repository;
  const workflowRunId = args['run-id'];
  const ref = args.ref;
  if (!baseSha || !headSha || !output || !repository || !workflowRunId || !ref) {
    throw new Error('--event, --base-sha, --head-sha, --output, --repository, --run-id and --ref are required');
  }

  const files = changedFiles({ eventName, baseSha, headSha });
  const classification = classifyPaths(files);
  writeGithubOutputs(classification);
  const artifact = writeClassificationArtifact({
    classification,
    eventName,
    baseSha,
    headSha,
    files,
    output,
    repository,
    workflowRunId,
    ref,
  });

  console.log(JSON.stringify(artifact));
}
