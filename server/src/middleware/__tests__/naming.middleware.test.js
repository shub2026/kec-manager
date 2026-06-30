/**
 * naming.middleware.js 单元测试
 *
 * 重点覆盖：
 * - convertRequestNaming：驼峰请求体 → 下划线
 * - convertResponseNaming：下划线响应 → 驼峰（含 SKIP_KEYS、数组、嵌套分页）
 * - 空 body / 无 body 请求不崩溃
 * - autoConvertNaming 组合中间件
 */
import { describe, it, expect, vi } from 'vitest';
import {
  convertRequestNaming,
  convertResponseNaming,
  autoConvertNaming,
} from '../naming.middleware.js';

// ──────────────────────────────────────────────
// 辅助：构造 mock req/res/next
// ──────────────────────────────────────────────
function mockReq(body = {}) {
  return { body, method: 'POST', path: '/api/test' };
}

/**
 * 模拟 Express 5 的 req.query getter 行为：
 * 每次访问都重新返回一个新对象（基于原始 query 解析），
 * 原地修改无效，必须用 Object.defineProperty 重定义 getter。
 */
function mockReqWithQuery(queryObj) {
  const req = { body: {}, method: 'GET', path: '/api/test' };
  // 用 getter 模拟 Express 5：每次访问返回新对象（与真实行为一致）
  Object.defineProperty(req, 'query', {
    configurable: true,
    enumerable: true,
    get() {
      // 返回浅拷贝，模拟每次解析返回新对象
      return { ...queryObj };
    },
  });
  return req;
}

function mockRes() {
  const res = {
    _jsonCall: null,
    statusCode: 200,
    headers: {},
    json(data) {
      this._jsonCall = data;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, val) {
      this.headers[key] = val;
    },
  };
  return res;
}

// ──────────────────────────────────────────────
// convertRequestNaming
// ──────────────────────────────────────────────
describe('convertRequestNaming', () => {
  it('应将驼峰请求体转为下划线', () => {
    const req = mockReq({ trainingLevelId: 1, majorId: 2 });
    const res = mockRes();
    const next = vi.fn();

    convertRequestNaming(req, res, next);

    expect(req.body).toEqual({ training_level_id: 1, major_id: 2 });
    expect(next).toHaveBeenCalledOnce();
  });

  it('空对象 body 应跳过转换但调用 next', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    convertRequestNaming(req, res, next);

    expect(req.body).toEqual({});
    expect(next).toHaveBeenCalledOnce();
  });

  it('无 body 的 GET 请求应跳过转换', () => {
    const req = { method: 'GET', path: '/api/test' };
    const res = mockRes();
    const next = vi.fn();

    convertRequestNaming(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toBeUndefined();
  });

  it('嵌套对象也应递归转换', () => {
    const req = mockReq({
      outerField: {
        innerField: 'value',
      },
    });
    const res = mockRes();
    const next = vi.fn();

    convertRequestNaming(req, res, next);

    expect(req.body).toEqual({
      outer_field: { inner_field: 'value' },
    });
  });

  // ── query params 转换（Express 5 getter 场景）──
  it('应将 query 中的驼峰参数转为下划线', () => {
    const req = mockReqWithQuery({ courseId: 1, semester: '2025-2026-1' });
    const res = mockRes();
    const next = vi.fn();

    convertRequestNaming(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.query.course_id).toBe(1);
    expect(req.query.semester).toBe('2025-2026-1');
    expect(req.query.courseId).toBeUndefined();
  });

  it('多次访问 req.query 应返回一致的转换结果（getter 缓存生效）', () => {
    const req = mockReqWithQuery({ downloadToken: 'abc', courseId: 1 });
    const res = mockRes();
    const next = vi.fn();

    convertRequestNaming(req, res, next);

    // 模拟 controller 多次访问 req.query
    const first = req.query;
    const second = req.query;
    expect(first.download_token).toBe('abc');
    expect(second.download_token).toBe('abc');
    expect(first.course_id).toBe(1);
    expect(second.course_id).toBe(1);
    expect(first.downloadToken).toBeUndefined();
  });

  it('无驼峰字段的 query 不应被重定义', () => {
    const req = mockReqWithQuery({ semester: '2025-2026-1', page: 1 });
    const res = mockRes();
    const next = vi.fn();

    convertRequestNaming(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.query.semester).toBe('2025-2026-1');
    expect(req.query.page).toBe(1);
  });
});

