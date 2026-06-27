import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/*.test.js'],
    exclude: ['node_modules', 'dist', '.idea', '.vscode'],
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/**/__tests__/*.js', 'src/lib/*.js', 'src/utils/logger.js'],
    },
  },
});
