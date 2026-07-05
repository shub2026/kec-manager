/**
 * getClassesWithCourse 0 课时过滤单元测试
 *
 * 验证 weekly_hours=0 的课程（本学期暂不开课）被正确过滤：
 * - F-1：数据源 getClassesWithCourse 过滤逻辑
 *
 * Mock 策略：mock prisma 和学期/方案服务函数，隔离数据库依赖。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ──────────────────────────────────────────────
// Mock prisma client（vi.hoisted 确保变量在 mock 提升后可用）
// ──────────────────────────────────────────────
const { mockPlanCoursesFindMany, mockClassesFindMany, mockFindBestMatchPlan } = vi.hoisted(() => ({
  mockPlanCoursesFindMany: vi.fn(),
  mockClassesFindMany: vi.fn(),
  mockFindBestMatchPlan: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    plan_courses: { findMany: mockPlanCoursesFindMany },
    classes: { findMany: mockClassesFindMany },
  },
}));

// ──────────────────────────────────────────────
// Mock logger
// ──────────────────────────────────────────────
vi.mock('../../../utils/logger.js', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ──────────────────────────────────────────────
// Mock 学期/方案服务
// ──────────────────────────────────────────────
vi.mock('../../../services/semester.service.js', () => ({
  parseSemester: vi.fn((str) => {
    // 简单解析 "2025-2026-2" 格式
    const parts = str?.split('-');
    if (!parts || parts.length !== 3) return null;
    const startYear = parseInt(parts[0]);
    const semesterNum = parseInt(parts[2]);
    return {
      startYear,
      endYear: startYear + 1,
      semesterIndex: semesterNum,
      label: str,
      currentSemesterNum: (startYear - 2025) * 2 + semesterNum, // 简化计算
    };
  }),
  calcClassSemester: vi.fn((cls, semesterInfo) => {
    const grade = semesterInfo.startYear - cls.enrollment_year + 1;
    if (grade < 1 || grade > cls.duration_years) return null;
    return {
      grade,
      currentSemesterNum: semesterInfo.currentSemesterNum,
    };
  }),
  getActiveClassFilter: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../services/plan.service.js', () => ({
  findBestMatchPlan: (...args) => mockFindBestMatchPlan(...args),
  isClassMatchPlan: vi.fn(),
  buildClassWithPlanFilter: vi.fn(),
}));

// ──────────────────────────────────────────────
// 导入被测函数（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { getClassesWithCourse } = await import('../../../services/arrange/queries.js');

// ──────────────────────────────────────────────
// 测试数据工厂
// ──────────────────────────────────────────────
const SEMESTER_STR = '2025-2026-2';
const COURSE_ID = 1;
const CURRENT_SEM_NUM = 2; // 2025-2026 第2学期

function makePlanCourse(planId, semRecords) {
  return {
    id: planId * 100,
    training_plans: {
      id: planId,
      name: `方案${planId}`,
      major_id: 1,
      training_level_id: 1,
      sort_order: 0,
      majors: { id: 1, name: '专业A' },
      training_levels: { id: 1, name: '本科' },
      colleges: { id: 1, name: '学院A' },
    },
    courses: { id: COURSE_ID, name: '语文', code: 'CH001', type: 'public' },
    start_semester: 1,
    end_semester: 4,
    weekly_hours: 4, // 默认周课时
    weeks_per_semester: 18,
    plan_course_semesters: semRecords,
  };
}

function makeSemRecord(semester, weeklyHours, textbooks = []) {
  return {
    id: semester * 10,
    semester,
    weekly_hours: weeklyHours,
    weeks_count: 18,
    plan_textbooks: textbooks.map((tb, i) => ({
      id: i,
      textbooks: { id: tb.id, title: tb.title },
    })),
  };
}

function makeClass(id, name, overrides = {}) {
  return {
    id,
    name,
    college_id: 1,
    major_id: 1,
    training_level_id: 1,
    enrollment_year: 2025,
    duration_years: 4,
    student_count: 40,
    custom_plan_id: null,
    colleges: { id: 1, name: '学院A' },
    majors: { id: 1, name: '专业A' },
    training_levels: { id: 1, name: '本科' },
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// 通用 mock 设置
// ──────────────────────────────────────────────
function setupMocks(planCourses, classes) {
  mockPlanCoursesFindMany.mockResolvedValue(planCourses);
  mockClassesFindMany.mockResolvedValue(classes);
  mockFindBestMatchPlan.mockImplementation((cls) => {
    // 默认返回第一个方案
    return planCourses[0]?.training_plans || null;
  });
}

// ──────────────────────────────────────────────
// 测试用例
// ──────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

describe('getClassesWithCourse - 0 课时过滤', () => {
  it('正常课时课程应返回班级', async () => {
    const pc = makePlanCourse(1, [
      makeSemRecord(CURRENT_SEM_NUM, 4, [{ id: 1, title: '语文课本' }]),
    ]);
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(1);
    expect(result[0].classId).toBe(10);
    expect(result[0].weeklyHours).toBe(4);
  });

  it('weekly_hours=0 的班级应被过滤（semRecord 为 0）', async () => {
    const pc = makePlanCourse(1, [
      makeSemRecord(CURRENT_SEM_NUM, 0), // 本学期 0 课时
    ]);
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
  });

  it('weekly_hours 为负数的班级应被过滤', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, -1)]);
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
  });

  it('semRecord 不存在时回退 pc.weekly_hours=0 也应被过滤', async () => {
    // semRecord 的 semester 不匹配当前学期 → semRecord 为 undefined → 回退到 pc.weekly_hours
    const pc = makePlanCourse(1, [
      makeSemRecord(99, 4), // semester=99，不匹配 currentSemesterNum=2
    ]);
    pc.weekly_hours = 0; // 回退值也是 0
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    // semRecord 找不到 → continue（在 0 课时过滤之前就已经被跳过了）
    expect(result).toHaveLength(0);
  });

  it('3 个班级中 1 个 0 课时，应只返回 2 个', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const classes = [makeClass(10, '25级1班'), makeClass(11, '25级2班'), makeClass(12, '25级3班')];
    setupMocks([pc], classes);

    // 让第 2 个班级返回 0 课时
    let callCount = 0;
    mockFindBestMatchPlan.mockImplementation((cls) => {
      callCount++;
      if (cls.id === 11) {
        // 为这个班级创建一个独立的 0 课时方案课程
        return { id: 2, name: '方案B', major_id: 1, training_level_id: 1, sort_order: 0 };
      }
      return pc.training_plans;
    });

    // 添加第二个方案课程（0 课时）
    const pc2 = makePlanCourse(2, [
      makeSemRecord(CURRENT_SEM_NUM, 0), // 0 课时
    ]);
    pc2.training_plans = { id: 2, name: '方案B', major_id: 1, training_level_id: 1, sort_order: 1 };
    mockPlanCoursesFindMany.mockResolvedValue([pc, pc2]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    // 25级2班因 0 课时被过滤
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.classId)).toEqual([10, 12]);
  });

  it('所有班级都是 0 课时，应返回空数组', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 0)]);
    const classes = [makeClass(10, '25级1班'), makeClass(11, '25级2班')];
    setupMocks([pc], classes);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
  });

  it('semRecord.weekly_hours=null 时回退到 pc.weekly_hours>0 应正常返回', async () => {
    const sem = makeSemRecord(CURRENT_SEM_NUM, null); // null → 回退
    const pc = makePlanCourse(1, [sem]);
    pc.weekly_hours = 3; // 回退到 3
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(1);
    expect(result[0].weeklyHours).toBe(3);
  });

  it('semRecord.weekly_hours=null 且 pc.weekly_hours=0 应被过滤', async () => {
    const sem = makeSemRecord(CURRENT_SEM_NUM, null);
    const pc = makePlanCourse(1, [sem]);
    pc.weekly_hours = 0; // 回退也是 0
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
  });

  it('不同学期的 semRecord 不应影响过滤（只看当前学期）', async () => {
    const pc = makePlanCourse(1, [
      makeSemRecord(1, 4), // 第 1 学期 4 课时
      makeSemRecord(CURRENT_SEM_NUM, 0), // 第 2 学期 0 课时
      makeSemRecord(3, 6), // 第 3 学期 6 课时
    ]);
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    // 当前学期（第 2 学期）0 课时 → 被过滤
    expect(result).toHaveLength(0);
  });
});
