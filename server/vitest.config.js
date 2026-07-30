import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/*.test.js', 'src/**/__tests__/**/*.test.js'],
    exclude: ['node_modules', 'dist', '.idea', '.vscode'],
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: [
        'src/**/__tests__/*.js',
        'src/**/__tests__/**/*.js',
        'src/lib/*.js',
        'src/utils/logger.js',
      ],
      // 覆盖率门槛：以当前基线设地板值，低于即失败
      // 2026-07 基线 80.95/70.22/79.84/82.55，留少量余量防抖动，随测试补强逐步抬升
      thresholds: {
        statements: 78,
        branches: 67,
        functions: 76,
        lines: 80,
      },
    },
  },
});
