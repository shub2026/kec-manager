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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,vue}'],
      exclude: ['src/**/*.{test,spec}.{js,ts}', 'src/main.js'],
      // 覆盖率门槛：以当前基线设地板值，低于即失败
      // 2026-07 基线 11.58/8.42/7.33/12.08，前端测试尚在起步阶段，随测试补强逐步抬升
      thresholds: {
        statements: 10,
        branches: 7,
        functions: 6,
        lines: 10,
      },
    },
  },
});
