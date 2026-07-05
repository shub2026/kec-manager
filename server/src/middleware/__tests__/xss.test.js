/**
 * sanitizeBody / sanitizeQuery 中间件单元测试
 *
 * 覆盖场景：
 * - 清洗字符串值（去除 HTML 标签）
 * - 递归处理嵌套对象
 * - 递归处理数组
 * - 跳过密码字段（SKIP_SANITIZE_KEYS）
 * - 处理 null/undefined 值
 * - 处理非字符串值（数字、布尔）→ 透传
 * - sanitizeQuery 对查询参数应用相同逻辑
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// xss 库是纯函数库，无需 mock，使用真实清洗行为

const { sanitizeBody, sanitizeQuery } = await import('../xss.js');

// ──────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────
function makeReq(overrides = {}) {
  return {
    body: {},
    query: {},
    ...overrides,
  };
}

function makeRes() {
  return {};
}

// ════════════════════════════════════════════════
// sanitizeBody
// ════════════════════════════════════════════════
describe('sanitizeBody — 请求体 XSS 清洗', () => {
  let next;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('应清洗字符串值中的 HTML 标签', () => {
    const req = makeReq({
      body: { name: '<script>alert("xss")</script>张三', description: '正常文本' },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.name).not.toContain('<script>');
    expect(req.body.name).toContain('张三');
    expect(req.body.description).toBe('正常文本');
    expect(next).toHaveBeenCalled();
  });

  it('应递归处理嵌套对象', () => {
    const req = makeReq({
      body: {
        user: {
          name: '<script>alert("xss")</script>王五',
          address: { city: '<iframe src="evil"></iframe>北京' },
        },
      },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.user.name).not.toContain('<script>');
    expect(req.body.user.name).toContain('王五');
    expect(req.body.user.address.city).not.toContain('<iframe');
    expect(req.body.user.address.city).toContain('北京');
    expect(next).toHaveBeenCalled();
  });

  it('应递归处理数组', () => {
    const req = makeReq({
      body: {
        tags: ['<iframe src="evil"></iframe>标签1', '<script>bad</script>标签2'],
      },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.tags[0]).not.toContain('<iframe');
    expect(req.body.tags[0]).toContain('标签1');
    expect(req.body.tags[1]).not.toContain('<script>');
    expect(req.body.tags[1]).toContain('标签2');
    expect(next).toHaveBeenCalled();
  });

  it('应跳过密码字段不进行清洗', () => {
    const req = makeReq({
      body: {
        username: 'admin',
        password: '<script>alert("hack")</script>',
        oldPassword: '<b>old</b>',
        newPassword: '<i>new</i>',
        confirmPassword: '<u>confirm</u>',
      },
    });

    sanitizeBody(req, makeRes(), next);

    // 密码字段应保持原样
    expect(req.body.password).toBe('<script>alert("hack")</script>');
    expect(req.body.oldPassword).toBe('<b>old</b>');
    expect(req.body.newPassword).toBe('<i>new</i>');
    expect(req.body.confirmPassword).toBe('<u>confirm</u>');
    // 非密码字段应被清洗
    expect(req.body.username).toBe('admin');
    expect(next).toHaveBeenCalled();
  });

  it('应跳过下划线风格的密码字段', () => {
    const req = makeReq({
      body: {
        old_password: '<b>old_pw</b>',
        new_password: '<i>new_pw</i>',
      },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.old_password).toBe('<b>old_pw</b>');
    expect(req.body.new_password).toBe('<i>new_pw</i>');
    expect(next).toHaveBeenCalled();
  });

  it('嵌套对象中的密码字段也应被跳过', () => {
    const req = makeReq({
      body: {
        user: {
          name: '<script>alert("xss")</script>张三',
          password: '<script>secret</script>',
        },
      },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.user.name).not.toContain('<script>');
    expect(req.body.user.name).toContain('张三');
    expect(req.body.user.password).toBe('<script>secret</script>');
    expect(next).toHaveBeenCalled();
  });

  it('应处理 null 值', () => {
    const req = makeReq({
      body: { name: null, description: '正常' },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.name).toBeNull();
    expect(req.body.description).toBe('正常');
    expect(next).toHaveBeenCalled();
  });

  it('应处理 undefined 值', () => {
    const req = makeReq({
      body: { name: undefined, count: 5 },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.name).toBeUndefined();
    expect(req.body.count).toBe(5);
    expect(next).toHaveBeenCalled();
  });

  it('数字值应透传不变', () => {
    const req = makeReq({
      body: { age: 25, score: 99.5 },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.age).toBe(25);
    expect(req.body.score).toBe(99.5);
    expect(next).toHaveBeenCalled();
  });

  it('布尔值应透传不变', () => {
    const req = makeReq({
      body: { active: true, deleted: false },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.active).toBe(true);
    expect(req.body.deleted).toBe(false);
    expect(next).toHaveBeenCalled();
  });

  it('body 为 null 时应直接调用 next', () => {
    const req = { body: null };

    sanitizeBody(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it('body 为非对象时应直接调用 next', () => {
    const req = { body: 'string-body' };

    sanitizeBody(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it('应对字符串进行 trim 操作', () => {
    const req = makeReq({
      body: { name: '  张三  ' },
    });

    sanitizeBody(req, makeRes(), next);

    expect(req.body.name).toBe('张三');
    expect(next).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════
// sanitizeQuery
// ════════════════════════════════════════════════
describe('sanitizeQuery — 查询参数 XSS 清洗', () => {
  let next;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it('应清洗查询参数中的 HTML 标签', () => {
    const req = makeReq({
      query: { search: '<script>alert("xss")</script>关键词', page: '1' },
    });

    sanitizeQuery(req, makeRes(), next);

    expect(req.query.search).not.toContain('<script>');
    expect(req.query.search).toContain('关键词');
    expect(req.query.page).toBe('1');
    expect(next).toHaveBeenCalled();
  });

  it('query 为 null 时应直接调用 next', () => {
    const req = { query: null };

    sanitizeQuery(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it('应对嵌套的查询参数值也进行清洗', () => {
    const req = makeReq({
      query: { filter: { name: '<script>alert("xss")</script>测试' } },
    });

    sanitizeQuery(req, makeRes(), next);

    expect(req.query.filter.name).not.toContain('<script>');
    expect(req.query.filter.name).toContain('测试');
    expect(next).toHaveBeenCalled();
  });

  it('数字和布尔类型的查询参数应透传', () => {
    const req = makeReq({
      query: { count: 10, flag: true },
    });

    sanitizeQuery(req, makeRes(), next);

    expect(req.query.count).toBe(10);
    expect(req.query.flag).toBe(true);
    expect(next).toHaveBeenCalled();
  });
});
