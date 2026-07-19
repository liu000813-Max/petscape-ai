// WP-B7-1 — mesh_analysis worker handler。
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  MeshAnalysisJobInputSchema,
  MeshAnalysisResultSchema,
} from '@petscape/server/contracts/commerce-estimates';
import type { JobHandler } from './types.ts';
import { RetryableError } from './types.ts';

const execFileAsync = promisify(execFile);
const MAX_MESH_ASSET_BYTES = 100 * 1024 * 1024;
const MESH_ANALYZER_TIMEOUT_MS = 120_000;
const PERMANENT_ANALYZER_ERROR_CODES = new Set([
  'unit_missing_or_unsupported',
  'algorithm_version_unsupported',
  'mesh_load_failed',
  'mesh_empty',
  'invalid_dimensions',
  'asset_checksum_mismatch',
  'mesh_not_watertight',
  'mesh_invalid_extents',
  'mesh_abnormal_scale',
  'mesh_non_uniform_dimensions',
  'mesh_invalid_volume',
]);
const analyzerScript = fileURLToPath(new URL('../../scripts/analyze_mesh.py', import.meta.url));
const sandboxClosedMesh = fileURLToPath(
  new URL('../../../web/public/mockup-assets/mock-model.stl', import.meta.url),
);

export class MeshAnalysisError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MeshAnalysisError';
    this.code = code;
  }
}

class MeshAnalysisRuntimeError extends RetryableError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MeshAnalysisRuntimeError';
    this.code = code;
  }
}

async function resolveInputPath(
  input: ReturnType<typeof MeshAnalysisJobInputSchema.parse>,
  job: { ownerUserId: string },
  ctx: Parameters<JobHandler>[1],
): Promise<{ inputPath: string; cleanup?: () => Promise<void> }> {
  const { assetRef } = input.sceneConfirmation;
  if (assetRef.kind === 'temporary_catalog') {
    if (assetRef.assetKey !== 'cheese-lounge-bed-sandbox-closed-mesh-v0') {
      throw new MeshAnalysisError('temporary_asset_not_allowlisted', '临时资产不在 B7 沙箱白名单');
    }
    return { inputPath: sandboxClosedMesh };
  }

  const asset = await ctx.server.prisma.asset.findUnique({ where: { id: assetRef.assetId } });
  if (
    !asset ||
    asset.ownerUserId !== job.ownerUserId ||
    asset.projectId !== input.sceneConfirmation.projectId ||
    asset.status !== 'available' ||
    asset.checksum !== assetRef.sha256
  ) {
    throw new MeshAnalysisError(
      'owned_asset_not_verifiable',
      'owned_asset 的归属、Project、状态或 checksum 无法由服务端验证',
    );
  }
  let head: Awaited<ReturnType<typeof ctx.server.oss.head>>;
  try {
    head = await ctx.server.oss.head(asset.ossKey);
  } catch (error) {
    throw new MeshAnalysisRuntimeError('mesh_asset_head_failed', `读取 OSS 元数据失败: ${String(error)}`);
  }
  if (!head.exists || head.size === undefined || !head.etag) {
    throw new MeshAnalysisRuntimeError(
      'mesh_asset_unavailable',
      'OSS 受控资产暂时不可用或缺少可信大小/ETag',
    );
  }
  if (head.size <= 0 || head.size > MAX_MESH_ASSET_BYTES) {
    throw new MeshAnalysisError(
      'mesh_asset_too_large',
      'owned_asset 必须是 100 MiB 以内的非空网格文件',
    );
  }
  if (head.size !== asset.size) {
    throw new MeshAnalysisError('owned_asset_size_mismatch', 'owned_asset 的数据库大小与 OSS 实际大小不一致');
  }

  let bytes: Buffer;
  try {
    bytes = await ctx.server.oss.getVerifiedBuffer({
      key: asset.ossKey,
      etag: head.etag,
      expectedBytes: head.size,
      maxBytes: MAX_MESH_ASSET_BYTES,
    });
  } catch (error) {
    throw new RetryableError(`读取 OSS 受控资产失败: ${String(error)}`);
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'petscape-mesh-analysis-'));
  const extension = asset.mime.includes('stl') ? '.stl' : '.glb';
  const inputPath = path.join(directory, `asset${extension}`);
  await writeFile(inputPath, bytes);
  return { inputPath, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

export const meshAnalysisHandler: JobHandler = async (job, ctx) => {
  const input = MeshAnalysisJobInputSchema.parse(job.input);
  const resolved = await resolveInputPath(input, job, ctx);
  try {
    const expectedChecksum = input.sceneConfirmation.assetRef.sha256;
    // Preflight the local allowlisted file too, before invoking an external process.
    if (input.sceneConfirmation.assetRef.kind === 'temporary_catalog') {
      const { readFile } = await import('node:fs/promises');
      const checksum = createHash('sha256').update(await readFile(resolved.inputPath)).digest('hex');
      if (checksum !== expectedChecksum) {
        throw new MeshAnalysisError('asset_checksum_mismatch', '临时资产与不可变 checksum 不一致');
      }
    }

    const dimensions = input.sceneConfirmation.dimensionsMm;
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        ctx.server.meshAnalyzerPythonBin,
        [
          analyzerScript,
          '--input',
          resolved.inputPath,
          '--geometry-unit',
          input.geometryUnit,
          '--dimensions-mm',
          `${dimensions.x},${dimensions.y},${dimensions.z}`,
          '--algorithm-version',
          input.algorithmVersion,
          '--expected-sha256',
          expectedChecksum,
        ],
        {
          encoding: 'utf8',
          maxBuffer: 4 * 1024 * 1024,
          timeout: MESH_ANALYZER_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        },
      ));
    } catch (error) {
      const stderr = (error as { stderr?: unknown }).stderr;
      try {
        const parsed = JSON.parse(typeof stderr === 'string' ? stderr.trim() : '') as {
          code?: unknown;
          message?: unknown;
        };
        if (typeof parsed.code !== 'string' || typeof parsed.message !== 'string') {
          throw new Error('invalid analyzer error payload');
        }
        if (PERMANENT_ANALYZER_ERROR_CODES.has(parsed.code)) {
          throw new MeshAnalysisError(parsed.code, parsed.message);
        }
        throw new MeshAnalysisRuntimeError(parsed.code, parsed.message);
      } catch (parseError) {
        if (parseError instanceof MeshAnalysisError || parseError instanceof RetryableError) {
          throw parseError;
        }
        throw new MeshAnalysisRuntimeError(
          'mesh_analyzer_failed',
          '网格分析运行时失败或超时，未返回可解释的几何错误',
        );
      }
    }
    return MeshAnalysisResultSchema.parse(JSON.parse(stdout));
  } finally {
    await resolved.cleanup?.();
  }
};
