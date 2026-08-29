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
      // 2026-08-29 基线（P0-P2 补测后）31.93/26.5/20.56/33.21，留少量余量防抖动，随测试补强逐步抬升
      thresholds: {
        statements: 29,
        branches: 24,
        functions: 18,
        lines: 31,
      },
    },
  },
});
