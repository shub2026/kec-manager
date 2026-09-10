import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import TextbookFormDialog from '@/views/textbook/components/TextbookFormDialog.vue';

// 组件已在 vitest.setup.js 中全局注册 Element Plus
const flush = () => new Promise((resolve) => setTimeout(resolve));

let wrapper;

function factory() {
  wrapper = mount(TextbookFormDialog, { props: { saving: false }, attachTo: document.body });
  return wrapper;
}

// 无论断言成败都卸载，避免残留弹窗 DOM 污染后续用例的查询
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const FILLED_ROW = {
  id: 42,
  title: '学前教育学',
  isbn: '978-7-04-000000-0',
  publisher: '高等教育出版社',
  author: '张三',
  edition: '第3版',
  publishDate: '2024-01',
  price: 45.5,
  category: '技工',
  description: '备注内容',
  isActive: true,
  sortOrder: 3,
};

// 按表单项标签定位输入框：标签文案与模板中的 label 一致
function inputByLabel(label) {
  const items = [...document.querySelectorAll('.el-dialog .el-form-item')];
  const item = items.find(
    (i) => i.querySelector('.el-form-item__label')?.textContent.trim() === label
  );
  if (!item) throw new Error(`未找到标签为「${label}」的表单项`);
  return item.querySelector('input, textarea');
}

// 模拟用户删空输入框内容：input 事件驱动 v-model，change 事件让 el-input-number 提交
async function clearByLabel(label) {
  const el = inputByLabel(label);
  el.value = '';
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
}

async function openFilledRow() {
  factory();
  await flush();
  wrapper.vm.open({ ...FILLED_ROW });
  await flush();
}

function clickSave() {
  const buttons = [...document.querySelectorAll('.el-dialog__footer button')];
  buttons.find((b) => b.textContent.includes('保存')).click();
}

function savedPayload() {
  const events = wrapper.emitted('save');
  expect(events).toBeTruthy();
  return events.at(-1)[0].data;
}

describe('TextbookFormDialog（新增/编辑教材弹窗）', () => {
  it('编辑态回填后直接保存应保留原有字段值', async () => {
    await openFilledRow();
    clickSave();
    await flush();

    expect(savedPayload()).toMatchObject({
      publisher: '高等教育出版社',
      isbn: '978-7-04-000000-0',
      price: 45.5,
    });
  });

  // 回归：清空的字段若转成 undefined 会被 JSON.stringify 丢键，
  // 后端 buildUpdateData 将缺失字段视为"本次不修改"，导致删掉的内容保存后仍存在
  it('清空出版社后 payload 必须带 publisher: null（键不可缺失）', async () => {
    await openFilledRow();
    await clearByLabel('出版社');
    clickSave();
    await flush();

    const payload = savedPayload();
    expect(payload).toHaveProperty('publisher', null);
  });

  it('清空全部可空文本字段后应逐个发 null', async () => {
    await openFilledRow();
    for (const label of ['书号', '出版社', '版次', '出版日期', '作者', '备注']) {
      await clearByLabel(label);
    }
    clickSave();
    await flush();

    expect(savedPayload()).toMatchObject({
      isbn: null,
      publisher: null,
      edition: null,
      publishDate: null,
      author: null,
      description: null,
    });
  });

  it('清空定价后 payload 必须带 price: null', async () => {
    await openFilledRow();
    await clearByLabel('定价');
    clickSave();
    await flush();

    expect(savedPayload()).toHaveProperty('price', null);
  });

  it('定价设为 0 应保留 0 而非被当作空值', async () => {
    await openFilledRow();
    const el = inputByLabel('定价');
    el.value = '0';
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flush();
    clickSave();
    await flush();

    expect(savedPayload().price).toBe(0);
  });
});
