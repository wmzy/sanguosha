import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

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
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
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
      'react-hooks/exhaustive-deps': 'warn',
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
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.min.js', '*.min.css', '.env*', 'eslint.config.mjs', 'prettier.config.mjs', 'vite.config.ts', 'vitest.config.ts', 'scripts/**'],
  },
];
