/**
 * useCourseMatrixEditing 课程矩阵编辑 composable 单元测试
 *
 * 覆盖：
 * - openEdit：范围校验、已有学期记录直接打开、缺记录自动创建（含创建失败兜底）
 * - saveEdit：0 课时禁选教材、教材设置/清除分支、成功/失败提示
 * - applyGlobalWeeks：批量周数应用与空记录提示
 * - saveSemesterSettings：起止学期校验与保存
 * - handleMoveUp/Down：排序交换与边界
 * - 0 课时自动清除已选教材（watch）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';

const mockElMessage = vi.hoisted(() => {
  const fn = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  return fn;
});

vi.mock('element-plus', () => ({ ElMessage: mockElMessage }));

vi.mock('../api/plan', () => ({
  createSemester: vi.fn().mockResolvedValue({}),
  updateSemester: vi.fn().mockResolvedValue({}),
  updatePlanCourse: vi.fn().mockResolvedValue({}),
  setSemesterTextbook: vi.fn().mockResolvedValue({}),
  removeSemesterTextbook: vi.fn().mockResolvedValue({}),
  batchUpdateSemesterWeeks: vi.fn().mockResolvedValue({}),
  batchUpdateCourseSortOrder: vi.fn().mockResolvedValue({}),
}));

import { useCourseMatrixEditing } from './useCourseMatrixEditing';
import {
  createSemester,
  updateSemester,
  updatePlanCourse,
  setSemesterTextbook,
  removeSemesterTextbook,
  batchUpdateSemesterWeeks,
  batchUpdateCourseSortOrder,
} from '../api/plan';

const SEM = {
  id: 11,
  semester: 1,
  weeklyHours: 4,
  weeksCount: 18,
  planTextbooks: [{ textbookId: 5 }],
};

function makeCourse(overrides = {}) {
  return {
    id: 1,
    startSemester: 1,
    endSemester: 4,
    weeklyHours: 4,
    weeksPerSemester: 18,
    semesters: [SEM],
    planCourseSemesters: [SEM],
    ...overrides,
  };
}

function setup(opts = {}) {
  const rawCourses = ref(opts.courses ?? [makeCourse()]);
  const globalWeeks = ref(18);
  const loadData = vi.fn().mockResolvedValue();
  const editing = useCourseMatrixEditing({
    getPlanId: () => 1,
    rawCourses,
    globalWeeks,
    isInRange: (course, sem) => sem >= course.startSemester && sem <= course.endSemester,
    loadData,
  });
  return { editing, rawCourses, globalWeeks, loadData };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('openEdit', () => {
  it('学期超出开课范围 → 警告且不打开弹窗', async () => {
    const { editing } = setup();
    await editing.openEdit(makeCourse(), 7);
    expect(mockElMessage.warning).toHaveBeenCalledWith('该学期不在课程开课范围内');
    expect(editing.popoverVisible.value).toBe(false);
  });

  it('已有学期记录 → 直接进入编辑并回填教材', async () => {
    const { editing } = setup();
    await editing.openEdit(makeCourse(), 1);
    expect(createSemester).not.toHaveBeenCalled();
    expect(editing.popoverVisible.value).toBe(true);
    expect(editing.editingSemester.value).toMatchObject({ id: 11, weeklyHours: 4 });
    expect(editing.editingTextbookId.value).toBe(5);
  });

  it('缺学期记录 → 自动创建后重载并打开', async () => {
    const created = { id: 12, semester: 2, weeklyHours: 4, weeksCount: 18, planTextbooks: [] };
    const course = makeCourse({ semesters: [], planCourseSemesters: [] });
    const { editing, rawCourses, loadData } = setup({ courses: [course] });
    loadData.mockImplementation(async () => {
      rawCourses.value = [makeCourse({ semesters: [created], planCourseSemesters: [created] })];
    });

    await editing.openEdit(course, 2);

    expect(createSemester).toHaveBeenCalledWith(1, 1, {
      semester: 2,
      weeklyHours: 4,
      weeksCount: 18,
    });
    expect(loadData).toHaveBeenCalled();
    expect(editing.popoverVisible.value).toBe(true);
    expect(editing.editingSemester.value.id).toBe(12);
  });

  it('创建学期记录失败 → 错误提示且不打开', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createSemester.mockRejectedValueOnce(new Error('boom'));
    const course = makeCourse({ semesters: [] });
    const { editing } = setup({ courses: [course] });

    await editing.openEdit(course, 2);

    expect(mockElMessage.error).toHaveBeenCalledWith('创建学期记录失败');
    expect(editing.popoverVisible.value).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('saveEdit', () => {
  it('周课时为 0 且选择了教材 → 拒绝保存', async () => {
    const { editing } = setup();
    await editing.openEdit(makeCourse(), 1);
    editing.editingSemester.value.weeklyHours = 0;
    editing.editingTextbookId.value = 5;

    await editing.saveEdit();

    expect(mockElMessage.warning).toHaveBeenCalledWith('周课时为0时不能选择教材');
    expect(updateSemester).not.toHaveBeenCalled();
  });

  it('保存成功：更新课时 + 设置教材 + 重载', async () => {
    const { editing, loadData } = setup();
    await editing.openEdit(makeCourse(), 1);
    editing.editingSemester.value.weeklyHours = 6;
    editing.editingTextbookId.value = 9;

    await editing.saveEdit();

    expect(updateSemester).toHaveBeenCalledWith(11, { weeklyHours: 6 });
    expect(setSemesterTextbook).toHaveBeenCalledWith(11, { textbookId: 9, isRequired: true });
    expect(removeSemesterTextbook).not.toHaveBeenCalled();
    expect(mockElMessage.success).toHaveBeenCalledWith('保存成功');
    expect(editing.popoverVisible.value).toBe(false);
    expect(loadData).toHaveBeenCalled();
  });

  it('未选教材时清除既有教材关联', async () => {
    const { editing } = setup();
    await editing.openEdit(makeCourse(), 1);
    editing.editingTextbookId.value = null;

    await editing.saveEdit();

    expect(removeSemesterTextbook).toHaveBeenCalledWith(11);
    expect(setSemesterTextbook).not.toHaveBeenCalled();
  });

  it('保存失败 → 错误提示且 saving 归位', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateSemester.mockRejectedValueOnce(new Error('boom'));
    const { editing } = setup();
    await editing.openEdit(makeCourse(), 1);

    await editing.saveEdit();

    expect(mockElMessage.error).toHaveBeenCalledWith('保存失败');
    expect(editing.saving.value).toBe(false);
    consoleSpy.mockRestore();
  });

  it('editingSemester 为空时直接返回', async () => {
    const { editing } = setup();
    await editing.saveEdit();
    expect(updateSemester).not.toHaveBeenCalled();
  });
});

describe('applyGlobalWeeks', () => {
  it('收集全部学期记录 ID 批量更新', async () => {
    const sem2 = { id: 21, semester: 2, weeklyHours: 2, weeksCount: 18 };
    const course = makeCourse({ planCourseSemesters: [SEM, sem2] });
    const { editing, loadData } = setup({ courses: [course] });

    await editing.applyGlobalWeeks();

    expect(batchUpdateSemesterWeeks).toHaveBeenCalledWith([11, 21], 18, 1);
    expect(mockElMessage.success).toHaveBeenCalledWith('已应用周数');
    expect(loadData).toHaveBeenCalled();
  });

  it('无学期记录 → 提示且不调接口', async () => {
    const { editing } = setup({ courses: [makeCourse({ planCourseSemesters: [] })] });
    await editing.applyGlobalWeeks();
    expect(batchUpdateSemesterWeeks).not.toHaveBeenCalled();
    expect(mockElMessage.info).toHaveBeenCalledWith('暂无学期记录可更新');
  });

  it('批量更新失败 → 错误提示', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    batchUpdateSemesterWeeks.mockRejectedValueOnce(new Error('boom'));
    const { editing } = setup();
    await editing.applyGlobalWeeks();
    expect(mockElMessage.error).toHaveBeenCalledWith('应用失败');
    consoleSpy.mockRestore();
  });
});

describe('saveSemesterSettings', () => {
  it('起始学期大于结束学期 → 警告不保存', async () => {
    const { editing } = setup();
    editing.openSemesterSettings(makeCourse({ startSemester: 1, endSemester: 4 }));
    editing.semesterForm.value = { startSemester: 3, endSemester: 2 };

    await editing.saveSemesterSettings();

    expect(mockElMessage.warning).toHaveBeenCalledWith('起始学期不能大于结束学期');
    expect(updatePlanCourse).not.toHaveBeenCalled();
  });

  it('保存成功：更新开课区间并关闭弹窗', async () => {
    const { editing, loadData } = setup();
    editing.openSemesterSettings(makeCourse());
    editing.semesterForm.value = { startSemester: 2, endSemester: 5 };

    await editing.saveSemesterSettings();

    expect(updatePlanCourse).toHaveBeenCalledWith(1, { startSemester: 2, endSemester: 5 });
    expect(mockElMessage.success).toHaveBeenCalledWith('保存成功');
    expect(editing.semesterDialogVisible.value).toBe(false);
    expect(loadData).toHaveBeenCalled();
  });

  it('保存失败 → 错误提示', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    updatePlanCourse.mockRejectedValueOnce(new Error('boom'));
    const { editing } = setup();
    editing.openSemesterSettings(makeCourse());

    await editing.saveSemesterSettings();

    expect(mockElMessage.error).toHaveBeenCalledWith('保存失败');
    expect(editing.saving.value).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('排序移动', () => {
  function makeGroup() {
    return {
      courses: [
        { id: 1, sortOrder: 0 },
        { id: 2, sortOrder: 1 },
        { id: 3, sortOrder: 2 },
      ],
    };
  }

  it('下移：交换后全量上报新排序', async () => {
    const { editing, loadData } = setup();
    const group = makeGroup();

    await editing.handleMoveDown(group.courses[0], group);

    expect(batchUpdateCourseSortOrder).toHaveBeenCalledWith(
      [
        { id: 2, sortOrder: 0 },
        { id: 1, sortOrder: 1 },
        { id: 3, sortOrder: 2 },
      ],
      1
    );
    expect(mockElMessage.success).toHaveBeenCalledWith('排序已更新');
    expect(loadData).toHaveBeenCalled();
  });

  it('上移：交换后全量上报新排序', async () => {
    const { editing } = setup();
    const group = makeGroup();

    await editing.handleMoveUp(group.courses[2], group);

    expect(batchUpdateCourseSortOrder).toHaveBeenCalledWith(
      [
        { id: 1, sortOrder: 0 },
        { id: 3, sortOrder: 1 },
        { id: 2, sortOrder: 2 },
      ],
      1
    );
  });

  it('边界：首个上移 / 末个下移不触发接口', async () => {
    const { editing } = setup();
    const group = makeGroup();
    await editing.handleMoveUp(group.courses[0], group);
    await editing.handleMoveDown(group.courses[2], group);
    expect(batchUpdateCourseSortOrder).not.toHaveBeenCalled();
  });

  it('排序接口失败 → 错误提示', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    batchUpdateCourseSortOrder.mockRejectedValueOnce(new Error('boom'));
    const { editing } = setup();
    const group = makeGroup();

    await editing.handleMoveDown(group.courses[0], group);

    expect(mockElMessage.error).toHaveBeenCalledWith('排序更新失败');
    consoleSpy.mockRestore();
  });
});

describe('watch：0 课时自动清除教材', () => {
  it('课时改为 0 时清空已选教材', async () => {
    const { editing } = setup();
    await editing.openEdit(makeCourse(), 1);
    expect(editing.editingTextbookId.value).toBe(5);

    editing.editingSemester.value.weeklyHours = 0;
    await nextTick();

    expect(editing.editingTextbookId.value).toBeNull();
  });
});
