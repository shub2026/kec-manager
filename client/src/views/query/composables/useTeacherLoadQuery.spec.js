/**
 * useTeacherLoadQuery（任课查询页）单元测试
 *
 * 覆盖：
 * - 学期初始化 / 切换 / 回到当前学期，以及「当前学期」按钮的禁用判定
 * - 两个 TAB 各自独立的筛选（含动态选项生成）、分页切片、状态保留
 * - 切换 TAB 不重新请求（两视图共用同一次接口返回）
 * - 导出按当前 TAB 分流到教师/教材两个端点
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';

const mockElMessage = vi.hoisted(() => {
  const fn = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.warning = vi.fn();
  fn.info = vi.fn();
  return fn;
});

const mockCacheCalls = vi.hoisted(() => []);

vi.mock('element-plus', () => ({ ElMessage: mockElMessage }));

vi.mock('@/api/query', () => ({ getTeacherLoadQuery: vi.fn() }));

vi.mock('@/api/export', () => ({
  exportTeacherLoad: vi.fn(),
  exportTextbookLoad: vi.fn(),
}));

vi.mock('@/utils/download', () => ({ downloadBlob: vi.fn() }));

// 直通不缓存，便于统计真实请求次数；同时记录 key/ttl 以断言缓存约定
vi.mock('@/utils/cache', () => ({
  getWithCache: vi.fn(async (apiCall, key, ttl) => {
    mockCacheCalls.push({ key, ttl });
    return apiCall();
  }),
}));

// 同步化防抖：防抖本身由 useDebounce.spec.js 覆盖，此处避免定时器与 onUnmounted 干扰
vi.mock('@/composables/useDebounce', () => ({
  useDebounceFn: (fn) => {
    const immediate = (...args) => fn(...args);
    immediate.cancel = () => {};
    return immediate;
  },
}));

vi.mock('@/composables/useSemesters', () => ({
  useSemesters: () => ({
    availableSemesters: [
      { value: '2025-2026-1', label: '2025-2026学年 秋季(第1学期)' },
      { value: '2025-2026-2', label: '2025-2026学年 春季(第2学期)' },
    ],
    fetchCurrentSemester: vi.fn(async () => '2025-2026-2'),
  }),
}));

import { useTeacherLoadQuery } from './useTeacherLoadQuery';
import { getTeacherLoadQuery } from '@/api/query';
import { exportTeacherLoad, exportTextbookLoad } from '@/api/export';
import { downloadBlob } from '@/utils/download';

const CURRENT = '2025-2026-2';

/** 与 composable 内 uniqSorted 相同的中文排序规则（普通 .sort() 按码元序，结果不同） */
const zhSorted = (arr) => [...arr].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

const teacherZhang = {
  teacherId: 1,
  teacherName: '张三',
  personnelType: 'full_time',
  affiliatedCollege: { id: 1, name: '基础学院' },
  collegeList: [
    { id: 1, name: '基础学院' },
    { id: 2, name: '信息学院' },
  ],
  trainingLevelList: [{ id: 1, name: '高职' }],
  courseList: [
    { id: 10, name: '高等数学' },
    { id: 11, name: '线性代数' },
  ],
  textbookCount: 2,
  textbookNames: ['高等数学（上册）', '线性代数'],
  classCount: 2,
  details: [
    {
      unitKey: 'u1',
      courseId: 10,
      courseName: '高等数学',
      classId: 100,
      className: '计科2301',
      isCombined: false,
      combinationNo: null,
      collegeName: '信息学院',
      trainingLevelName: '高职',
      textbookName: '高等数学（上册）',
    },
    {
      unitKey: 'u2',
      courseId: 11,
      courseName: '线性代数',
      classId: 101,
      className: '计科2302、软工2301',
      isCombined: true,
      combinationNo: 3,
      collegeName: '信息学院',
      trainingLevelName: '高职',
      textbookName: '线性代数',
    },
  ],
};

