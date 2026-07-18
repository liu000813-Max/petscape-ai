import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// packages/server lint 边界规则（WP-2.1，spec: phase-b-execution-plan.md WP-2.1）：
// - application/ domain/ 禁止 import next、react、@prisma/client（这两层不接触框架/ORM 细节）；
// - Prisma 客户端只准出现在 infra/db/ 下；
// - 禁止在 infra/config/ 之外读取 process.env（配置只应有一个入口，Step 2 起对新代码生效）。
export default defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores(['node_modules/**', 'prisma/generated/**']),
  {
    files: ['src/application/**/*.ts', 'src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react/*', 'react-dom', 'react-dom/*'],
              message:
                'application/ 与 domain/ 层不得依赖 next/react——这两层是框架无关的用例与领域规则。',
            },
            {
              group: ['@prisma/client', '@prisma/client/*'],
              message:
                'Prisma 客户端只准在 infra/db/ 下引入；application/domain 通过 repository 接口访问数据。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/infra/**/*.ts'],
    ignores: ['src/infra/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '@prisma/client/*'],
              message: 'Prisma 客户端只准在 infra/db/ 下引入。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/infra/config/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            'process.env 只准在 infra/config/ 中读取；其他模块应消费 config 导出的已校验配置对象。',
        },
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            'process.env 只准在 infra/config/ 中读取；其他模块应消费 config 导出的已校验配置对象。',
        },
      ],
    },
  },
]);
