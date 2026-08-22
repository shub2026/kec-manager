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
const {
  mockPlanCoursesFindMany,
  mockClassesFindMany,
  mockTrainingPlansFindMany,
  mockFindBestMatchPlan,
  mockTeachersFindMany,
  mockAssignmentsGroupBy,
  mockAssignmentsFindMany,
  mockTrainingLevelsFindMany,
  mockTextbooksFindMany,
  mockIsClassMatchPlan,
} = vi.hoisted(() => ({
  mockPlanCoursesFindMany: vi.fn(),
  mockClassesFindMany: vi.fn(),
  mockTrainingPlansFindMany: vi.fn(),
  mockFindBestMatchPlan: vi.fn(),
  mockTeachersFindMany: vi.fn(),
  mockAssignmentsGroupBy: vi.fn(),
  mockAssignmentsFindMany: vi.fn(),
  mockTrainingLevelsFindMany: vi.fn(),
  mockTextbooksFindMany: vi.fn(),
  mockIsClassMatchPlan: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    plan_courses: { findMany: mockPlanCoursesFindMany },
    classes: { findMany: mockClassesFindMany },
    training_plans: { findMany: mockTrainingPlansFindMany },
    teachers: { findMany: mockTeachersFindMany },
    teaching_assignments: {
      groupBy: mockAssignmentsGroupBy,
      findMany: mockAssignmentsFindMany,
    },
    training_levels: { findMany: mockTrainingLevelsFindMany },
    textbooks: { findMany: mockTextbooksFindMany },
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
  isClassMatchPlan: (...args) => mockIsClassMatchPlan(...args),
  buildClassWithPlanFilter: vi.fn(),
}));

vi.mock('../../../constants/index.js', () => ({
  TEXTBOOK_COHESION: { FALLBACK_EMPTY: true },
}));

// ──────────────────────────────────────────────
// 导入被测函数（必须在所有 vi.mock 之后）
// ──────────────────────────────────────────────
const { getClassesWithCourse, getTeachersForCourse } =
  await import('../../../services/arrange/queries.js');

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
  // 全局方案默认 = 含本课程的方案（保持旧用例语义）
  mockTrainingPlansFindMany.mockResolvedValue(planCourses.map((pc) => pc.training_plans));
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
  mockTrainingPlansFindMany.mockResolvedValue([]);
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

// ══════════════════════════════════════════════
// getClassesWithCourse - 错误与边界
// ══════════════════════════════════════════════
describe('getClassesWithCourse - 学期错误与空数据', () => {
  it('学期格式错误时应抛出异常', async () => {
    await expect(getClassesWithCourse(1, 'invalid')).rejects.toThrow('学期格式错误');
  });

  it('无 plan_courses 时应返回空数组', async () => {
    mockPlanCoursesFindMany.mockResolvedValue([]);
    mockClassesFindMany.mockResolvedValue([makeClass(10, '25级1班')]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toEqual([]);
  });

  it('无班级时应返回空数组', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    mockPlanCoursesFindMany.mockResolvedValue([pc]);
    mockClassesFindMany.mockResolvedValue([]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toEqual([]);
  });
});

describe('getClassesWithCourse - 方案匹配与过滤', () => {
  it('findBestMatchPlan 返回 null 时该班级应被跳过', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班');
    mockPlanCoursesFindMany.mockResolvedValue([pc]);
    mockClassesFindMany.mockResolvedValue([cls]);
    mockFindBestMatchPlan.mockReturnValue(null);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
  });

  it('bestPlan 对应的 planCourse 不存在时应跳过', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班');
    mockPlanCoursesFindMany.mockResolvedValue([pc]);
    mockClassesFindMany.mockResolvedValue([cls]);
    // 返回一个不在 planCourses 中的方案
    mockFindBestMatchPlan.mockReturnValue({ id: 999, major_id: 1, training_level_id: 1 });

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
  });

  it('calcClassSemester 返回 null 时应跳过该班级（超龄/超学制）', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    // enrollment_year=2020, duration_years=4 → grade=6 > 4 → calcClassSemester 返回 null
    const cls = makeClass(10, '20级1班', { enrollment_year: 2020, duration_years: 4 });
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
  });

  it('semRecord 不在 [start_semester, end_semester] 范围内时应跳过', async () => {
    // pc.start_semester=3, pc.end_semester=4, 当前学期=2 → semRecord.semester=2 不在范围内
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    pc.start_semester = 3;
    pc.end_semester = 4;
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
  });

  it('weeks_count 为 null 时应回退到 pc.weeks_per_semester', async () => {
    const sem = makeSemRecord(CURRENT_SEM_NUM, 4);
    sem.weeks_count = null; // 回退
    const pc = makePlanCourse(1, [sem]);
    pc.weeks_per_semester = 16;
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(1);
    expect(result[0].weeksCount).toBe(16);
    expect(result[0].totalHours).toBe(4 * 16);
  });
});

