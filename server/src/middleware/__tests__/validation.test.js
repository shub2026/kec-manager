/**
 * validation.js 单元测试
 *
 * 重点覆盖：
 * - handleValidationErrors：验证通过/失败两种路径，422 响应格式
 * - validateLogin：用户名/密码长度边界
 * - validateClass：入学年份/学制/人数范围校验
 * - validateChangePassword：密码正则（大小写+数字+特殊字符）
 * - validateIdParam：ID 正整数校验
 * - validatePagination：分页参数范围
 * - validateSemesterQuery：学期格式 YYYY-YYYY-N
 * - validateTeacherCreate：人员类别/性别/出生年月格式
 *
 * 策略：用 express-validator 的 run() 链式执行，
 *       模拟 Express req 流转，验证 handleValidationErrors 的 422 响应。
 */
import { describe, it, expect, vi } from 'vitest';

// Mock logger，避免 winston 输出
vi.mock('../../utils/logger.js', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  handleValidationErrors,
  validateLogin,
  validateClass,
  validateClassUpdate,
  validateChangePassword,
  validateResetPassword,
  validateIdParam,
  validatePagination,
  validateSemesterQuery,
  validateTeacherCreate,
  validateTeacherUpdate,
  validateAutoArrange,
  validateBatchAutoArrange,
  validateAssignTeacher,
  validateSwapTeachers,
  validateResetAuto,
  validateHourSettings,
  validateBatchUpdateHours,
  validateReset,
  validateUser,
  validateUserUpdate,
  validateUserStatus,
  validateMajor,
  validateMajorCreate,
  validateCollege,
  validateCollegeCreate,
  validateCourse,
  validateCourseCreate,
  validateTrainingLevel,
  validateTrainingLevelCreate,
  validateTextbook,
  validateTextbookCreate,
  validateTextbookStatus,
  validatePlan,
  validatePlanCreate,
  validatePlanCourse,
  validatePlanTextbook,
  validateSemester,
  validateSortOrder,
} = await import('../validation.js');

const { log } = await import('../../utils/logger.js');

// ──────────────────────────────────────────────
// 辅助：运行验证链
// ──────────────────────────────────────────────
/**
 * 模拟 Express 请求流转，执行验证中间件链
 * @param {Array} middlewares - 验证中间件数组
 * @param {object} reqData - { body, params, query }
 * @returns {Promise<{res, nextCalled}>}
 */
async function runValidation(middlewares, reqData = {}) {
  const req = {
    body: reqData.body || {},
    params: reqData.params || {},
    query: reqData.query || {},
    method: 'POST',
    path: '/api/test',
  };

  let nextCalled = false;
  const res = {
    statusCode: 200,
    _jsonCall: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this._jsonCall = data;
      return this;
    },
  };

  // 依次执行验证链中的每个中间件
  // handleValidationErrors 在有错误时调用 res.json 而非 next，
  // 所以 resolve 需要同时绑定到 next 和 res.json
  for (const mw of middlewares) {
    let resolveFn;
    const done = new Promise((r) => {
      resolveFn = r;
    });
    // 拦截 res.json：验证失败时 handleValidationErrors 调用 res.json
    const origJson = res.json.bind(res);
    res.json = function (data) {
      origJson(data);
      resolveFn();
      return this;
    };
    mw(req, res, () => resolveFn());
    await done;
    res.json = origJson;
    // 如果已返回 422 响应，停止后续中间件
    if (res._jsonCall) break;
  }

  if (!res._jsonCall) {
    nextCalled = true;
  }

  return { res, nextCalled };
}

