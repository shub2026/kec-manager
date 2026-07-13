/**
 * sse.js 单元测试
 *
 * 覆盖：
 * - initSSE：响应头设置、socket 配置
 * - sendSSEEvent：事件格式、JSON 序列化、snake_case→camelCase 转换、writableEnded 守卫
 * - isSSERequest：Accept 头检测
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initSSE, sendSSEEvent, isSSERequest } from '../sse.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function makeRes(overrides = {}) {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    writableEnded: false,
    socket: {
      setTimeout: vi.fn(),
      setNoDelay: vi.fn(),
    },
    ...overrides,
  };
}

function makeReq(headers = {}) {
  return { headers };
}

// ──────────────────────────────────────────────
// initSSE
// ──────────────────────────────────────────────
describe('initSSE', () => {
  it('应设置正确的 SSE 响应头', () => {
    const res = makeRes();
    initSSE(res);

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });

  it('应设置 socket 超时为 0 并禁用 Nagle 算法', () => {
    const res = makeRes();
    initSSE(res);

    expect(res.socket.setTimeout).toHaveBeenCalledWith(0);
    expect(res.socket.setNoDelay).toHaveBeenCalledWith(true);
  });

  it('res.socket 不存在时不应抛出错误', () => {
    const res = makeRes({ socket: null });

    expect(() => initSSE(res)).not.toThrow();
    expect(res.writeHead).toHaveBeenCalled();
  });

  it('res.socket 为 undefined 时不应抛出错误', () => {
    const res = makeRes({ socket: undefined });

    expect(() => initSSE(res)).not.toThrow();
  });
});

// ──────────────────────────────────────────────
// sendSSEEvent
// ──────────────────────────────────────────────
describe('sendSSEEvent', () => {
  it('应写入正确格式的 SSE 事件', () => {
    const res = makeRes();
    sendSSEEvent(res, 'progress', { current: 5, total: 10 });

    expect(res.write).toHaveBeenCalledTimes(2);
    expect(res.write).toHaveBeenNthCalledWith(1, 'event: progress\n');
    expect(res.write).toHaveBeenNthCalledWith(
      2,
      `data: ${JSON.stringify({ current: 5, total: 10 })}\n\n`
    );
  });

  it('应将 snake_case 数据键名转换为 camelCase', () => {
    const res = makeRes();
    sendSSEEvent(res, 'update', { user_name: 'Alice', item_count: 3 });

    const dataCall = res.write.mock.calls[1][0];
    const parsed = JSON.parse(dataCall.replace('data: ', '').trim());
    expect(parsed).toEqual({ userName: 'Alice', itemCount: 3 });
  });

  it('非对象数据不应被转换', () => {
    const res = makeRes();
    sendSSEEvent(res, 'message', 'hello');

    const dataCall = res.write.mock.calls[1][0];
    expect(dataCall).toBe('data: "hello"\n\n');
  });

  it('null 数据不应被转换', () => {
    const res = makeRes();
    sendSSEEvent(res, 'empty', null);

    const dataCall = res.write.mock.calls[1][0];
    expect(dataCall).toBe('data: null\n\n');
  });

  it('undefined 数据不应被转换', () => {
    const res = makeRes();
    sendSSEEvent(res, 'empty', undefined);

    const dataCall = res.write.mock.calls[1][0];
    expect(dataCall).toBe('data: undefined\n\n');
  });

  it('数字数据不应被转换', () => {
    const res = makeRes();
    sendSSEEvent(res, 'count', 42);

    const dataCall = res.write.mock.calls[1][0];
    expect(dataCall).toBe('data: 42\n\n');
  });

  it('writableEnded 为 true 时不应写入任何数据', () => {
    const res = makeRes({ writableEnded: true });
    sendSSEEvent(res, 'progress', { current: 1 });

    expect(res.write).not.toHaveBeenCalled();
  });

  it('空对象数据应被正确处理', () => {
    const res = makeRes();
    sendSSEEvent(res, 'event', {});

    const dataCall = res.write.mock.calls[1][0];
    expect(dataCall).toBe('data: {}\n\n');
  });

  it('数组数据应被正确处理', () => {
    const res = makeRes();
    sendSSEEvent(res, 'list', [1, 2, 3]);

    const dataCall = res.write.mock.calls[1][0];
    expect(dataCall).toBe('data: [1,2,3]\n\n');
  });
});

// ──────────────────────────────────────────────
// isSSERequest
// ──────────────────────────────────────────────
describe('isSSERequest', () => {
  it('Accept 头包含 text/event-stream 时应返回 true', () => {
    const req = makeReq({ accept: 'text/event-stream' });
    expect(isSSERequest(req)).toBe(true);
  });

  it('Accept 头包含多种类型且含 text/event-stream 时应返回 true', () => {
    const req = makeReq({ accept: 'application/json, text/event-stream, */*' });
    expect(isSSERequest(req)).toBe(true);
  });

  it('Accept 头不含 text/event-stream 时应返回 false', () => {
    const req = makeReq({ accept: 'application/json' });
    expect(isSSERequest(req)).toBe(false);
  });

  it('无 Accept 头时应返回 falsy 值', () => {
    const req = makeReq({});
    expect(isSSERequest(req)).toBeFalsy();
  });

  it('Accept 头为 undefined 时不应抛出错误', () => {
    const req = makeReq({ accept: undefined });
    expect(() => isSSERequest(req)).not.toThrow();
    expect(isSSERequest(req)).toBeFalsy();
  });
});