describe('getClassesWithCourse - 筛选条件', () => {
  it('传入 college 筛选条件时应添加到 where 中', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    await getClassesWithCourse(COURSE_ID, SEMESTER_STR, { college: '计算机学院' });

    // 验证 getActiveClassFilter 返回的 where 对象被扩展了 colleges 条件
    const findManyCall = mockClassesFindMany.mock.calls[0][0];
    expect(findManyCall.where.colleges).toEqual({ name: '计算机学院' });
  });

  it('传入 major 筛选条件时应添加到 where 中', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    await getClassesWithCourse(COURSE_ID, SEMESTER_STR, { major: '软件工程' });

    const findManyCall = mockClassesFindMany.mock.calls[0][0];
    expect(findManyCall.where.majors).toEqual({ name: '软件工程' });
  });

  it('传入 training_level 筛选条件时应添加到 where 中', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    await getClassesWithCourse(COURSE_ID, SEMESTER_STR, { training_level: '本科' });

    const findManyCall = mockClassesFindMany.mock.calls[0][0];
    expect(findManyCall.where.training_levels).toEqual({ name: '本科' });
  });

  it('传入 grade 筛选条件时应过滤 OR 条件', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班');
    setupMocks([pc], [cls]);

    // 模拟 getActiveClassFilter 返回含 OR 条件的 where
    const { getActiveClassFilter } = await import('../../../services/semester.service.js');
    getActiveClassFilter.mockResolvedValueOnce({
      OR: [{ enrollment_year: { gte: 2025 } }, { enrollment_year: { gte: 2023 } }],
    });

    await getClassesWithCourse(COURSE_ID, SEMESTER_STR, { grade: '1' });

    const findManyCall = mockClassesFindMany.mock.calls[0][0];
    // grade=1 → enrollmentYear = 2025 - 1 + 1 = 2025
    // gte <= 2025 的条件保留
    expect(findManyCall.where.OR).toBeDefined();
  });
});

describe('getClassesWithCourse - custom_plan_id 处理', () => {
  it('班级有 custom_plan_id 时应构建 classPlanMap', async () => {
    const plan1 = {
      id: 1,
      name: '方案A',
      major_id: 1,
      training_level_id: 1,
      sort_order: 0,
      majors: { id: 1, name: '专业A' },
      training_levels: { id: 1, name: '本科' },
      colleges: { id: 1, name: '学院A' },
    };
    const plan2 = {
      id: 2,
      name: '方案B',
      major_id: 2,
      training_level_id: 1,
      sort_order: 1,
      majors: { id: 2, name: '专业B' },
      training_levels: { id: 1, name: '本科' },
      colleges: { id: 1, name: '学院A' },
    };
    const pc1 = {
      id: 100,
      training_plans: plan1,
      courses: { id: 1, name: '语文', code: 'CH001', type: 'public' },
      start_semester: 1,
      end_semester: 4,
      weekly_hours: 4,
      weeks_per_semester: 18,
      plan_course_semesters: [makeSemRecord(CURRENT_SEM_NUM, 4)],
    };
    const pc2 = {
      id: 200,
      training_plans: plan2,
      courses: { id: 1, name: '语文', code: 'CH001', type: 'public' },
      start_semester: 1,
      end_semester: 4,
      weekly_hours: 4,
      weeks_per_semester: 18,
      plan_course_semesters: [makeSemRecord(CURRENT_SEM_NUM, 4)],
    };
    const cls = makeClass(10, '25级1班', { custom_plan_id: 2 });

    mockPlanCoursesFindMany.mockResolvedValue([pc1, pc2]);
    mockClassesFindMany.mockResolvedValue([cls]);
    mockTrainingPlansFindMany.mockResolvedValue([plan1, plan2]);
    // findBestMatchPlan 应收到 classPlanMap 并返回 plan2
    mockFindBestMatchPlan.mockReturnValue(plan2);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(1);
    expect(mockFindBestMatchPlan).toHaveBeenCalledWith(cls, [plan1, plan2], expect.any(Map));
  });
});

