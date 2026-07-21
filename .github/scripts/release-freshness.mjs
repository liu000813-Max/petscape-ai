#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { changedFiles, classifyPaths } from './classify-changes.mjs';

const SHA = /^[0-9a-f]{40}$/;

export function evaluateReleaseFreshness({ targetSha, latestMainSha, isAncestor, files = [] }) {
  if (targetSha === latestMainSha) {
    return { deploy: true, reason: 'exact_head' };
  }
  if (!isAncestor) {
    return { deploy: false, reason: 'not_ancestor' };
  }
  if (classifyPaths(files).docs_only) {
    return { deploy: true, reason: 'documentation_only_gap' };
  }
  return { deploy: false, reason: 'newer_runtime_change' };
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

function assertSha(name, value) {
  if (!SHA.test(value) || /^0{40}$/.test(value)) {
    throw new Error(`${name} must be a non-zero 40-character lowercase SHA`);
  }
  execFileSync('git', ['cat-file', '-e', `${value}^{commit}`]);
}

function writeOutput(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${result.deploy}\nreason=${result.reason}\n`);
}

const isEntrypoint = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  const args = parseArgs(process.argv.slice(2));
  const targetSha = args['target-sha'];
  const latestMainSha = args['latest-main-sha'];
  if (!targetSha || !latestMainSha) {
    throw new Error('--target-sha and --latest-main-sha are required');
  }

  assertSha('target-sha', targetSha);
  assertSha('latest-main-sha', latestMainSha);

  let isAncestor = true;
  let files = [];
  if (targetSha !== latestMainSha) {
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', targetSha, latestMainSha]);
    if (ancestry.error) throw ancestry.error;
    if (ancestry.status === 1) {
      isAncestor = false;
    } else if (ancestry.status !== 0) {
      throw new Error(`git merge-base failed with status ${ancestry.status}`);
    } else {
      files = changedFiles({ eventName: 'push', baseSha: targetSha, headSha: latestMainSha });
    }
  }

  const result = evaluateReleaseFreshness({ targetSha, latestMainSha, isAncestor, files });
  writeOutput(result);
  console.log(JSON.stringify({ ...result, target_sha: targetSha, latest_main_sha: latestMainSha, changed_files: files }));
}
