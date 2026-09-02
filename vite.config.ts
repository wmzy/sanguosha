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
      // evaluate 为 wyw 默认值,保留 true 无害。实测(@wyw-in-js/vite 1.1.0):
      // css`` 内插值其他 css 类(如 ${pageStyle})无论 evaluate 开关都不会内联其规则,
      // 只会产出非法声明被浏览器丢弃;colors 等值插值两档都能正常解析。
      // 跨类组合必须在使用处做 className 字符串拼接(见分支内转换)。
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