const teacherLi = {
  teacherId: 2,
  teacherName: '李四',
  personnelType: 'part_time',
  affiliatedCollege: null,
  collegeList: [{ id: 3, name: '经管学院' }],
  trainingLevelList: [],
  courseList: [{ id: 10, name: '高等数学' }],
  textbookCount: 1,
  textbookNames: ['高等数学（上册）'],
  classCount: 1,
  details: [
    {
      unitKey: 'u3',
      courseId: 10,
      courseName: '高等数学',
      classId: 102,
      className: '会计2301',
      isCombined: false,
      combinationNo: null,
      collegeName: '经管学院',
      trainingLevelName: null,
      textbookName: '高等数学（上册）',
    },
  ],
};

const textbookMath = {
  textbookId: 500,
  title: '高等数学（上册）',
  isbn: '978-7-04',
  publisher: '高等教育出版社',
  primaryCourse: { id: 10, name: '高等数学' },
  extraCourses: [],
  classCount: 3,
  studentCount: 105,
  teacherCount: 2,
  teachers: [
    { id: 1, name: '张三' },
    { id: 2, name: '李四' },
  ],
  groups: [
    {
      levelId: 1,
      levelName: '高职',
      majorId: 20,
      majorName: '计算机应用技术',
      classCount: 2,
      studentCount: 70,
      teachers: [{ id: 1, name: '张三' }],
    },
    {
      levelId: null,
      levelName: null,
      majorId: null,
      majorName: null,
      classCount: 1,
      studentCount: 35,
      teachers: [{ id: 2, name: '李四' }],
    },
  ],
};

const textbookAlgebra = {
  textbookId: 501,
  title: '线性代数',
  isbn: null,
  publisher: '科学出版社',
  primaryCourse: { id: 11, name: '线性代数' },
  extraCourses: [{ id: 12, name: '工程数学' }],
  classCount: 2,
  studentCount: 68,
  teacherCount: 1,
  teachers: [{ id: 1, name: '张三' }],
  groups: [
    {
      levelId: 1,
      levelName: '高职',
      majorId: 21,
      majorName: '软件技术',
      classCount: 2,
      studentCount: 68,
      teachers: [{ id: 1, name: '张三' }],
    },
  ],
};

function makePayload() {
  return {
    semester: CURRENT,
    semesterLabel: '2025-2026学年 春季(第2学期)',
    teachers: [teacherZhang, teacherLi],
    textbooks: [textbookMath, textbookAlgebra],
    summary: { totalTeachers: 2, totalTextbooks: 2, totalClasses: 4, totalStudents: 173 },
  };
}

/** 挂载并完成首次加载的 composable */
async function setup(payload = makePayload()) {
  getTeacherLoadQuery.mockResolvedValue({ data: payload });
  const ctx = useTeacherLoadQuery();
  await ctx.initSemester();
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCacheCalls.length = 0;
});

describe('学期初始化与加载', () => {
  it('initSemester 落到当前学期并带学期参数请求', async () => {
    const ctx = await setup();

    expect(ctx.semester.value).toBe(CURRENT);
    expect(ctx.isCurrentSemester.value).toBe(true);
    expect(getTeacherLoadQuery).toHaveBeenCalledTimes(1);
    expect(getTeacherLoadQuery).toHaveBeenCalledWith({ semester: CURRENT });
    expect(ctx.loading.value).toBe(false);
    expect(ctx.data.value.summary.totalTeachers).toBe(2);
  });

  it('按约定 key 与 30s TTL 走缓存层', async () => {
    await setup();

    expect(mockCacheCalls).toEqual([{ key: `teacher-load:${CURRENT}`, ttl: 30 * 1000 }]);
  });

  it('无学期时退出加载态且不发请求', async () => {
    getTeacherLoadQuery.mockResolvedValue({ data: makePayload() });
    const ctx = useTeacherLoadQuery();
    ctx.semester.value = '';

    await ctx.loadData();

    expect(getTeacherLoadQuery).not.toHaveBeenCalled();
    expect(ctx.loading.value).toBe(false);
  });

  it('请求失败时取后端 message 并清空数据', async () => {
    getTeacherLoadQuery.mockResolvedValueOnce({ data: makePayload() });
    const ctx = useTeacherLoadQuery();
    await ctx.initSemester();
    expect(ctx.error.value).toBeNull();

    getTeacherLoadQuery.mockRejectedValueOnce({
      response: { data: { message: '学期格式错误，应为 YYYY-YYYY-N' } },
    });
    await ctx.loadData();

    expect(ctx.error.value).toBe('学期格式错误，应为 YYYY-YYYY-N');
    expect(ctx.data.value).toBeNull();
    expect(ctx.loading.value).toBe(false);
  });

  it('失败无 message 时回退默认文案', async () => {
    getTeacherLoadQuery.mockRejectedValueOnce(new Error('network'));
    const ctx = useTeacherLoadQuery();
    ctx.semester.value = CURRENT;

    await ctx.loadData();

    expect(ctx.error.value).toBe('任课数据加载失败，请稍后重试');
  });
});

