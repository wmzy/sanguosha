/// <reference types="vitest/globals" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const sharedAlias = {
  '@': path.resolve(__dirname, './src/client'),
  '@shared': path.resolve(__dirname, './src/shared'),
  '@engine': path.resolve(__dirname, './src/engine'),
};

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/', 'dist/', 'tests/',
        '**/*.test.{ts,tsx}', 'scripts/',
        'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts',
      ],
    },
    alias: sharedAlias,

    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/skill-tests/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'skills',
          include: ['tests/skill-tests/**/*.test.ts'],
          pool: 'forks',
          isolate: true,
        },
      },
    ],
  },
});