// ──────────────────────────────────────────────
// convertResponseNaming
// ──────────────────────────────────────────────
describe('convertResponseNaming', () => {
  it('应将下划线响应数据转为驼峰', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    convertResponseNaming(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // res.json 已被重写，调用后应输出驼峰
    res.json({ data: { training_level_id: 1 } });
    expect(res._jsonCall.data).toEqual({ trainingLevelId: 1 });
  });

  it('SKIP_KEYS 字段（code/message/success）不应被转换', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    convertResponseNaming(req, res, next);

    res.json({
      success: true,
      message: '操作成功',
      code: 200,
      data: { class_id: 5 },
    });

    expect(res._jsonCall.success).toBe(true);
    expect(res._jsonCall.message).toBe('操作成功');
    expect(res._jsonCall.code).toBe(200);
    expect(res._jsonCall.data).toEqual({ classId: 5 });
  });

  it('数组字段中的对象元素应被转换', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    convertResponseNaming(req, res, next);

    res.json({
      data: [
        { class_id: 1, class_name: '一班' },
        { class_id: 2, class_name: '二班' },
      ],
    });

    expect(res._jsonCall.data).toEqual([
      { classId: 1, className: '一班' },
      { classId: 2, className: '二班' },
    ]);
  });

  it('数组中的非对象元素（字符串/数字）应原样返回', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    convertResponseNaming(req, res, next);

    res.json({ data: ['hello', 42, null] });

    expect(res._jsonCall.data).toEqual(['hello', 42, null]);
  });

  it('嵌套分页对象 data.data.list 应被转换', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    convertResponseNaming(req, res, next);

    res.json({
      data: {
        total: 100,
        list: [
          { teacher_id: 1, teacher_name: '张老师' },
          { teacher_id: 2, teacher_name: '李老师' },
        ],
      },
    });

    expect(res._jsonCall.data.list).toEqual([
      { teacherId: 1, teacherName: '张老师' },
      { teacherId: 2, teacherName: '李老师' },
    ]);
  });

  it('null 或非对象数据不应崩溃', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    convertResponseNaming(req, res, next);

    res.json(null);
    expect(res._jsonCall).toBeNull();

    res.json('plain string');
    expect(res._jsonCall).toBe('plain string');
  });

  it('多次调用 json 应都经过转换', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    convertResponseNaming(req, res, next);

    res.json({ data: { field_one: 1 } });
    expect(res._jsonCall.data).toEqual({ fieldOne: 1 });

    res.json({ data: { field_two: 2 } });
    expect(res._jsonCall.data).toEqual({ fieldTwo: 2 });
  });
});

// ──────────────────────────────────────────────
// autoConvertNaming
// ──────────────────────────────────────────────
describe('autoConvertNaming', () => {
  it('应返回包含两个中间件的数组', () => {
    const result = autoConvertNaming();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('function');
    expect(typeof result[1]).toBe('function');
  });

  it('组合中间件应正确处理请求和响应转换', () => {
    const [reqMiddleware, resMiddleware] = autoConvertNaming();

    const req = mockReq({ camelCaseField: 'value' });
    const res = mockRes();
    const next = vi.fn();

    reqMiddleware(req, res, next);
    expect(req.body).toEqual({ camel_case_field: 'value' });

    next.mockClear();
    resMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    res.json({ data: { snake_case_field: 'value' } });
    expect(res._jsonCall.data).toEqual({ snakeCaseField: 'value' });
  });
});