describe('当前学期按钮', () => {
  it('切到其它学期后按钮可用，goToCurrentSemester 跳回并禁用', async () => {
    const ctx = await setup();

    ctx.semester.value = '2025-2026-1';
    expect(ctx.isCurrentSemester.value).toBe(false);

    await ctx.goToCurrentSemester();

    expect(ctx.semester.value).toBe(CURRENT);
    expect(ctx.isCurrentSemester.value).toBe(true);
    expect(getTeacherLoadQuery).toHaveBeenLastCalledWith({ semester: CURRENT });
  });

  it('未选学期时按钮可用（可借此触发首次加载）', async () => {
    const ctx = await setup();
    ctx.semester.value = '';

    expect(ctx.isCurrentSemester.value).toBe(false);
  });
});

describe('教师视图筛选', () => {
  it('按姓名模糊过滤', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.name = '张';
    await nextTick();

    expect(ctx.filteredTeachers.value.map((t) => t.teacherName)).toEqual(['张三']);
  });

  it('按人员类别过滤', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.personnelType = 'part_time';
    await nextTick();

    expect(ctx.filteredTeachers.value.map((t) => t.teacherId)).toEqual([2]);
  });

  it('按学科命中 courseList 任一项', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.course = '线性代数';
    await nextTick();
    expect(ctx.filteredTeachers.value.map((t) => t.teacherId)).toEqual([1]);

    ctx.teacherFilters.value.course = '高等数学';
    await nextTick();
    expect(ctx.filteredTeachers.value.map((t) => t.teacherId)).toEqual([1, 2]);
  });

  it('按任课学院过滤（命中 collegeList）', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.college = '经管学院';
    await nextTick();

    expect(ctx.filteredTeachers.value.map((t) => t.teacherId)).toEqual([2]);
  });

  it('按归属学院过滤，归属为空的教师不命中', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.affiliatedCollege = '基础学院';
    await nextTick();

    expect(ctx.filteredTeachers.value.map((t) => t.teacherId)).toEqual([1]);
  });

  it('按层次过滤，层次列表为空的教师不命中', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.level = '高职';
    await nextTick();

    expect(ctx.filteredTeachers.value.map((t) => t.teacherId)).toEqual([1]);
  });

  it('多条件为 AND 关系', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.personnelType = 'full_time';
    ctx.teacherFilters.value.college = '经管学院';
    await nextTick();

    expect(ctx.filteredTeachers.value).toHaveLength(0);
  });

  it('筛选项从返回数据去重生成', async () => {
    const ctx = await setup();

    expect(ctx.teacherCourseOptions.value).toEqual(zhSorted(['高等数学', '线性代数']));
    expect(ctx.teacherCollegeOptions.value).toEqual(
      zhSorted(['信息学院', '基础学院', '经管学院'])
    );
    expect(ctx.teacherLevelOptions.value).toEqual(['高职']);
    // 李四归属学院为 null，不应产生空选项
    expect(ctx.affiliatedCollegeOptions.value).toEqual(['基础学院']);
  });

  it('activeFilterCount 统计已填条件，resetFilters 清空', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.name = '张';
    ctx.teacherFilters.value.level = '高职';
    await nextTick();
    expect(ctx.activeFilterCount.value).toBe(2);

    ctx.resetFilters();
    await nextTick();

    expect(ctx.activeFilterCount.value).toBe(0);
    expect(ctx.filteredTeachers.value).toHaveLength(2);
  });
});

