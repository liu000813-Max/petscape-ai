import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// worker/ lint 边界规则：
// - WP-2.1：Worker 进程物理不依赖 next/react（package.json 已无该依赖，
//   这里补一道 lint 防线防止未来误加 import）；
// - WP-2.2：禁止在统一配置入口之外读取 process.env（worker 只应消费
//   @petscape/server 的 loadWorkerConfig() 返回的已校验配置对象，见
//   packages/server/src/infra/config/ 与 docs/plans/phase-b-execution-plan.md WP-2.2）。
export default defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores(['node_modules/**']),
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react/*', 'react-dom', 'react-dom/*'],
              message: 'worker/ 是独立进程，不得依赖 next/react。',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            'process.env 只准在 @petscape/server 的 infra/config/ 中读取；worker 应消费 loadWorkerConfig() 返回的已校验配置对象。',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'process.env 只准在 @petscape/server 的 infra/config/ 中读取；worker 应消费 loadWorkerConfig() 返回的已校验配置对象。',
        },
      ],
    },
  },
]);
