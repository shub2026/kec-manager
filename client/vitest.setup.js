import { config } from '@vue/test-utils';
import ElementPlus from 'element-plus';

// 注册 Element Plus，使组件模板中的 <el-button> 等可在测试中渲染
config.global.plugins = [ElementPlus];

// jsdom 缺失的浏览器 API polyfill，避免 Element Plus 组件挂载时报错
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
}