describe('教材视图筛选', () => {
  it('按教材名称模糊过滤', async () => {
    const ctx = await setup();

    ctx.textbookFilters.value.title = '线性';
    await nextTick();

    expect(ctx.filteredTextbooks.value.map((t) => t.textbookId)).toEqual([501]);
  });

  it('按学科过滤时同时匹配主学科与附加学科', async () => {
    const ctx = await setup();

    ctx.textbookFilters.value.course = '工程数学';
    await nextTick();
    expect(ctx.filteredTextbooks.value.map((t) => t.textbookId)).toEqual([501]);

    ctx.textbookFilters.value.course = '高等数学';
    await nextTick();
    expect(ctx.filteredTextbooks.value.map((t) => t.textbookId)).toEqual([500]);
  });

  it('按层次过滤，命中任一层次专业分组即可', async () => {
    const ctx = await setup();

    ctx.textbookFilters.value.level = '高职';
    await nextTick();

    expect(ctx.filteredTextbooks.value.map((t) => t.textbookId)).toEqual([500, 501]);
  });

  it('按专业过滤', async () => {
    const ctx = await setup();

    ctx.textbookFilters.value.major = '软件技术';
    await nextTick();

    expect(ctx.filteredTextbooks.value.map((t) => t.textbookId)).toEqual([501]);
  });

  it('筛选项忽略层次/专业为空的分组', async () => {
    const ctx = await setup();

    expect(ctx.textbookCourseOptions.value).toEqual(
      zhSorted(['工程数学', '线性代数', '高等数学'])
    );
    expect(ctx.textbookLevelOptions.value).toEqual(['高职']);
    expect(ctx.textbookMajorOptions.value).toEqual(zhSorted(['计算机应用技术', '软件技术']));
  });

  it('resetFilters 只作用于当前 TAB，另一 TAB 条件保留', async () => {
    const ctx = await setup();

    ctx.teacherFilters.value.name = '张';
    ctx.textbookFilters.value.title = '线性';
    await nextTick();

    ctx.activeTab.value = 'textbook';
    ctx.resetFilters();
    await nextTick();

    expect(ctx.textbookFilters.value.title).toBe('');
    expect(ctx.teacherFilters.value.name).toBe('张');
    expect(ctx.activeFilterCount.value).toBe(0);

    ctx.activeTab.value = 'teacher';
    expect(ctx.activeFilterCount.value).toBe(1);
  });
});

describe('分页', () => {
  async function setupWithManyTeachers(n = 25) {
    const payload = makePayload();
    payload.teachers = Array.from({ length: n }, (_, i) => ({
      ...teacherLi,
      teacherId: 100 + i,
      teacherName: `教师${String(i).padStart(2, '0')}`,
    }));
    return setup(payload);
  }

  it('默认每页 20 条并切出第一页', async () => {
    const ctx = await setupWithManyTeachers(25);

    expect(ctx.teacherPageSize.value).toBe(20);
    expect(ctx.teacherPage.value).toBe(1);
    expect(ctx.pagedTeachers.value).toHaveLength(20);
    expect(ctx.filteredTeachers.value).toHaveLength(25);
  });

  it('翻页取到剩余条目', async () => {
    const ctx = await setupWithManyTeachers(25);

    ctx.teacherPage.value = 2;

    expect(ctx.pagedTeachers.value).toHaveLength(5);
    expect(ctx.pagedTeachers.value[0].teacherName).toBe('教师20');
  });

  it('筛选导致结果减少时页码回到第 1 页', async () => {
    const ctx = await setupWithManyTeachers(25);
    ctx.teacherPage.value = 2;
    expect(ctx.pagedTeachers.value).toHaveLength(5);

    ctx.teacherFilters.value.name = '教师0';
    await nextTick();

    expect(ctx.teacherPage.value).toBe(1);
    expect(ctx.pagedTeachers.value).toHaveLength(10);
  });

  it('两个 TAB 的分页状态互不影响', async () => {
    const ctx = await setupWithManyTeachers(25);
    ctx.teacherPage.value = 2;
    ctx.textbookPage.value = 1;

    ctx.activeTab.value = 'textbook';

    expect(ctx.teacherPage.value).toBe(2);
    expect(ctx.pagedTextbooks.value).toHaveLength(2);
  });
});

