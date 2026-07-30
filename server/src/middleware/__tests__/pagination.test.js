/**
 * pagination 中间件单元测试
 *
 * 覆盖：
 * - validatePagination: 合法/非法 page 与 page_size、缺省参数、自定义 maxPageSize
 */
import { describe, it, expect, vi } from 'vitest';
import { validatePagination } from '../pagination.js';

/** 依次运行验证规则链并调用收尾处理器 */
async function runChain(chain, query) {
  const req = { query };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();

  const handler = chain[chain.length - 1];
  for (const rule of chain.slice(0, -1)) {
    await rule.run(req);
  }
  handler(req, res, next);
  return { req, res, next };
}

describe('validatePagination', () => {
  it('合法分页参数放行', async () => {
    const { res, next } = await runChain(validatePagination(), { page: '2', page_size: '50' });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('缺省参数（optional）直接放行', async () => {
    const { next } = await runChain(validatePagination(), {});
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('page=0 返回 422 与字段级错误信息', async () => {
    const { res, next } = await runChain(validatePagination(), { page: '0' });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.errors).toEqual([
      expect.objectContaining({ field: 'page', message: '页码必须为正整数', location: 'query' }),
    ]);
  });

  it('page_size 超过默认上限 100 返回 422', async () => {
    const { res } = await runChain(validatePagination(), { page_size: '101' });

    expect(res.status).toHaveBeenCalledWith(422);
    const body = res.json.mock.calls[0][0];
    expect(body.errors[0]).toMatchObject({
      field: 'page_size',
      message: '每页数量必须在1-100之间',
    });
  });

  it('自定义 maxPageSize 生效', async () => {
    const chain = validatePagination(500);

    const over = await runChain(chain, { page_size: '501' });
    expect(over.res.status).toHaveBeenCalledWith(422);
    expect(over.res.json.mock.calls[0][0].errors[0].message).toBe('每页数量必须在1-500之间');

    const ok = await runChain(chain, { page_size: '500' });
    expect(ok.next).toHaveBeenCalledTimes(1);
  });

  it('多个非法参数同时返回全部错误', async () => {
    const { res } = await runChain(validatePagination(), { page: '-1', page_size: 'abc' });

    const body = res.json.mock.calls[0][0];
    expect(body.errors).toHaveLength(2);
    expect(body.errors.map((e) => e.field).sort()).toEqual(['page', 'page_size']);
  });
});
