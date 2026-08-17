import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import PlanNewVersionDialog from '@/views/plan/components/PlanNewVersionDialog.vue';

// 组件已在 vitest.setup.js 中全局注册 Element Plus
const source = { id: 1, name: '高级工人培训方案', version: 'V1.2' };
const flush = () => new Promise((resolve) => setTimeout(resolve));

let wrapper;

function factory(props = {}) {
  wrapper = mount(PlanNewVersionDialog, {
    props: { visible: true, source, ...props },
    attachTo: document.body,
  });
  return wrapper;
}

// 无论断言成败都卸载，避免残留弹窗 DOM 污染后续用例的查询
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('PlanNewVersionDialog（派生新版本弹窗）', () => {
  it('打开时展示源方案并预填名称/版本号/起始年份', async () => {
    factory();
    await flush();
    expect(document.body.textContent).toContain(source.name); // 源方案展示
    // 名称输入框预填"（新版本）"后缀
    const nameInput = document.querySelector('.el-dialog input[maxlength="200"]');
    expect(nameInput.value).toBe(`${source.name}（新版本）`);
    // 版本号输入框预填 V1.2 → V2.0
    const versionInput = document.querySelectorAll('.el-dialog input')[1];
    expect(versionInput.value).toBe('V2.0');
  });

  it('源方案无版本号时版本号留空', async () => {
    factory({ source: { id: 2, name: '无版本方案', version: '' } });
    await flush();
    const versionInput = document.querySelectorAll('.el-dialog input')[1];
    expect(versionInput.value).toBe('');
  });

  it('清空名称后保存不触发 save 事件', async () => {
    factory();
    await flush();
    const nameInput = document.querySelector('.el-dialog input[maxlength="200"]');
    nameInput.value = '';
    nameInput.dispatchEvent(new window.Event('input'));
    await flush();
    const buttons = [...document.querySelectorAll('.el-dialog__footer button')];
    buttons.find((b) => b.textContent.includes('保存')).click();
    await flush();
    expect(wrapper.emitted('save')).toBeFalsy();
  });

  it('预填状态下保存触发 save 事件并携带表单载荷', async () => {
    factory();
    await flush();
    const buttons = [...document.querySelectorAll('.el-dialog__footer button')];
    buttons.find((b) => b.textContent.includes('保存')).click();
    await flush();
    const payload = wrapper.emitted('save')?.[0]?.[0];
    expect(payload).toBeTruthy();
    expect(payload.name).toBe(`${source.name}（新版本）`);
    expect(payload.version).toBe('V2.0');
    expect(payload.applyFromYear).toBe(new Date().getFullYear());
    expect(payload.updateSourceEndYear).toBe(true);
  });

  it('取消按钮触发 update:visible(false)', async () => {
    factory();
    await flush();
    const buttons = [...document.querySelectorAll('.el-dialog__footer button')];
    buttons.find((b) => b.textContent.includes('取消')).click();
    await flush();
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false]);
  });
});
