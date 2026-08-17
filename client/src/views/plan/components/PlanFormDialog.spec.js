import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import PlanFormDialog from '@/views/plan/components/PlanFormDialog.vue';

// 组件已在 vitest.setup.js 中全局注册 Element Plus
const flush = () => new Promise((resolve) => setTimeout(resolve));

let wrapper;

function factory(props = {}) {
  wrapper = mount(PlanFormDialog, {
    props: {
      visible: true,
      colleges: [{ id: 1, name: '教育学院' }],
      majors: [{ id: 10, name: '学前教育' }],
      trainingLevels: [{ id: 20, name: '中职' }],
      ...props,
    },
    attachTo: document.body,
  });
  return wrapper;
}

// 无论断言成败都卸载，避免残留弹窗 DOM 污染后续用例的查询
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('PlanFormDialog（新增/编辑方案弹窗）', () => {
  it('新增模式：标题为新增方案且表单为空', async () => {
    factory({ plan: null });
    await flush();
    const dialog = document.querySelector('.el-dialog');
    expect(dialog.textContent).toContain('新增方案');
    const nameInput = dialog.querySelector('input[maxlength="200"]');
    expect(nameInput.value).toBe('');
  });

  it('编辑模式（按专业）：回填表单并展示按专业提示', async () => {
    factory({
      plan: { id: 5, name: '学前方案V1', majorId: 10, trainingLevelId: null, version: 'V1.0' },
    });
    await flush();
    const dialog = document.querySelector('.el-dialog');
    expect(dialog.textContent).toContain('编辑方案');
    expect(dialog.textContent).toContain('该方案关联特定专业');
    expect(dialog.querySelector('input[maxlength="200"]').value).toBe('学前方案V1');
  });

  it('编辑模式（按层次）：关联模式切换为按层次提示', async () => {
    factory({
      plan: { id: 6, name: '层次方案', majorId: null, trainingLevelId: 20 },
    });
    await flush();
    expect(document.querySelector('.el-dialog').textContent).toContain('该方案关联特定培养层次');
  });

  it('名称为空保存不触发 save 事件（表单校验拦截）', async () => {
    factory({ plan: null });
    await flush();
    const buttons = [...document.querySelectorAll('.el-dialog__footer button')];
    buttons.find((b) => b.textContent.includes('保存')).click();
    await flush();
    expect(wrapper.emitted('save')).toBeFalsy();
  });

  it('取消按钮触发 update:visible(false)', async () => {
    factory({ plan: null });
    await flush();
    const buttons = [...document.querySelectorAll('.el-dialog__footer button')];
    buttons.find((b) => b.textContent.includes('取消')).click();
    await flush();
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false]);
  });
});
