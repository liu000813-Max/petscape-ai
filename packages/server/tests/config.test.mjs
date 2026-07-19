// packages/server/tests/config.test.mjs
// spec: docs/plans/phase-b-execution-plan.md WP-2.2 验收 1：
//   缺必需键启动抛错且错误信息含键名；全键通过；
//   web schema 不含 worker 专属键（如切片器路径），反之亦然。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWebConfig,
  loadWorkerConfig,
  ConfigValidationError,
  webConfigSchema,
  workerConfigSchema,
} from '../src/infra/config/index.ts';

test('缺少必需键（NODE_ENV）时 loadWebConfig 抛错且错误信息含键名', () => {
  assert.throws(
    () => loadWebConfig({}),
    (error) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.ok(
        error.message.includes('NODE_ENV'),
        `错误信息应包含缺失键名 NODE_ENV，实际: ${error.message}`,
      );
      assert.ok(error.issues.some((issue) => issue.includes('NODE_ENV')));
      return true;
    },
  );
});

test('缺少必需键（NODE_ENV）时 loadWorkerConfig 抛错且错误信息含键名', () => {
  assert.throws(
    () => loadWorkerConfig({}),
    (error) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.ok(error.message.includes('NODE_ENV'));
      return true;
    },
  );
});

test('全部必需键提供时 loadWebConfig 校验通过', () => {
  const config = loadWebConfig({
    NODE_ENV: 'development',
    BETTER_AUTH_SECRET: 'test-secret-not-for-prod',
  });
  assert.equal(config.NODE_ENV, 'development');
});

test('全部必需键提供时 loadWorkerConfig 校验通过（含供应商 key 与切片器路径）', () => {
  const config = loadWorkerConfig({
    NODE_ENV: 'production',
    FAL_KEY: 'fal-test-key',
    TRIPO_API_KEY: 'tripo-test-key',
    TRIPO_API_KEY_2: 'tripo-test-key-2',
    MESHY_API_KEY: 'meshy-test-key',
    UV_BIN: '/usr/local/bin/uv',
    PRUSASLICER_BIN: '/usr/local/bin/prusa-slicer',
  });
  assert.equal(config.NODE_ENV, 'production');
  assert.equal(config.FAL_KEY, 'fal-test-key');
  assert.equal(config.UV_BIN, '/usr/local/bin/uv');
  assert.equal(config.WORKER_JOB_TYPES, 'sample.echo,mesh_analysis,order_recovery');
  assert.equal(config.MESH_ANALYZER_PYTHON_BIN, 'python3');
});

test('非法枚举值（NODE_ENV 不在允许集合内）报错含键名', () => {
  assert.throws(
    () => loadWebConfig({ NODE_ENV: 'staging' }),
    (error) => {
      assert.ok(error instanceof ConfigValidationError);
      assert.ok(error.message.includes('NODE_ENV'));
      return true;
    },
  );
});

test('web schema 不包含 worker 专属键（切片器路径与生成供应商 key）', () => {
  assert.ok(!('FAL_KEY' in webConfigSchema.shape));
  assert.ok(!('TRIPO_API_KEY' in webConfigSchema.shape));
  assert.ok(!('TRIPO_API_KEY_2' in webConfigSchema.shape));
  assert.ok(!('MESHY_API_KEY' in webConfigSchema.shape));
  assert.ok(!('UV_BIN' in webConfigSchema.shape));
  assert.ok(!('PRUSASLICER_BIN' in webConfigSchema.shape));
});

test('worker schema 包含专属键，且 web/worker 都含 common 键', () => {
  assert.ok('UV_BIN' in workerConfigSchema.shape);
  assert.ok('PRUSASLICER_BIN' in workerConfigSchema.shape);
  assert.ok('MESH_ANALYZER_PYTHON_BIN' in workerConfigSchema.shape);
  assert.ok('NODE_ENV' in webConfigSchema.shape);
  assert.ok('NODE_ENV' in workerConfigSchema.shape);
  assert.ok('DATABASE_URL' in webConfigSchema.shape);
  assert.ok('DATABASE_URL' in workerConfigSchema.shape);
});

test('web 专属供应商/生成键在提供给 loadWebConfig 时被忽略而非报错（strip 而非拒绝未知键）', () => {
  // zod object 默认 strip 未知键；worker 专属键若意外出现在环境变量中，
  // 不应导致 Web 进程校验失败（环境变量是全进程共享的 .env，Web 进程只挑自己 schema 里的键）。
  const config = loadWebConfig({
    NODE_ENV: 'development',
    BETTER_AUTH_SECRET: 'test-secret-not-for-prod',
    FAL_KEY: 'should-be-ignored',
  });
  assert.equal('FAL_KEY' in config, false);
});

test('C3 sandbox payment provider defaults disabled and production configuration fails closed', () => {
  const base = { NODE_ENV: 'test', BETTER_AUTH_SECRET: 'test-secret' };
  assert.equal(loadWebConfig(base).PAYMENT_PROVIDER_MODE, 'disabled');
  assert.throws(() => loadWebConfig({
    ...base,
    NODE_ENV: 'production',
    PAYMENT_PROVIDER_MODE: 'sandbox',
    SANDBOX_PAYMENT_SECRET: 'sandbox-secret-at-least-thirty-two-characters',
  }), /PAYMENT_PROVIDER_MODE/);
});