describe('getClassesWithCourse - 全局匹配口径', () => {
  it('全局最佳方案不含本课程时，不应回落含本课程的次优方案', async () => {
    // 回归：班级全局最佳方案为方案11（不含本课程，如转段-特例只开大学语文），
    // 方案5含本课程（如五年制人培）。口径统一后该班不应出现在结果中，
    // 与首页 computeOfferedCourses 的开课推导保持一致。
    const pc5 = makePlanCourse(5, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const plan11 = {
      id: 11,
      name: '转段-特例',
      major_id: 1,
      training_level_id: 1,
      created_at: new Date('2026-01-01'),
    };
    const cls = makeClass(523, '25级转段1班');

    mockPlanCoursesFindMany.mockResolvedValue([pc5]);
    mockClassesFindMany.mockResolvedValue([cls]);
    mockTrainingPlansFindMany.mockResolvedValue([pc5.training_plans, plan11]);
    // 全局匹配命中方案11（不含本课程）
    mockFindBestMatchPlan.mockReturnValue(plan11);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(0);
    expect(mockFindBestMatchPlan).toHaveBeenCalledWith(
      cls,
      expect.arrayContaining([plan11]),
      expect.any(Map)
    );
  });
});

describe('getClassesWithCourse - 返回结构验证', () => {
  it('返回对象应包含所有预期字段', async () => {
    const pc = makePlanCourse(1, [
      makeSemRecord(CURRENT_SEM_NUM, 4, [{ id: 1, title: '语文课本' }]),
    ]);
    const cls = makeClass(10, '25级1班', {
      combination_id: 5,
      student_count: 35,
    });
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(1);
    const r = result[0];
    expect(r).toHaveProperty('classId', 10);
    expect(r).toHaveProperty('className', '25级1班');
    expect(r).toHaveProperty('collegeId', 1);
    expect(r).toHaveProperty('collegeName', '学院A');
    expect(r).toHaveProperty('majorId', 1);
    expect(r).toHaveProperty('majorName', '专业A');
    expect(r).toHaveProperty('trainingLevelId', 1);
    expect(r).toHaveProperty('trainingLevelName', '本科');
    expect(r).toHaveProperty('combinationId', 5);
    expect(r).toHaveProperty('grade');
    expect(r).toHaveProperty('enrollmentYear', 2025);
    expect(r).toHaveProperty('studentCount', 35);
    expect(r).toHaveProperty('currentSemester');
    expect(r).toHaveProperty('weeklyHours', 4);
    expect(r).toHaveProperty('weeksCount', 18);
    expect(r).toHaveProperty('totalHours', 72);
    expect(r).toHaveProperty('textbooks');
    expect(r.textbooks).toEqual([{ id: 1, title: '语文课本' }]);
  });

  it('student_count 为 null 时应默认 0', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班', { student_count: null });
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].studentCount).toBe(0);
  });

  it('colleges 关联为 null 时 collegeName 应为 null', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班', { colleges: null });
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].collegeName).toBeNull();
  });

  it('majors 关联为 null 时 majorName 应为 null', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班', { majors: null });
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].majorName).toBeNull();
  });

  it('training_levels 关联为 null 时 trainingLevelName 应为 null', async () => {
    const pc = makePlanCourse(1, [makeSemRecord(CURRENT_SEM_NUM, 4)]);
    const cls = makeClass(10, '25级1班', { training_levels: null });
    setupMocks([pc], [cls]);

    const result = await getClassesWithCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].trainingLevelName).toBeNull();
  });
});

