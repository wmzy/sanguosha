import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  stylistic.configs.customize({
    indent: 2,
    quotes: 'single',
    semi: true,
    jsx: true,
  }),
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
        ecmaVersion: 2024,
        globals: {
          console: 'readonly',
          process: 'readonly',
          Buffer: 'readonly',
          __dirname: 'readonly',
          __filename: 'readonly',
          module: 'readonly',
          require: 'readonly',
          global: 'readonly',
          window: 'readonly',
          document: 'readonly',
          fetch: 'readonly',
          setTimeout: 'readonly',
          clearTimeout: 'readonly',
          setInterval: 'readonly',
          clearInterval: 'readonly',
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // 类型感知规则(已配 parserOptions.project;此前只有类型服务没有类型规则)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'object-shorthand': 'error',
      'react-hooks/rules-of-hooks': 'error',
      // 警告清零后升级为 error:exhaustive-deps 的漏依赖直接产出陈旧闭包 bug
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/brace-style': 'off',
      '@stylistic/operator-linebreak': 'off',
      '@stylistic/arrow-parens': 'off',
      '@stylistic/multiline-ternary': 'off',
      '@stylistic/jsx-one-expression-per-line': 'off',
      'no-loop-func': 'error',
      'no-inner-declarations': 'error',
      'no-return-assign': 'error',
      'no-sequences': 'error',
      'no-unused-expressions': 'error',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.min.js', '*.min.css', '.env*', 'eslint.config.mjs', 'prettier.config.mjs', 'vite.config.ts', 'vitest.config.ts', 'scripts/**', '.worktrees/**', 'playwright-report/**', '.playwright-mcp/**', '.sisyphus/**', 'plugin/mcp/**'],
  },
  // prettier 为格式权威;关闭 eslint 中所有与 prettier 冲突的格式规则
  eslintConfigPrettier,
];