describe('切换 TAB', () => {
  it('不触发新的接口请求', async () => {
    const ctx = await setup();
    expect(getTeacherLoadQuery).toHaveBeenCalledTimes(1);

    ctx.activeTab.value = 'textbook';
    await nextTick();
    ctx.activeTab.value = 'teacher';
    await nextTick();

    expect(getTeacherLoadQuery).toHaveBeenCalledTimes(1);
    expect(mockCacheCalls).toHaveLength(1);
  });

  it('各 TAB 的筛选与分页状态保留', async () => {
    const ctx = await setup();
    ctx.teacherFilters.value.name = '张';
    ctx.textbookFilters.value.title = '线性';
    await nextTick();

    ctx.activeTab.value = 'textbook';
    await nextTick();
    ctx.activeTab.value = 'teacher';
    await nextTick();

    expect(ctx.teacherFilters.value.name).toBe('张');
    expect(ctx.textbookFilters.value.title).toBe('线性');
    expect(ctx.filteredTeachers.value).toHaveLength(1);
    expect(ctx.filteredTextbooks.value).toHaveLength(1);
  });
});

describe('学期切换', () => {
  it('清空两套筛选、页码回 1 并重新请求', async () => {
    const ctx = await setup();
    ctx.teacherFilters.value.name = '张';
    ctx.textbookFilters.value.title = '线性';
    ctx.teacherPage.value = 2;
    ctx.textbookPage.value = 2;
    await nextTick();

    ctx.semester.value = '2025-2026-1';
    await ctx.handleSemesterChange();

    expect(ctx.teacherFilters.value.name).toBe('');
    expect(ctx.textbookFilters.value.title).toBe('');
    expect(ctx.teacherPage.value).toBe(1);
    expect(ctx.textbookPage.value).toBe(1);
    expect(getTeacherLoadQuery).toHaveBeenLastCalledWith({ semester: '2025-2026-1' });
    expect(getTeacherLoadQuery).toHaveBeenCalledTimes(2);
    expect(ctx.isCurrentSemester.value).toBe(false);
  });
});

describe('导出', () => {
  it('教师 TAB 调教师导出端点并按学期命名', async () => {
    const ctx = await setup();
    const blob = new Blob(['x']);
    exportTeacherLoad.mockResolvedValue(blob);

    await ctx.handleExport();

    expect(exportTeacherLoad).toHaveBeenCalledWith({ semester: CURRENT });
    expect(downloadBlob).toHaveBeenCalledWith(blob, `任课查询_教师_${CURRENT}.xlsx`);
    expect(mockElMessage.success).toHaveBeenCalledWith('导出成功');
    expect(ctx.exporting.value).toBe(false);
  });

  it('教材 TAB 调教材导出端点', async () => {
    const ctx = await setup();
    ctx.activeTab.value = 'textbook';
    const blob = new Blob(['y']);
    exportTextbookLoad.mockResolvedValue(blob);

    await ctx.handleExport();

    expect(exportTextbookLoad).toHaveBeenCalledWith({ semester: CURRENT });
    expect(exportTeacherLoad).not.toHaveBeenCalled();
    expect(downloadBlob).toHaveBeenCalledWith(blob, `任课查询_教材_${CURRENT}.xlsx`);
  });

  it('无学期时仅提示不请求', async () => {
    const ctx = await setup();
    ctx.semester.value = '';

    await ctx.handleExport();

    expect(mockElMessage.warning).toHaveBeenCalledWith('请先设置当前学期');
    expect(exportTeacherLoad).not.toHaveBeenCalled();
    expect(exportTextbookLoad).not.toHaveBeenCalled();
  });

  it('导出失败时提示并复位 loading', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = await setup();
    exportTeacherLoad.mockRejectedValue(new Error('boom'));

    await ctx.handleExport();

    expect(mockElMessage.error).toHaveBeenCalledWith('导出失败');
    expect(ctx.exporting.value).toBe(false);
    consoleSpy.mockRestore();
  });
});