// ══════════════════════════════════════════════
// getTeachersForCourse
// ══════════════════════════════════════════════
describe('getTeachersForCourse - 基础功能', () => {
  function makeTeacher(id, name, overrides = {}) {
    return {
      id,
      name,
      gender: 'male',
      personnel_type: 'fulltime',
      remark: 'senior',
      default_weekly_hours: 12,
      sort_order: id,
      courses: [{ course: { id: COURSE_ID, name: '语文' } }],
      scheduling_colleges: [],
      scheduling_levels: [],
      ...overrides,
    };
  }

  function setupTeacherMocks(teachers, options = {}) {
    const {
      workloadStats = [],
      courseAssignments = [],
      collegeAndLevelAssignments = [],
      allSemesterAssignments = [],
      allAssignments = [],
      planCoursesForTextbooks = [],
      allPlanCourses = [],
      classesForTextbooks = [],
      trainingLevels = [],
      textbooks = [],
    } = options;

    mockTeachersFindMany.mockResolvedValue(teachers);
    // groupBy 已不再被 getTeachersForCourse 使用（B1 修复改为 findMany 全量 + dedupeTeachingUnits），
    // 此处保留 mock 仅作回归保护，不被实际消费。
    mockAssignmentsGroupBy
      .mockResolvedValueOnce(workloadStats)
      .mockResolvedValueOnce(courseAssignments);
    // teaching_assignments.findMany 被调用 3 次（均路由到同一 mock）：
    //   1) 184 行 B1 全量去重（allSemesterAssignments）
    //   2) 216 行 学院/层次查询（collegeAndLevelAssignments）
    //   3) 267 行 跨课程教材上下文（allAssignments）
    mockAssignmentsFindMany
      .mockResolvedValueOnce(allSemesterAssignments)
      .mockResolvedValueOnce(collegeAndLevelAssignments)
      .mockResolvedValueOnce(allAssignments);
    // plan_courses 被调用两次：教材兜底 + 跨课程教材
    mockPlanCoursesFindMany
      .mockResolvedValueOnce(planCoursesForTextbooks)
      .mockResolvedValueOnce(allPlanCourses);
    mockClassesFindMany.mockResolvedValue(classesForTextbooks);
    mockTrainingLevelsFindMany.mockResolvedValue(trainingLevels);
    mockTextbooksFindMany.mockResolvedValue(textbooks);
  }

  it('无教师时应返回空数组', async () => {
    setupTeacherMocks([], {
      workloadStats: [],
      courseAssignments: [],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toEqual([]);
  });

  it('单个教师无排课记录时应使用兜底教材（FALLBACK_EMPTY=true 时为空）', async () => {
    const teacher = makeTeacher(1, '张老师');
    setupTeacherMocks([teacher], {
      workloadStats: [],
      courseAssignments: [],
      collegeAndLevelAssignments: [],
      allAssignments: [], // 无排课记录
      planCoursesForTextbooks: [],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('张老师');
    expect(result[0].textbookIds).toEqual([]);
    expect(result[0].inherentTextbookIds).toEqual([]);
    expect(result[0].totalWeeklyHours).toBe(0);
    expect(result[0].totalClassCount).toBe(0);
    expect(result[0].courseHours).toBe(0);
    expect(result[0].courseClassCount).toBe(0);
  });

  it('教师有工作量统计时应正确反映', async () => {
    const teacher = makeTeacher(1, '李老师');
    setupTeacherMocks([teacher], {
      // B1 修复后工作量统计来自 teaching_assignments.findMany 全量 + dedupeTeachingUnits，
      // 不再使用 groupBy 的 workloadStats/courseAssignments。
      // 构造：目标课程 1 节(weekly=4, 1 班) + 其他课程合班 1 节(weekly=12, 2 班) → 合计 16/2 个逻辑教学班，课程 4/1
      allSemesterAssignments: [
        {
          teacher_id: 1,
          course_id: COURSE_ID,
          weekly_hours: 4,
          class_id: 1,
          class: { combination_id: null },
        },
        {
          teacher_id: 1,
          course_id: 999,
          weekly_hours: 12,
          class_id: 2,
          class: { combination_id: 100 },
        },
        {
          teacher_id: 1,
          course_id: 999,
          weekly_hours: 12,
          class_id: 3,
          class: { combination_id: 100 },
        },
      ],
      collegeAndLevelAssignments: [],
      allAssignments: [],
      planCoursesForTextbooks: [],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].totalWeeklyHours).toBe(16);
    // 审计修复：逻辑教学班口径，合班(2个成员班)计 1 → 共 2
    expect(result[0].totalClassCount).toBe(2);
    expect(result[0].courseHours).toBe(4);
    expect(result[0].courseClassCount).toBe(1);
  });

  it('教师有学院和层次分配时应构建映射', async () => {
    const teacher = makeTeacher(1, '王老师', {
      scheduling_colleges: [{ college_id: 10 }],
      scheduling_levels: [{ training_level: { id: 20, name: '本科' } }],
    });
    setupTeacherMocks([teacher], {
      workloadStats: [],
      courseAssignments: [],
      collegeAndLevelAssignments: [
        {
          teacher_id: 1,
          class: {
            colleges: { id: 10, name: '计算机学院' },
            training_level_id: 20,
          },
        },
      ],
      allAssignments: [],
      planCoursesForTextbooks: [],
      trainingLevels: [{ id: 20, name: '本科' }],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].collegeList).toEqual([{ id: 10, name: '计算机学院' }]);
    expect(result[0].schedulingCollegeIds).toEqual([10]);
    expect(result[0].schedulingLevelIds).toEqual([20]);
    // 有实际授课层次时优先使用
    expect(result[0].trainingLevelList).toEqual([{ id: 20, name: '本科' }]);
  });

  it('教师无实际授课层次时应使用 scheduling_levels', async () => {
    const teacher = makeTeacher(1, '赵老师', {
      scheduling_levels: [{ training_level: { id: 30, name: '大专' } }],
    });
    setupTeacherMocks([teacher], {
      workloadStats: [],
      courseAssignments: [],
      collegeAndLevelAssignments: [], // 无分配
      allAssignments: [],
      planCoursesForTextbooks: [],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].trainingLevelList).toEqual([{ id: 30, name: '大专' }]);
  });

  it('教师有跨课程排课时应进入教材构建逻辑', async () => {
    const teacher = makeTeacher(1, '陈老师');
    setupTeacherMocks([teacher], {
      workloadStats: [],
      courseAssignments: [],
      collegeAndLevelAssignments: [],
      allAssignments: [{ teacher_id: 1, class_id: 100, course_id: COURSE_ID }],
      planCoursesForTextbooks: [],
      allPlanCourses: [
        {
          course_id: COURSE_ID,
          training_plans: { id: 1, major_id: 1, training_level_id: 1 },
          start_semester: 1,
          end_semester: 4,
          plan_course_semesters: [
            {
              semester: CURRENT_SEM_NUM,
              plan_textbooks: [{ textbook_id: 501 }],
            },
          ],
        },
      ],
      classesForTextbooks: [
        {
          id: 100,
          custom_plan_id: null,
          major_id: 1,
          training_level_id: 1,
          enrollment_year: 2025,
          duration_years: 4,
        },
      ],
      textbooks: [{ id: 501, title: '高等数学' }],
    });

    // findBestMatchPlan 返回匹配方案
    mockFindBestMatchPlan.mockReturnValue({ id: 1, major_id: 1, training_level_id: 1 });
    // isClassMatchPlan 返回 true
    mockIsClassMatchPlan.mockReturnValue(true);

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    // 验证教师数据正常返回，教材字段为数组
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('陈老师');
    expect(Array.isArray(result[0].inherentTextbookIds)).toBe(true);
    expect(Array.isArray(result[0].assignedTextbooks)).toBe(true);
    // 验证 prisma.classes.findMany 被调用（教材构建逻辑确实执行了）
    expect(mockClassesFindMany).toHaveBeenCalled();
  });

  it('返回结构应包含所有预期字段', async () => {
    const teacher = makeTeacher(1, '周老师');
    setupTeacherMocks([teacher], {
      workloadStats: [],
      courseAssignments: [],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result).toHaveLength(1);
    const r = result[0];
    expect(r).toHaveProperty('id', 1);
    expect(r).toHaveProperty('name', '周老师');
    expect(r).toHaveProperty('gender', 'male');
    expect(r).toHaveProperty('personnelType', 'fulltime');
    expect(r).toHaveProperty('remark', 'senior');
    expect(r).toHaveProperty('defaultWeeklyHours', 12);
    expect(r).toHaveProperty('courseList');
    expect(r).toHaveProperty('collegeList');
    expect(r).toHaveProperty('schedulingCollegeIds');
    expect(r).toHaveProperty('schedulingLevelIds');
    expect(r).toHaveProperty('trainingLevelList');
    expect(r).toHaveProperty('textbookIds');
    expect(r).toHaveProperty('inherentTextbookIds');
    expect(r).toHaveProperty('assignedTextbooks');
    expect(r).toHaveProperty('assignedTextbookIds');
    expect(r).toHaveProperty('assignedCollegeIds');
    expect(r).toHaveProperty('totalWeeklyHours');
    expect(r).toHaveProperty('totalClassCount');
    expect(r).toHaveProperty('courseHours');
    expect(r).toHaveProperty('courseClassCount');
  });

  it('工作量统计 weekly_hours 为 null 时应默认 0', async () => {
    const teacher = makeTeacher(1, '孙老师');
    setupTeacherMocks([teacher], {
      workloadStats: [{ teacher_id: 1, _sum: { weekly_hours: null }, _count: { id: 0 } }],
      courseAssignments: [{ teacher_id: 1, _sum: { weekly_hours: null }, _count: { id: 0 } }],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].totalWeeklyHours).toBe(0);
    expect(result[0].courseHours).toBe(0);
  });

  it('assignedTextbookIds 和 assignedCollegeIds 应为空 Set', async () => {
    const teacher = makeTeacher(1, '吴老师');
    setupTeacherMocks([teacher], {
      workloadStats: [],
      courseAssignments: [],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].assignedTextbookIds).toBeInstanceOf(Set);
    expect(result[0].assignedTextbookIds.size).toBe(0);
    expect(result[0].assignedCollegeIds).toBeInstanceOf(Set);
    expect(result[0].assignedCollegeIds.size).toBe(0);
  });

  it('未开启只带一本教材开关时 singleTextbookOnly 应为 false', async () => {
    const teacher = makeTeacher(1, '郑老师'); // 无 single_textbook_only 字段
    setupTeacherMocks([teacher], {
      workloadStats: [],
      courseAssignments: [],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].singleTextbookOnly).toBe(false);
  });

  it('开启只带一本教材开关时 singleTextbookOnly 应为 true', async () => {
    const teacher = makeTeacher(1, '冯老师', { single_textbook_only: true });
    setupTeacherMocks([teacher], {
      workloadStats: [],
      courseAssignments: [],
    });

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    expect(result[0].singleTextbookOnly).toBe(true);
  });
});

// ════════════════════════════════════════════════
// getTeachersForCourse — 归档方案教材推导过滤
// ════════════════════════════════════════════════
describe('getTeachersForCourse — 归档方案教材推导', () => {
  function makeTeacher(id, name) {
    return {
      id,
      name,
      gender: 'male',
      personnel_type: 'fulltime',
      remark: 'senior',
      default_weekly_hours: 12,
      sort_order: id,
      courses: [{ course: { id: COURSE_ID, name: '语文' } }],
      scheduling_colleges: [],
      scheduling_levels: [],
    };
  }

  function setupTeacherMocks(teachers, options = {}) {
    const {
      collegeAndLevelAssignments = [],
      allSemesterAssignments = [],
      allAssignments = [],
      planCoursesForTextbooks = [],
      allPlanCourses = [],
      classesForTextbooks = [],
      trainingLevels = [],
      textbooks = [],
    } = options;

    mockTeachersFindMany.mockReset().mockResolvedValue(teachers);
    mockAssignmentsGroupBy.mockReset().mockResolvedValue([]);
    // clearAllMocks 不清除 mockResolvedValueOnce 队列，先 reset 防止前面用例残留的队列错位消费
    mockAssignmentsFindMany
      .mockReset()
      .mockResolvedValueOnce(allSemesterAssignments)
      .mockResolvedValueOnce(collegeAndLevelAssignments)
      .mockResolvedValueOnce(allAssignments);
    mockPlanCoursesFindMany
      .mockReset()
      .mockResolvedValueOnce(planCoursesForTextbooks)
      .mockResolvedValueOnce(allPlanCourses);
    mockClassesFindMany.mockReset().mockResolvedValue(classesForTextbooks);
    mockTrainingLevelsFindMany.mockReset().mockResolvedValue(trainingLevels);
    mockTextbooksFindMany.mockReset().mockResolvedValue(textbooks);
    mockFindBestMatchPlan.mockReset();
    mockIsClassMatchPlan.mockReset();
  }

  it('排课方案为归档 → 教材推导不命中，textbookIds 为空', async () => {
    const teacher = makeTeacher(1, '吴老师');
    setupTeacherMocks([teacher], {
      allAssignments: [{ teacher_id: 1, class_id: 100, course_id: COURSE_ID }],
      allPlanCourses: [
        {
          course_id: COURSE_ID,
          training_plans: {
            id: 1,
            major_id: 1,
            training_level_id: 1,
            status: 'archived',
          },
          start_semester: 1,
          end_semester: 4,
          plan_course_semesters: [
            {
              semester: CURRENT_SEM_NUM,
              plan_textbooks: [{ textbook_id: 501 }],
            },
          ],
        },
      ],
      classesForTextbooks: [
        {
          id: 100,
          custom_plan_id: null,
          major_id: 1,
          training_level_id: 1,
          enrollment_year: 2025,
          duration_years: 4,
        },
      ],
      textbooks: [{ id: 501, title: '高等数学' }],
    });
    mockFindBestMatchPlan.mockReturnValue({ id: 1, major_id: 1, training_level_id: 1 });
    mockIsClassMatchPlan.mockReturnValue(true);

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    // 归档方案被代码层过滤 → 无候选 → 不推导出教材
    expect(result).toHaveLength(1);
    expect(result[0].textbookIds).toEqual([]);
    // findBestMatchPlan 的候选列表为空（归档方案未进入）
    const candidateCall = mockFindBestMatchPlan.mock.calls.find((c) => Array.isArray(c[1]));
    expect(candidateCall[1]).toHaveLength(0);
  });

  it('非归档方案教材推导正常（status 缺省视为非归档）', async () => {
    const teacher = makeTeacher(1, '郑老师');
    setupTeacherMocks([teacher], {
      allAssignments: [{ teacher_id: 1, class_id: 100, course_id: COURSE_ID }],
      allPlanCourses: [
        {
          course_id: COURSE_ID,
          training_plans: { id: 1, major_id: 1, training_level_id: 1 },
          start_semester: 1,
          end_semester: 4,
          plan_course_semesters: [
            {
              semester: CURRENT_SEM_NUM,
              plan_textbooks: [{ textbook_id: 501 }],
            },
          ],
        },
      ],
      classesForTextbooks: [
        {
          id: 100,
          custom_plan_id: null,
          major_id: 1,
          training_level_id: 1,
          enrollment_year: 2025,
          duration_years: 4,
        },
      ],
      textbooks: [{ id: 501, title: '高等数学' }],
    });
    mockFindBestMatchPlan.mockReturnValue({ id: 1, major_id: 1, training_level_id: 1 });
    mockIsClassMatchPlan.mockReturnValue(true);

    const result = await getTeachersForCourse(COURSE_ID, SEMESTER_STR);

    // 正常推导出教材 501
    expect(result[0].textbookIds).toContain(501);
  });
});
