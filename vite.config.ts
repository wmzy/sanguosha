import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wyw from '@wyw-in-js/vite';
import { honoApiPlugin } from './src/server/vite-plugin';
import { cardLocalPlugin } from './src/server/vite-card-local-plugin';
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
    cardLocalPlugin(),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
    cssMinify: 'esbuild',
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
