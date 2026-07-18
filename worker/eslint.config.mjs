import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// worker/ lint 边界规则（WP-2.1）：Worker 进程物理不依赖 next/react
// （package.json 已无该依赖，这里补一道 lint 防线防止未来误加 import）。
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
    },
  },
]);
