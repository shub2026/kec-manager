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
        HTMLAnchorElement: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        __APP_VERSION__: 'readonly',
        __dirname: 'readonly',
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
        TextEncoder: 'readonly',
        crypto: 'readonly',
        Uint32Array: 'readonly',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^(next|_)',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'dist-verify/', '.prodcheck/'],
  },
];
