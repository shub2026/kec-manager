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
  validateChangePassword,
  validateIdParam,
  validatePagination,
  validateSemesterQuery,
  validateTeacherCreate,
  validateAutoArrange,
  validateReset,
} = await import('../validation.js');

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
