import { config } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import * as ElementPlusIcons from '@element-plus/icons-vue';

// 注册 Element Plus，使组件模板中的 <el-button> 等可在测试中渲染
config.global.plugins = [ElementPlus];

// 全局注册图标组件（与 main.js 的按需注册对齐），避免模板中 <el-icon><Warning /></el-icon> 等解析失败告警
config.global.components = { ...ElementPlusIcons };

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
