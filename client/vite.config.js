import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import viteCompression from 'vite-plugin-compression';
import { fileURLToPath, URL } from 'url';
import pkg from '../package.json';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
    // 预压缩：仅生成 .gz（gzip_static）
    // 不生成 .br：1Panel OpenResty 默认未编译 brotli 模块，
    // 保留 .br 文件会导致 gzip_static 行为异常，部分客户端收到无法解码的响应
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 10240, // 仅压缩 >10KB 的文件
      deleteOriginFile: false,
    }),
  ],
  resolve: {
    alias: {
      '@': `${__dirname}/src`,
    },
  },
  build: {
    // cssCodeSplit 保持默认 true，CSS 随 JS chunk 自动拆分，无需手动配置
    target: 'es2022',
    sourcemap: false,
    // 生产构建剥离 console.*（错误仍通过 ElMessage 面向用户展示，devtools 保持干净）
    esbuild: {
      drop: ['console'],
    },
    chunkSizeWarningLimit: 800,
    // 模块预加载：hover/visible 时预取即将进入的路由 chunk，减少点击后等待
    modulePreload: {
      polyfill: true,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // Element Plus icons — 单独成块（路径需在 element-plus 之前判断）
          if (id.includes('@element-plus/icons-vue')) {
            return 'element-icons';
          }

          // Vue 核心生态
          if (id.includes('/vue/') || id.includes('/vue-router/') || id.includes('/pinia/')) {
            return 'vue-vendor';
          }

          // HTTP 客户端
          if (id.includes('/axios/')) {
            return 'axios';
          }

          // nprogress 等小工具单独成块，避免挤入默认 chunk
          if (id.includes('/nprogress/')) {
            return 'nprogress';
          }

          // Element Plus：交给 Vite 默认分包策略，让各组件按需进入各自 chunk，
          // 避免此前把所有 EP 组件强制合并成单个 649KB 巨块。
          // 仅把体积较大的 table/pagination 系列单独成块，便于列表页复用
          if (id.includes('element-plus')) {
            if (
              id.includes('/components/table/') ||
              id.includes('/components/table-column/') ||
              id.includes('/components/table-v2/') ||
              id.includes('/components/pagination/')
            ) {
              return 'element-table';
            }
            // 其余 EP 组件不再强制合并，返回 undefined 由 Rollup 按需拆分
            return undefined;
          }

          // 其余 node_modules 统一进入 vendor chunk
          return 'vendor';
        },
      },
    },
  },
  optimizeDeps: {
    include: ['vue', 'vue-router', 'pinia', 'element-plus', 'axios'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
});
