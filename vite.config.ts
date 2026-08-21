import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wyw from '@wyw-in-js/vite';
import { honoApiPlugin } from './src/server/vite-plugin';
import { resourcePlugin } from './src/server/vite-resource-plugin';
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react({ exclude: ['node_modules/**'] }),
    wyw({
      sourceMap: process.env.NODE_ENV !== 'production',
      displayName: process.env.NODE_ENV !== 'production',
      exclude: ['node_modules/**'],
      // evaluate 必须为 true(默认):css`` 内插值其他 css 类(如 ${pageStyle})依赖
      // 求值导出绑定来内联规则;false 时静默跳过,被插值的 padding/flex 等属性全部丢失
      // (实证:「请先登录」面板贴左上角、404 页不居中)。
      evaluate: true,
      babelOptions: {
        presets: ['@babel/preset-typescript'],
      },
    }),
    honoApiPlugin(),
    resourcePlugin(),
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
