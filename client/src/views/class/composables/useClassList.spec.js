/**
 * useClassList 班级列表业务组合件单元测试
 *
 * 覆盖：
 * - 加载/分页/错误状态、基础数据与学期信息解析（含 401 提示）
 * - 弹窗表单：编辑回填、默认表单、合班伙伴候选缓存与失败兜底
 * - 保存：必填校验、创建/更新、合班伙伴提交口径
 * - 单个删除、批量删除（全成/全败/部分/异常）
 * - 批量设置（必填校验、结果消息、离校二次确认流程）
 * - 导入进度状态机、导出参数透传
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
  settingsStore: {
    load: vi.fn().mockResolvedValue(),
    currentSemesterValue: vi.fn(() => '2026-2027-1'),
  },
  classDataStore: {
    loadBaseData: vi.fn().mockResolvedValue(),
    ingestRelations: vi.fn(),
  },
  exportData: vi.fn().mockResolvedValue(),
  downloadTemplate: vi.fn().mockResolvedValue(),
  showImportResultCard: vi.fn(),
}));

vi.mock('../../../stores/settings', () => ({
  useSettingsStore: () => mocks.settingsStore,
}));

vi.mock('../../../stores/classData', () => ({
  useClassDataStore: () => mocks.classDataStore,
}));

vi.mock('../../../composables/useExport', () => ({
  useExport: () => ({ exportData: mocks.exportData, downloadTemplate: mocks.downloadTemplate }),
}));

vi.mock('../../../composables/useImport', () => ({
  showImportResultCard: mocks.showImportResultCard,
  validateExcelFile: (file) => file.name.endsWith('.xlsx') || file.name.endsWith('.xls'),
}));

const mockElMessage = vi.hoisted(() => {
  const fn = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  fn.closeAll = vi.fn();
  return fn;
});
const mockElNotification = vi.hoisted(() => vi.fn());

vi.mock('element-plus', () => ({
  ElMessage: mockElMessage,
  ElNotification: mockElNotification,
}));

vi.mock('../../../api/class', () => ({
  getClasses: vi.fn(),
  getClassOptions: vi.fn(),
  createClass: vi.fn(),
  updateClass: vi.fn(),
  deleteClass: vi.fn(),
  batchDeleteClasses: vi.fn(),
  batchUpdateClasses: vi.fn(),
}));

import { useClassList } from './useClassList';
import {
  getClasses,
  getClassOptions,
  createClass,
  updateClass,
  deleteClass,
  batchDeleteClasses,
  batchUpdateClasses,
} from '../../../api/class';

async function setup() {
  let c;
  const wrapper = mount(
    defineComponent({
      setup() {
        c = useClassList();
        return () => h('div');
      },
    }),
    { global: { plugins: [] } }
  );
  await flushPromises(); // 等待 onMounted 的 load + loadBaseData
  return { wrapper, c };
}

beforeEach(() => {
  vi.clearAllMocks();
  getClasses.mockResolvedValue({ data: { items: [], total: 0 } });
  getClassOptions.mockResolvedValue({ data: { items: [] } });
  createClass.mockResolvedValue({});
  updateClass.mockResolvedValue({});
  deleteClass.mockResolvedValue({});
  batchDeleteClasses.mockResolvedValue({ data: { succeeded: [], failed: [] } });
  batchUpdateClasses.mockResolvedValue({ data: { succeeded: [], failed: [] } });
  mocks.settingsStore.load.mockResolvedValue();
  mocks.settingsStore.currentSemesterValue.mockReturnValue('2026-2027-1');
  mocks.classDataStore.loadBaseData.mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('加载与分页', () => {
  it('加载成功写入列表、总数并同步关联数据', async () => {
    getClasses.mockResolvedValue({
      data: { items: [{ id: 1, name: 'A班' }], total: 42 },
    });
    const { c } = await setup();

    await c.load();

    expect(c.list.value).toEqual([{ id: 1, name: 'A班' }]);
    expect(c.pagination.value.total).toBe(42);
    expect(c.loading.value).toBe(false);
    expect(mocks.classDataStore.ingestRelations).toHaveBeenCalled();
  });

  it('加载失败写入错误消息（含后端消息）', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getClasses.mockRejectedValue({ response: { data: { message: '服务异常' } } });
    const { c } = await setup();

    await c.load();

    expect(c.error.value).toBe('服务异常');
    expect(c.loading.value).toBe(false);
    consoleSpy.mockRestore();
  });

  it('handlePageChange / handleSizeChange 更新分页并重载', async () => {
    const { c } = await setup();
    const callsBefore = getClasses.mock.calls.length;

    c.handlePageChange(3);
    await flushPromises();
    expect(c.pagination.value.page).toBe(3);

    c.handleSizeChange(50);
    await flushPromises();
    expect(c.pagination.value.pageSize).toBe(50);
    expect(c.pagination.value.page).toBe(1); // 改页大小时回到第一页

    expect(getClasses.mock.calls.length).toBe(callsBefore + 2);
  });

  it('resetPaginationAndLoad 回到第一页并加载', async () => {
    const { c } = await setup();
    c.pagination.value.page = 5;
    c.resetPaginationAndLoad();
    await flushPromises();
    expect(c.pagination.value.page).toBe(1);
  });
});

describe('基础数据与学期信息', () => {
  it('解析学期配置为结构化信息', async () => {
    const { c } = await setup();
    expect(c.currentSemesterInfo.value).toEqual({
      startYear: 2026,
      endYear: 2027,
      semesterIndex: 1,
    });
  });

  it('学期配置缺失时不写入', async () => {
    mocks.settingsStore.currentSemesterValue.mockReturnValue(null);
    const { c } = await setup();
    expect(c.currentSemesterInfo.value).toBeNull();
  });

  it('401 时提示先登录', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.settingsStore.load.mockRejectedValue({ response: { status: 401 } });
    await setup();
    expect(mockElMessage.warning).toHaveBeenCalledWith('请先登录后再使用班级管理功能');
    consoleSpy.mockRestore();
  });

  it('其他错误提示刷新重试', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.classDataStore.loadBaseData.mockRejectedValue(new Error('boom'));
    await setup();
    expect(mockElMessage.error).toHaveBeenCalledWith('加载基础数据失败，请刷新页面重试');
    consoleSpy.mockRestore();
  });
});

describe('弹窗表单', () => {
  it('编辑行：回填表单并映射合班伙伴', async () => {
    const { c } = await setup();
    await c.openDialog({
      id: 9,
      name: 'A班',
      isCombinedClass: true,
      partnerClassIds: [2, 3],
    });

    expect(c.dialogVisible.value).toBe(true);
    expect(c.form.value.id).toBe(9);
    expect(c.form.value.isCombinedClass).toBe(true);
    expect(c.form.value.combinationClassIds).toEqual([2, 3]);
  });

  it('新建：重置为默认表单', async () => {
    const { c } = await setup();
    await c.openDialog(null);
    expect(c.form.value.id).toBeNull();
    expect(c.form.value.name).toBe('');
    expect(c.form.value.isCombinedClass).toBe(false);
  });

  it('合班候选首次打开时加载并缓存，二次打开不重复请求', async () => {
    getClassOptions.mockResolvedValue({
      data: {
        items: [{ id: 1, name: 'A', collegeId: 2, combinationId: null, matchedPlanId: 5 }],
      },
    });
    const { c } = await setup();

    await c.openDialog(null);
    await c.openDialog(null);

    expect(getClassOptions).toHaveBeenCalledTimes(1);
    expect(c.allClassOptions.value).toEqual([
      { id: 1, name: 'A', collegeId: 2, combinationId: null, matchedPlanId: 5 },
    ]);
  });

  it('候选加载失败时回退空列表不阻断弹窗', async () => {
    getClassOptions.mockRejectedValue(new Error('down'));
    const { c } = await setup();

    await c.openDialog(null);

    expect(c.allClassOptions.value).toEqual([]);
    expect(c.dialogVisible.value).toBe(true);
  });
});

describe('保存', () => {
  async function openNewForm(c) {
    await c.openDialog(null);
    c.form.value.name = '新班级';
    c.form.value.enrollmentYear = 2026;
    c.form.value.durationYears = 3;
    c.form.value.trainingLevelId = 2;
  }

  it('缺必填项时拒绝提交', async () => {
    const { c } = await setup();
    await c.openDialog(null); // 全默认，缺 name/trainingLevelId

    await c.handleSave();

    expect(mockElMessage.error).toHaveBeenCalledWith('请填写必填项');
    expect(createClass).not.toHaveBeenCalled();
  });

  it('新建走 createClass，成功提示并刷新列表', async () => {
    const { c } = await setup();
    await openNewForm(c);

    await c.handleSave();

    expect(createClass).toHaveBeenCalledWith(
      expect.objectContaining({ name: '新班级', trainingLevelId: 2 })
    );
    expect(mockElMessage.success).toHaveBeenCalledWith('创建成功');
    expect(c.dialogVisible.value).toBe(false);
  });

  it('编辑走 updateClass', async () => {
    const { c } = await setup();
    await c.openDialog({ id: 7, name: '旧名', isCombinedClass: false });
    c.form.value.trainingLevelId = 2;
    c.form.value.enrollmentYear = 2026;
    c.form.value.durationYears = 3;

    await c.handleSave();

    expect(updateClass).toHaveBeenCalledWith(7, expect.objectContaining({ name: '旧名' }));
    expect(mockElMessage.success).toHaveBeenCalledWith('更新成功');
  });

  it('合班开关控制伙伴提交口径：关闭时提交空数组', async () => {
    const { c } = await setup();
    await openNewForm(c);
    c.form.value.isCombinedClass = false;
    c.form.value.combinationClassIds = [2, 3];

    await c.handleSave();

    expect(createClass).toHaveBeenCalledWith(expect.objectContaining({ combinationClassIds: [] }));
  });

  it('合班开启时伙伴 ID 转数字并过滤非法值', async () => {
    const { c } = await setup();
    await openNewForm(c);
    c.form.value.isCombinedClass = true;
    c.form.value.combinationClassIds = ['2', 0, 3, -1];

    await c.handleSave();

    expect(createClass).toHaveBeenCalledWith(
      expect.objectContaining({ combinationClassIds: [2, 3] })
    );
  });

  it('保存失败提示后端消息且不关弹窗', async () => {
    createClass.mockRejectedValue({ response: { data: { message: '班级名称已存在' } } });
    const { c } = await setup();
    await openNewForm(c);

    await c.handleSave();

    expect(mockElMessage.error).toHaveBeenCalledWith('班级名称已存在');
    expect(c.dialogVisible.value).toBe(true);
    expect(c.saving.value).toBe(false);
  });
});

describe('单个删除', () => {
  it('删除成功通知含班级名', async () => {
    getClasses.mockResolvedValue({
      data: { items: [{ id: 5, name: '五年一班' }], total: 1 },
    });
    const { c } = await setup();
    await c.load();

    c.handleDelete(5);
    expect(c.deleteConfirmVisible.value).toBe(true);
    await c.confirmDelete();

    expect(deleteClass).toHaveBeenCalledWith(5, { silent: true });
    expect(mockElNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: '删除成功', message: '已删除班级：五年一班' })
    );
    expect(c.deleteConfirmVisible.value).toBe(false);
  });

  it('删除失败通知含原因', async () => {
    deleteClass.mockRejectedValue({ response: { data: { message: '存在排课记录' } } });
    getClasses.mockResolvedValue({ data: { items: [{ id: 5, name: 'X班' }], total: 1 } });
    const { c } = await setup();
    await c.load();

    c.handleDelete(5);
    await c.confirmDelete();

    expect(mockElNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: '删除失败', message: 'X班：存在排课记录' })
    );
  });
});

describe('批量删除', () => {
  async function selectTwo(c) {
    c.handleSelectionChange([
      { id: 1, name: 'A班' },
      { id: 2, name: 'B班' },
    ]);
  }

  it('全部成功 → 成功通知', async () => {
    batchDeleteClasses.mockResolvedValue({
      data: { succeeded: [{ id: 1 }, { id: 2 }], failed: [] },
    });
    const { c } = await setup();
    await selectTwo(c);

    c.handleBatchDelete();
    expect(c.batchDeleteConfirmMessage.value).toContain('2 个班级');
    await c.confirmBatchDelete();

    expect(batchDeleteClasses).toHaveBeenCalledWith([1, 2], { silent: true });
    expect(mockElNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: '批量删除完成', type: 'success' })
    );
    expect(c.selectedClasses.value).toEqual([]);
  });

  it('全部失败且均为排课记录 → 警告通知', async () => {
    batchDeleteClasses.mockResolvedValue({
      data: {
        succeeded: [],
        failed: [
          { id: 1, reason: '存在排课记录' },
          { id: 2, reason: '存在排课记录' },
        ],
      },
    });
    const { c } = await setup();
    await selectTwo(c);

    await c.confirmBatchDelete();

    expect(mockElNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '批量删除失败',
        message: '2 个班级存在排课记录，无法删除',
        type: 'warning',
      })
    );
  });

  it('部分成功 → 汇总通知', async () => {
    batchDeleteClasses.mockResolvedValue({
      data: {
        succeeded: [{ id: 1 }],
        failed: [{ id: 2, reason: '存在排课记录' }],
      },
    });
    const { c } = await setup();
    await selectTwo(c);

    await c.confirmBatchDelete();

    expect(mockElNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '批量删除部分成功',
        message: '成功删除 1 个，1 个存在排课记录无法删除',
        type: 'warning',
      })
    );
  });

  it('请求异常 → 错误通知并清空选择', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    batchDeleteClasses.mockRejectedValue(new Error('network'));
    const { c } = await setup();
    await selectTwo(c);

    await c.confirmBatchDelete();

    expect(mockElNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: '批量删除失败', message: 'network', type: 'error' })
    );
    expect(c.selectedClasses.value).toEqual([]);
    consoleSpy.mockRestore();
  });
});

describe('批量设置', () => {
  it('弹窗标题随类型切换', async () => {
    const { c } = await setup();
    c.openBatchSetDialog('major');
    expect(c.batchDialogTitle.value).toBe('批量设置专业');
    expect(c.batchDialogVisible.value).toBe(true);
  });

  it('批量设置专业未选择时拒绝提交', async () => {
    const { c } = await setup();
    c.openBatchSetDialog('major');
    c.handleSelectionChange([{ id: 1 }]);

    await c.handleBatchSet();

    expect(mockElMessage.error).toHaveBeenCalledWith('请选择专业');
    expect(batchUpdateClasses).not.toHaveBeenCalled();
  });

  it('批量设置学院成功后提示并清空选择', async () => {
    batchUpdateClasses.mockResolvedValue({
      data: { succeeded: [{ id: 1 }, { id: 2 }], failed: [] },
    });
    const { c } = await setup();
    c.openBatchSetDialog('college');
    c.batchForm.value.collegeId = 8;
    c.handleSelectionChange([{ id: 1 }, { id: 2 }]);

    await c.handleBatchSet();

    expect(batchUpdateClasses).toHaveBeenCalledWith([1, 2], { collegeId: 8 });
    expect(mockElMessage.success).toHaveBeenCalledWith('批量设置成功，已更新 2 个班级');
    expect(c.selectedClasses.value).toEqual([]);
  });

  it('部分成功给出警告', async () => {
    batchUpdateClasses.mockResolvedValue({
      data: { succeeded: [{ id: 1 }], failed: [{ id: 2, reason: '学院不一致' }] },
    });
    const { c } = await setup();
    c.openBatchSetDialog('college');
    c.batchForm.value.collegeId = 8;
    c.handleSelectionChange([{ id: 1 }, { id: 2 }]);

    await c.handleBatchSet();

    expect(mockElMessage.warning).toHaveBeenCalledWith('批量设置部分成功：成功 1 个，失败 1 个');
  });

  it('离校标记需二次确认：确认后执行', async () => {
    batchUpdateClasses.mockResolvedValue({ data: { succeeded: [{ id: 1 }], failed: [] } });
    const { c } = await setup();
    c.openBatchSetDialog('leftSchool');
    c.batchForm.value.isLeftSchool = true;
    c.handleSelectionChange([{ id: 1 }]);

    const pending = c.handleBatchSet();
    await flushPromises();
    expect(c.leftSchoolConfirmVisible.value).toBe(true);

    c.confirmLeftSchool();
    await pending;

    expect(batchUpdateClasses).toHaveBeenCalledWith([1], { isLeftSchool: true });
  });

  it('离校标记二次确认：取消后不执行', async () => {
    const { c } = await setup();
    c.openBatchSetDialog('leftSchool');
    c.batchForm.value.isLeftSchool = true;
    c.handleSelectionChange([{ id: 1 }]);

    const pending = c.handleBatchSet();
    await flushPromises();
    c.cancelLeftSchoolConfirm();
    await pending;

    expect(batchUpdateClasses).not.toHaveBeenCalled();
  });
});

describe('导入与导出', () => {
  const xlsxFile = { name: 'classes.xlsx', size: 1024 };

  it('beforeImport 校验通过后打开进度弹窗', async () => {
    const { c } = await setup();
    expect(c.beforeImport(xlsxFile)).toBe(true);
    expect(c.progressDialogVisible.value).toBe(true);
    expect(c.progressText.value).toBe('正在上传文件...');
  });

  it('beforeImport 非 Excel 文件前置拦截，不打开进度弹窗', async () => {
    const { c } = await setup();
    expect(c.beforeImport({ name: 'a.txt', size: 1024 })).toBe(false);
    expect(c.progressDialogVisible.value).toBe(false);
  });

  it('导入成功：进度完成后展示结果卡片并刷新', async () => {
    vi.useFakeTimers();
    const { c } = await setup();
    c.beforeImport(xlsxFile);

    c.onImportSuccess({
      data: { total: 10, imported: 9, overwritten: 0, failed: 1, errors: ['第3行错'] },
    });
    expect(c.progressStatus.value).toBe('warning');
    expect(c.progressPercent.value).toBe(100);

    vi.advanceTimersByTime(800);
    await flushPromises();

    expect(c.progressDialogVisible.value).toBe(false);
    expect(mocks.showImportResultCard).toHaveBeenCalledWith(
      expect.objectContaining({ title: '导入完成（部分失败）', type: 'warning', failed: 1 })
    );
  });

  it('导入全部失败：状态为 exception', async () => {
    vi.useFakeTimers();
    const { c } = await setup();
    c.beforeImport(xlsxFile);

    c.onImportSuccess({ data: { total: 2, imported: 0, overwritten: 0, failed: 2, errors: [] } });
    expect(c.progressStatus.value).toBe('exception');
    expect(c.progressText.value).toBe('导入失败');
  });

  it('导入异常：延迟后提示错误', async () => {
    vi.useFakeTimers();
    const { c } = await setup();
    c.beforeImport(xlsxFile);

    c.onImportError(new Error('格式错误'));
    expect(c.progressStatus.value).toBe('exception');
    expect(c.progressDetail.value).toBe('格式错误');

    vi.advanceTimersByTime(1500);
    expect(mockElMessage.error).toHaveBeenCalledWith('导入失败');
  });

  it('导出透传当前筛选条件', async () => {
    const { c } = await setup();
    c.filters.value.name = '计算机';
    c.filters.value.majorId = 3;

    await c.handleExport();

    expect(mocks.exportData).toHaveBeenCalledWith({ name: '计算机', majorId: 3 });
  });

  it('无筛选条件时导出参数为空对象', async () => {
    const { c } = await setup();
    await c.handleExport();
    expect(mocks.exportData).toHaveBeenCalledWith({});
  });
});