// ──────────────────────────────────────────────
// handleValidationErrors
// ──────────────────────────────────────────────
describe('handleValidationErrors', () => {
  it('无验证错误时应调用 next', async () => {
    const req = {
      body: { username: 'admin', password: '12345678' },
      method: 'POST',
      path: '/test',
    };
    const res = {
      _jsonCall: null,
      status() {
        return this;
      },
      json(d) {
        this._jsonCall = d;
      },
    };
    let nextCalled = false;

    // 手动构造一个无错误的请求
    await new Promise((resolve) => {
      handleValidationErrors(req, res, () => {
        nextCalled = true;
        resolve();
      });
    });

    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });
});

// ──────────────────────────────────────────────
// validateLogin
// ──────────────────────────────────────────────
describe('validateLogin', () => {
  it('合法用户名+密码应通过验证', async () => {
    const { res, nextCalled } = await runValidation(validateLogin, {
      body: { username: 'admin', password: '12345678' },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('密码过短应返回 422', async () => {
    const { res } = await runValidation(validateLogin, {
      body: { username: 'admin', password: '123' },
    });
    expect(res.statusCode).toBe(422);
    expect(res._jsonCall.success).toBe(false);
    expect(res._jsonCall.data.code).toBe('VALIDATION_ERROR');
  });

  it('用户名为空应返回 422', async () => {
    const { res } = await runValidation(validateLogin, {
      body: { username: '', password: '12345678' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('密码超长（>128）应返回 422', async () => {
    const { res } = await runValidation(validateLogin, {
      body: { username: 'admin', password: 'a'.repeat(129) },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateClass
// ──────────────────────────────────────────────
describe('validateClass', () => {
  it('合法班级数据应通过', async () => {
    const { res, nextCalled } = await runValidation(validateClass, {
      body: {
        name: '计算机一班',
        enrollment_year: 2025,
        duration_years: 3,
      },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('入学年份超出范围应返回 422', async () => {
    const { res } = await runValidation(validateClass, {
      body: { name: '一班', enrollment_year: 1999, duration_years: 3 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('学制超出范围应返回 422', async () => {
    const { res } = await runValidation(validateClass, {
      body: { name: '一班', enrollment_year: 2025, duration_years: 15 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('学生人数超出范围应返回 422', async () => {
    const { res } = await runValidation(validateClass, {
      body: { name: '一班', enrollment_year: 2025, duration_years: 3, student_count: 1000 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('班级名称超长应返回 422', async () => {
    const { res } = await runValidation(validateClass, {
      body: { name: 'x'.repeat(101), enrollment_year: 2025, duration_years: 3 },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateChangePassword
// ──────────────────────────────────────────────
describe('validateChangePassword', () => {
  it('符合正则的密码应通过', async () => {
    const { res, nextCalled } = await runValidation(validateChangePassword, {
      body: { old_password: 'OldPass1!', new_password: 'NewPass1!' },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('仅含小写字母（1种类型）应返回 422', async () => {
    const { res } = await runValidation(validateChangePassword, {
      body: { old_password: 'oldpass1!', new_password: 'newpassword' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('仅含大写字母（1种类型）应返回 422', async () => {
    const { res } = await runValidation(validateChangePassword, {
      body: { old_password: 'OldPass1!', new_password: 'NEWPASSWORD' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('仅含数字（1种类型）应返回 422', async () => {
    const { res } = await runValidation(validateChangePassword, {
      body: { old_password: 'OldPass1!', new_password: '12345678' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('原密码为空应返回 422', async () => {
    const { res } = await runValidation(validateChangePassword, {
      body: { old_password: '', new_password: 'NewPass1!' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateIdParam
// ──────────────────────────────────────────────
describe('validateIdParam', () => {
  it('正整数 ID 应通过', async () => {
    const { res, nextCalled } = await runValidation(validateIdParam, {
      params: { id: '5' },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('非正整数 ID 应返回 422', async () => {
    const { res } = await runValidation(validateIdParam, {
      params: { id: '0' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('非数字 ID 应返回 422', async () => {
    const { res } = await runValidation(validateIdParam, {
      params: { id: 'abc' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validatePagination
// ──────────────────────────────────────────────
describe('validatePagination', () => {
  it('合法分页参数应通过', async () => {
    const { res, nextCalled } = await runValidation(validatePagination, {
      query: { page: '1', pageSize: '20' },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('无分页参数也应通过（optional）', async () => {
    const { res, nextCalled } = await runValidation(validatePagination, {
      query: {},
    });
    expect(nextCalled).toBe(true);
  });

  it('pageSize 超过 100 应返回 422', async () => {
    const { res } = await runValidation(validatePagination, {
      query: { pageSize: '200' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('page 为 0 应返回 422', async () => {
    const { res } = await runValidation(validatePagination, {
      query: { page: '0' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateSemesterQuery
// ──────────────────────────────────────────────
describe('validateSemesterQuery', () => {
  it('合法学期格式应通过', async () => {
    const { res, nextCalled } = await runValidation(validateSemesterQuery, {
      query: { semester: '2025-2026-2' },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('无学期参数也应通过（optional）', async () => {
    const { res, nextCalled } = await runValidation(validateSemesterQuery, {
      query: {},
    });
    expect(nextCalled).toBe(true);
  });

  it('学期格式错误（缺少第三段）应返回 422', async () => {
    const { res } = await runValidation(validateSemesterQuery, {
      query: { semester: '2025-2026' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('学期第三段非 1/2 应返回 422', async () => {
    const { res } = await runValidation(validateSemesterQuery, {
      query: { semester: '2025-2026-3' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateTeacherCreate
// ──────────────────────────────────────────────
describe('validateTeacherCreate', () => {
  it('合法教师数据应通过', async () => {
    const { res, nextCalled } = await runValidation(validateTeacherCreate, {
      body: {
        name: '张老师',
        gender: 'male',
        personnel_type: 'full_time',
        birth_date: '1985-05',
      },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('人员类别不合法应返回 422', async () => {
    const { res } = await runValidation(validateTeacherCreate, {
      body: { name: '张老师', personnel_type: 'invalid_type' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('性别不合法应返回 422', async () => {
    const { res } = await runValidation(validateTeacherCreate, {
      body: { name: '张老师', gender: 'unknown' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('出生年月格式错误应返回 422', async () => {
    const { res } = await runValidation(validateTeacherCreate, {
      body: { name: '张老师', birth_date: '1985/05' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('教师姓名为空应返回 422', async () => {
    const { res } = await runValidation(validateTeacherCreate, {
      body: { name: '' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateAutoArrange
// ──────────────────────────────────────────────
describe('validateAutoArrange', () => {
  it('合法排课请求应通过', async () => {
    const { res, nextCalled } = await runValidation(validateAutoArrange, {
      body: { course_id: 1, semester: '2025-2026-1', mode: 'standard' },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('mode 不合法应返回 422', async () => {
    const { res } = await runValidation(validateAutoArrange, {
      body: { course_id: 1, semester: '2025-2026-1', mode: 'invalid' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('course_id 缺失应返回 422', async () => {
    const { res } = await runValidation(validateAutoArrange, {
      body: { semester: '2025-2026-1', mode: 'standard' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateReset
// ──────────────────────────────────────────────
describe('validateReset', () => {
  it('confirm=DELETE 且 reason 合法应通过', async () => {
    const { res, nextCalled } = await runValidation(validateReset, {
      body: { confirm: 'DELETE', reason: '这是一段超过十个字符的操作原因' },
    });
    expect(nextCalled).toBe(true);
    expect(res._jsonCall).toBeNull();
  });

  it('confirm 不等于 DELETE 应返回 422', async () => {
    const { res } = await runValidation(validateReset, {
      body: { confirm: 'delete', reason: '这是一段超过十个字符的操作原因' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('reason 过短应返回 422', async () => {
    const { res } = await runValidation(validateReset, {
      body: { confirm: 'DELETE', reason: '短' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// handleValidationErrors 错误路径与日志脱敏
// ──────────────────────────────────────────────
describe('handleValidationErrors — 错误路径与脱敏', () => {
  it('422 响应包含 VALIDATION_ERROR 与逐字段 details', async () => {
    const { res } = await runValidation(validateLogin, {
      body: { username: '', password: '123' },
    });
    expect(res.statusCode).toBe(422);
    expect(res._jsonCall.success).toBe(false);
    expect(res._jsonCall.data.code).toBe('VALIDATION_ERROR');
    const fields = res._jsonCall.data.details.map((d) => d.field);
    expect(fields).toContain('username');
    expect(fields).toContain('password');
    expect(res._jsonCall.data.details[0]).toHaveProperty('message');
    expect(res._jsonCall.data.details[0]).toHaveProperty('location');
  });

  it('调试日志剔除密码类敏感字段', async () => {
    log.warn.mockClear();
    await runValidation(validateChangePassword, {
      body: { old_password: 'OldPass1!', new_password: 'weakweak', note: 'visible' },
    });
    const call = log.warn.mock.calls.at(-1);
    expect(call[0]).toBe('验证参数失败');
    expect(call[1].body).not.toHaveProperty('old_password');
    expect(call[1].body).not.toHaveProperty('new_password');
    expect(call[1].body).not.toHaveProperty('password');
    expect(call[1].body).toHaveProperty('note', 'visible');
  });
});

// ──────────────────────────────────────────────
// validateClass — 合班伙伴数组校验
// ──────────────────────────────────────────────
describe('validateClass — combination_class_ids', () => {
  const base = { name: '一班', enrollment_year: 2025, duration_years: 3 };

  it('合法合班伙伴 ID 列表应通过', async () => {
    const { nextCalled } = await runValidation(validateClass, {
      body: { ...base, combination_class_ids: [2, 3] },
    });
    expect(nextCalled).toBe(true);
  });

  it('伙伴 ID 含非正整数应返回 422', async () => {
    const { res } = await runValidation(validateClass, {
      body: { ...base, combination_class_ids: [2, 0] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('伙伴列表超过 50 个应返回 422', async () => {
    const { res } = await runValidation(validateClass, {
      body: { ...base, combination_class_ids: Array.from({ length: 51 }, (_, i) => i + 1) },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateClassUpdate
// ──────────────────────────────────────────────
describe('validateClassUpdate', () => {
  it('空 body（全字段可选）应通过', async () => {
    const { nextCalled } = await runValidation(validateClassUpdate, { body: {} });
    expect(nextCalled).toBe(true);
  });

  it('major_id/college_id 为 null 应通过（可清空关联）', async () => {
    const { nextCalled } = await runValidation(validateClassUpdate, {
      body: { major_id: null, college_id: null },
    });
    expect(nextCalled).toBe(true);
  });

  it('name 为空字符串应返回 422', async () => {
    const { res } = await runValidation(validateClassUpdate, { body: { name: '' } });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateResetPassword
// ──────────────────────────────────────────────
describe('validateResetPassword', () => {
  it('符合复杂度要求应通过', async () => {
    const { nextCalled } = await runValidation(validateResetPassword, {
      body: { new_password: 'Abcd1234' },
    });
    expect(nextCalled).toBe(true);
  });

  it('单一字符类型应返回 422', async () => {
    const { res } = await runValidation(validateResetPassword, {
      body: { new_password: 'abcdefgh' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('新密码过短应返回 422', async () => {
    const { res } = await runValidation(validateResetPassword, {
      body: { new_password: 'Ab1!' },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// validateUser / validateUserUpdate / validateUserStatus
// ──────────────────────────────────────────────
describe('validateUser', () => {
  it('合法完整用户数据应通过', async () => {
    const { nextCalled } = await runValidation(validateUser, {
      body: {
        username: 'teacher01',
        password: 'Abcd1234',
        email: 't@example.com',
        role: 'admin',
        real_name: '测试用户',
      },
    });
    expect(nextCalled).toBe(true);
  });

  it('密码可选：不传密码仅用户名应通过', async () => {
    const { nextCalled } = await runValidation(validateUser, {
      body: { username: 'teacher01' },
    });
    expect(nextCalled).toBe(true);
  });

  it('邮箱格式错误应返回 422', async () => {
    const { res } = await runValidation(validateUser, {
      body: { username: 'teacher01', email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('角色不在枚举内应返回 422', async () => {
    const { res } = await runValidation(validateUser, {
      body: { username: 'teacher01', role: 'superuser' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('弱密码（单一字符类型）应返回 422', async () => {
    const { res } = await runValidation(validateUser, {
      body: { username: 'teacher01', password: 'abcdefgh' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('validateUserUpdate / validateUserStatus', () => {
  it('用户更新合法字段应通过', async () => {
    const { nextCalled } = await runValidation(validateUserUpdate, {
      body: { email: 'a@b.com', role: 'viewer', real_name: '新名字' },
    });
    expect(nextCalled).toBe(true);
  });

  it('用户更新角色非法应返回 422', async () => {
    const { res } = await runValidation(validateUserUpdate, { body: { role: 'root' } });
    expect(res.statusCode).toBe(422);
  });

  it('激活状态为布尔值应通过', async () => {
    const { nextCalled } = await runValidation(validateUserStatus, { body: { is_active: true } });
    expect(nextCalled).toBe(true);
  });

  it('激活状态非布尔应返回 422', async () => {
    const { res } = await runValidation(validateUserStatus, { body: { is_active: 'yes' } });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// 基础数据创建/更新（专业/学院/课程/培养层次）
// ──────────────────────────────────────────────
describe('基础数据规则链', () => {
  it.each([
    ['validateMajorCreate', validateMajorCreate],
    ['validateCollegeCreate', validateCollegeCreate],
    ['validateCourseCreate', validateCourseCreate],
    ['validateTrainingLevelCreate', validateTrainingLevelCreate],
  ])('%s 缺 name 应返回 422', async (_name, chain) => {
    const { res } = await runValidation(chain, { body: {} });
    expect(res.statusCode).toBe(422);
  });

  it.each([
    ['validateMajor', validateMajor],
    ['validateCollege', validateCollege],
    ['validateCourse', validateCourse],
    ['validateTrainingLevel', validateTrainingLevel],
  ])('%s 空 body（全可选）应通过', async (_name, chain) => {
    const { nextCalled } = await runValidation(chain, { body: {} });
    expect(nextCalled).toBe(true);
  });

  it('名称超长（>100）应返回 422', async () => {
    const { res } = await runValidation(validateMajor, { body: { name: 'x'.repeat(101) } });
    expect(res.statusCode).toBe(422);
  });

  it('课程类型不在枚举内应返回 422', async () => {
    const { res } = await runValidation(validateCourse, { body: { type: 'unknown' } });
    expect(res.statusCode).toBe(422);
  });

  it('排序值为负应返回 422', async () => {
    const { res } = await runValidation(validateCollege, { body: { sort_order: -1 } });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// 教材规则链
// ──────────────────────────────────────────────
describe('教材规则链', () => {
  it('validateTextbookCreate 缺 title 应返回 422', async () => {
    const { res } = await runValidation(validateTextbookCreate, { body: {} });
    expect(res.statusCode).toBe(422);
  });

  it('validateTextbookCreate 合法数据（含 YYYY-MM 出版日期）应通过', async () => {
    const { nextCalled } = await runValidation(validateTextbookCreate, {
      body: { title: '高等数学', isbn: '978-7-04-023896-5', price: 49.9, publish_date: '2024-05' },
    });
    expect(nextCalled).toBe(true);
  });

  it('出版日期格式错误应返回 422', async () => {
    const { res } = await runValidation(validateTextbook, { body: { publish_date: '2024/05/01' } });
    expect(res.statusCode).toBe(422);
  });

  it('定价为负应返回 422', async () => {
    const { res } = await runValidation(validateTextbook, { body: { price: -1 } });
    expect(res.statusCode).toBe(422);
  });

  it('validateTextbookStatus 省略 is_active 应通过', async () => {
    const { nextCalled } = await runValidation(validateTextbookStatus, { body: {} });
    expect(nextCalled).toBe(true);
  });

  it('validateTextbookStatus 非布尔应返回 422', async () => {
    const { res } = await runValidation(validateTextbookStatus, { body: { is_active: 'no' } });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// 培养方案规则链
// ──────────────────────────────────────────────
describe('培养方案规则链', () => {
  it('validatePlanCreate 合法数据应通过', async () => {
    const { nextCalled } = await runValidation(validatePlanCreate, {
      body: {
        name: '计算机应用人才培养方案',
        major_id: 1,
        training_level_id: 2,
        apply_from_year: 2024,
        apply_to_year: 2026,
        status: 'active',
      },
    });
    expect(nextCalled).toBe(true);
  });

  it('validatePlanCreate 缺 name 应返回 422', async () => {
    const { res } = await runValidation(validatePlanCreate, { body: {} });
    expect(res.statusCode).toBe(422);
  });

  it('方案状态不在枚举内应返回 422', async () => {
    const { res } = await runValidation(validatePlan, { body: { status: 'published' } });
    expect(res.statusCode).toBe(422);
  });

  it('适用年份越界应返回 422', async () => {
    const { res } = await runValidation(validatePlan, { body: { apply_from_year: 1999 } });
    expect(res.statusCode).toBe(422);
  });

  it('validatePlanCourse 周课时超上限应返回 422', async () => {
    const { res } = await runValidation(validatePlanCourse, { body: { weekly_hours: 21 } });
    expect(res.statusCode).toBe(422);
  });

  it('validatePlanCourse 合法学期明细应通过', async () => {
    const { nextCalled } = await runValidation(validatePlanCourse, {
      body: { course_id: 1, start_semester: 1, end_semester: 4, weekly_hours: 4, weeks_per_semester: 18 },
    });
    expect(nextCalled).toBe(true);
  });

  it('validateSemester 周数超上限应返回 422', async () => {
    const { res } = await runValidation(validateSemester, { body: { weeks_count: 31 } });
    expect(res.statusCode).toBe(422);
  });

  it('validatePlanTextbook 缺教材 ID 应返回 422', async () => {
    const { res } = await runValidation(validatePlanTextbook, { body: {} });
    expect(res.statusCode).toBe(422);
  });

  it('validatePlanTextbook 合法数据应通过', async () => {
    const { nextCalled } = await runValidation(validatePlanTextbook, {
      body: { textbook_id: 3, is_required: true },
    });
    expect(nextCalled).toBe(true);
  });
});

// ──────────────────────────────────────────────
// 教师更新
// ──────────────────────────────────────────────
describe('validateTeacherUpdate', () => {
  it('空 body（全字段可选）应通过', async () => {
    const { nextCalled } = await runValidation(validateTeacherUpdate, { body: {} });
    expect(nextCalled).toBe(true);
  });

  it('name 为空字符串应返回 422', async () => {
    const { res } = await runValidation(validateTeacherUpdate, { body: { name: '' } });
    expect(res.statusCode).toBe(422);
  });

  it('自定义课时超上限应返回 422', async () => {
    const { res } = await runValidation(validateTeacherUpdate, {
      body: { default_weekly_hours: 41 },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ──────────────────────────────────────────────
// 教学安排规则链
// ──────────────────────────────────────────────
describe('教学安排规则链', () => {
  it('validateAssignTeacher 合法请求应通过', async () => {
    const { nextCalled } = await runValidation(validateAssignTeacher, {
      body: { class_id: 1, course_id: 2, teacher_id: 3, semester: '2025-2026-1', weekly_hours: 4 },
    });
    expect(nextCalled).toBe(true);
  });

  it('validateAssignTeacher 学期格式错误应返回 422', async () => {
    const { res } = await runValidation(validateAssignTeacher, {
      body: { class_id: 1, course_id: 2, teacher_id: 3, semester: '2025-2026-3' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('validateAssignTeacher 周课时超上限应返回 422', async () => {
    const { res } = await runValidation(validateAssignTeacher, {
      body: { class_id: 1, course_id: 2, teacher_id: 3, semester: '2025-2026-1', weekly_hours: 41 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('validateSwapTeachers 两位不同教师应通过', async () => {
    const { nextCalled } = await runValidation(validateSwapTeachers, {
      body: { course_id: 1, semester: '2025-2026-1', teacher_id_a: 1, teacher_id_b: 2 },
    });
    expect(nextCalled).toBe(true);
  });

  it('validateSwapTeachers 两位教师相同应返回 422 并提示', async () => {
    const { res } = await runValidation(validateSwapTeachers, {
      body: { course_id: 1, semester: '2025-2026-1', teacher_id_a: 5, teacher_id_b: '5' },
    });
    expect(res.statusCode).toBe(422);
    const messages = res._jsonCall.data.details.map((d) => d.message);
    expect(messages).toContain('两位教师不能相同');
  });

  it('validateBatchAutoArrange 合法请求应通过', async () => {
    const { nextCalled } = await runValidation(validateBatchAutoArrange, {
      body: { semester: '2025-2026-1', mode: 'full' },
    });
    expect(nextCalled).toBe(true);
  });

  it('validateBatchAutoArrange 缺学期应返回 422', async () => {
    const { res } = await runValidation(validateBatchAutoArrange, { body: { mode: 'full' } });
    expect(res.statusCode).toBe(422);
  });

  it('validateResetAuto course_id 为 falsy 应跳过校验', async () => {
    const { nextCalled } = await runValidation(validateResetAuto, {
      body: { semester: '2025-2026-1', course_id: '' },
    });
    expect(nextCalled).toBe(true);
  });

  it('validateResetAuto course_id 非整数应返回 422', async () => {
    const { res } = await runValidation(validateResetAuto, {
      body: { semester: '2025-2026-1', course_id: 'abc' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('validateHourSettings 对象设置应通过', async () => {
    const { nextCalled } = await runValidation(validateHourSettings, {
      body: { hour_settings: { full_time: { standard: 12 } }, course_id: 1 },
    });
    expect(nextCalled).toBe(true);
  });

  it('validateHourSettings 非对象设置应返回 422', async () => {
    const { res } = await runValidation(validateHourSettings, {
      body: { hour_settings: 'invalid' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('validateBatchUpdateHours 合法请求应通过', async () => {
    const { nextCalled } = await runValidation(validateBatchUpdateHours, {
      body: { teacher_ids: [1, 2, 3], default_weekly_hours: 12 },
    });
    expect(nextCalled).toBe(true);
  });

  it('validateBatchUpdateHours 空数组应返回 422', async () => {
    const { res } = await runValidation(validateBatchUpdateHours, {
      body: { teacher_ids: [] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('validateBatchUpdateHours 教师 ID 非正整数应返回 422', async () => {
    const { res } = await runValidation(validateBatchUpdateHours, {
      body: { teacher_ids: [1, 'x'] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('validateSortOrder 排序值为负应返回 422', async () => {
    const { res } = await runValidation(validateSortOrder, { body: { sort_order: -5 } });
    expect(res.statusCode).toBe(422);
  });

  it('validateSortOrder 省略字段应通过', async () => {
    const { nextCalled } = await runValidation(validateSortOrder, { body: {} });
    expect(nextCalled).toBe(true);
  });
});
