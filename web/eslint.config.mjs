import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

// WP-2.1 lint 边界规则：
// - 禁止新建 `web/src/app`（Next.js 在根有 `app/` 时会静默忽略 `src/app`，
//   这条规则挡住该陷阱——见 docs/governance/2026-07-18-directory-structure-plan.md B.1 R2 坑①）；
// - 禁止在配置入口之外读取 process.env；存量散点用下方 baseline 豁免清单锁存（只降不升，见 WP-2.1 验收 3）。
const PROCESS_ENV_BASELINE = new Set([
  'app/lib/images/falClient.ts',
  'app/lib/jobs/avatarJob.ts',
  'app/lib/tripo/client.ts',
  'app/api/vibe/rewrite/route.ts',
]);

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'public/generated/**',
    'public/uploads/**',
  ]),
  {
    files: ['src/app/**/*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            '禁止新建 web/src/app：Next.js 在根已有 app/ 时会静默忽略 src/app，此目录不得存在（WP-2.1 lint 边界）。',
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'process.env 只准在统一配置入口读取（迁移完成前的存量散点见 eslint.config.mjs 的 baseline 豁免清单，只降不升）。',
        },
      ],
    },
  },
  ...[...PROCESS_ENV_BASELINE].map((file) => ({
    files: [file],
    rules: {
      'no-restricted-properties': 'off',
    },
  })),
]);
