import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

// 客户端单元测试配置（P0/P1 UI/UX 审计修复的测试覆盖）
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    include: ['src/**/*.{test,spec}.{js,ts}'],
    // 与 server 子项目保持一致的 vitest run 行为
    watch: false,
  },
});
