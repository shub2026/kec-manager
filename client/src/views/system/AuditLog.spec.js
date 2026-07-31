/**
 * AuditLog 筛选/翻页交互测试
 *
 * 覆盖修复点 F1：在第 N 页变更筛选条件时，必须先把 currentPage 重置为 1 再请求，
 * 否则会停留在筛选后可能已越界（为空）的页码。
 * 三个筛选下拉的 @change 统一走 handleFilterChange，重置按钮 resetFilters 同样置 1。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// ---- mock API 模块 ----
vi.mock('@/api/audit', () => ({
  getAuditLogs: vi.fn(),
}));
vi.mock('@/api/settings', () => ({
  resetAuditLogs: vi.fn(),
}));

import AuditLog from '@/views/system/AuditLog.vue';
import { getAuditLogs } from '@/api/audit';

// 子组件 stub —— PageHeader 需保留 extra 具名插槽，否则工具栏/按钮结构无关，主体仍在 el-card 内
const STUBS = {
  PageHeader: {
    template: '<div class="stub-page-header"><slot name="extra" /></div>',
  },
  EmptyState: { template: '<div class="stub-empty" />' },
  ListErrorState: {
    props: ['message'],
    emits: ['retry'],
    template: '<div class="stub-error">{{ message }}</div>',
  },
  // 图标组件由 unplugin 自动引入，测试环境未注册，stub 掉以消除解析告警
  Delete: true,
  Refresh: true,
};

// total 远大于 pageSize(20)，构造出多页场景以便翻页
const SAMPLE = {
  logs: [
    {
      id: 1,
      action: 'login',
      module: 'auth',
      result: 'success',
      message: '登录成功',
      createdAt: '2026-01-01T08:00:00.000Z',
      ip: '127.0.0.1',
      details: null,
    },
  ],
  total: 100,
};

// onMounted 内的异步 loadLogs 需要一个宏任务周期才结算
const flush = () => new Promise((r) => setTimeout(r, 50));

const mountLog = () => mount(AuditLog, { global: { stubs: STUBS } });

// 翻到指定页：模拟 el-pagination 的 v-model 更新 + current-change 事件
async function goToPage(wrapper, page) {
  const pagination = wrapper.findComponent({ name: 'ElPagination' });
  pagination.vm.$emit('update:current-page', page);
  await nextTick();
  pagination.vm.$emit('current-change', page);
  await flush();
}

describe('AuditLog — 筛选/翻页交互 (F1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuditLogs.mockResolvedValue({ data: { ...SAMPLE } });
  });

  it('首次加载请求第 1 页', async () => {
    mountLog();
    await flush();

    expect(getAuditLogs).toHaveBeenCalledTimes(1);
    expect(getAuditLogs.mock.calls[0][0].page).toBe(1);
  });

  it('翻页后按当前页码请求', async () => {
    const wrapper = mountLog();
    await flush();

    await goToPage(wrapper, 3);

    expect(getAuditLogs.mock.lastCall[0].page).toBe(3);
  });

  it('第 3 页时变更筛选：页码重置回第 1 页', async () => {
    const wrapper = mountLog();
    await flush();

    // 先翻到第 3 页，确认此时请求的是第 3 页
    await goToPage(wrapper, 3);
    expect(getAuditLogs.mock.lastCall[0].page).toBe(3);

    // 变更第一个筛选下拉（操作类型）→ handleFilterChange 应把页码重置为 1
    // 先经 v-model 写入选中值，再触发 change（模拟 el-select 真实的两个事件顺序）
    const select = wrapper.findAllComponents({ name: 'ElSelect' })[0];
    select.vm.$emit('update:modelValue', 'login');
    await nextTick();
    select.vm.$emit('change', 'login');
    await flush();

    expect(getAuditLogs.mock.lastCall[0].page).toBe(1);
    expect(getAuditLogs.mock.lastCall[0].action).toBe('login');
  });

  it('点击重置按钮也回到第 1 页', async () => {
    const wrapper = mountLog();
    await flush();

    await goToPage(wrapper, 2);
    expect(getAuditLogs.mock.lastCall[0].page).toBe(2);

    const resetBtn = wrapper.findAll('button').find((b) => b.text().includes('重置'));
    expect(resetBtn).toBeTruthy();
    await resetBtn.trigger('click');
    await flush();

    expect(getAuditLogs.mock.lastCall[0].page).toBe(1);
  });
});
