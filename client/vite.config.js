import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'url'
import pkg from '../package.json'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      '@': `${__dirname}/src`
    }
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Element Plus icons — must be checked before element-plus (path contains 'element-plus')
            if (id.includes('@element-plus/icons-vue')) {
              return 'element-icons';
            }
            // Element Plus — split large table/pagination components into a separate chunk
            if (id.includes('element-plus')) {
              if (
                id.includes('/components/table/') ||
                id.includes('/components/table-column/') ||
                id.includes('/components/table-v2/') ||
                id.includes('/components/pagination/')
              ) {
                return 'element-table';
              }
              return 'element-plus';
            }
            // Vue core ecosystem
            if (id.includes('/vue/') || id.includes('/vue-router/') || id.includes('/pinia/')) {
              return 'vue-vendor';
            }
            // HTTP client
            if (id.includes('/axios/')) {
              return 'axios';
            }
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['vue', 'vue-router', 'pinia', 'element-plus', 'axios'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
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
})
