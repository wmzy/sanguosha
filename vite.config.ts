import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wyw from '@wyw-in-js/vite';
import path from 'path';
import { honoApiPlugin } from './server/vite-plugin';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react({ exclude: ['node_modules/**'] }),
    wyw({
      sourceMap: process.env.NODE_ENV !== 'production',
      displayName: process.env.NODE_ENV !== 'production',
      exclude: ['node_modules/**'],
      evaluate: false,
      babelOptions: {
        presets: ['@babel/preset-typescript'],
      },
    }),
    honoApiPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@engine': path.resolve(__dirname, './engine'),
    },
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react-router')) {
            return 'router-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: parseInt(process.env.PORT ?? '3930'),
    host: process.env.HOST ?? true,
  },
});
