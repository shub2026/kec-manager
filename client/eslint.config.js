import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import prettierConfig from '@vue/eslint-config-prettier';

export default [
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  prettierConfig,
  {
    files: ['**/*.vue', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        Blob: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        atob: 'readonly',
        __APP_VERSION__: 'readonly',
        ElMessage: 'readonly',
        getComputedStyle: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly'
      }
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off',
      'no-unused-vars': 'warn'
    }
  },
  {
    ignores: ['node_modules/', 'dist/']
  }
];
