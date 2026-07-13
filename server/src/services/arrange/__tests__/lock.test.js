/**
 * lock.js 单元测试
 *
 * 覆盖 acquireLock / releaseLock 所有分支：
 * - 成功获取锁（INSERT 返回 > 0）
 * - 过期锁清理后重试成功
 * - 超时返回 false
 * - 异常处理（catch 分支）
 * - releaseLock 成功删除
 * - releaseLock 异常时不抛出
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────
// Mock dependencies using vi.hoisted
// ──────────────────────────────────────────────
const { executeRawFn, loggerWarn } = vi.hoisted(() => ({
  executeRawFn: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $executeRaw: executeRawFn,
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  default: { warn: loggerWarn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { acquireLock, releaseLock } = await import('../lock.js');

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Configure $executeRaw mock to simulate specific behavior sequences.
 * The mock is called as a tagged template, so args[0] is a TemplateStringsArray.
 * We inspect the SQL content to distinguish INSERT vs DELETE calls.
 */
function setupInsertSuccess() {
  // INSERT returns 1 (row inserted = lock acquired)
  executeRawFn.mockImplementation(async (strings, ...values) => {
    const sql = strings.join('');
    if (sql.includes('INSERT')) return 1;
    if (sql.includes('DELETE')) return 0;
    return 0;
  });
}

function setupInsertFailsThenExpires() {
  let callCount = 0;
  executeRawFn.mockImplementation(async (strings, ...values) => {
    const sql = strings.join('');
    if (sql.includes('INSERT')) {
      callCount++;
      return 0; // lock already held
    }
    if (sql.includes('DELETE')) {
      // First DELETE finds expired lock
      return callCount <= 1 ? 1 : 0;
    }
    return 0;
  });
}

function setupInsertAlwaysFails() {
  executeRawFn.mockImplementation(async (strings, ...values) => {
    const sql = strings.join('');
    if (sql.includes('INSERT')) return 0;
    if (sql.includes('DELETE')) return 0; // no expired lock to clean
    return 0;
  });
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('acquireLock', () => {
  it('首次 INSERT 成功时应立即返回 true', async () => {
    setupInsertSuccess();

    const promise = acquireLock('test:lock');
    // No timers to advance since it succeeds immediately
    const result = await promise;

    expect(result).toBe(true);
    expect(executeRawFn).toHaveBeenCalledTimes(1);
  });

  it('应传入正确的 lockKey 参数', async () => {
    setupInsertSuccess();
    await acquireLock('arrange:1:2025-2026-1');

    // Check that the first call included the lock key
    const firstCallArgs = executeRawFn.mock.calls[0];
    // Tagged template: first arg is strings array, subsequent args are values
    const values = firstCallArgs.slice(1);
    expect(values).toContain('arrange:1:2025-2026-1');
  });

  it('INSERT 失败后清理过期锁，重试 INSERT 成功 → 返回 true', async () => {
    let insertCalls = 0;
    executeRawFn.mockImplementation(async (strings) => {
      const sql = strings.join('');
      if (sql.includes('INSERT')) {
        insertCalls++;
        if (insertCalls === 1) return 0; // first attempt fails
        return 1; // retry succeeds after expired lock cleaned
      }
      if (sql.includes('DELETE')) return 1; // found expired lock
      return 0;
    });

    const promise = acquireLock('test:lock', 5000);
    // The first INSERT fails, then DELETE succeeds (expired lock),
    // then loop continues → INSERT succeeds
    const result = await promise;
    expect(result).toBe(true);
    expect(insertCalls).toBe(2);
  });

  it('超时时应返回 false', async () => {
    setupInsertAlwaysFails();

    // Use a very short timeout
    const promise = acquireLock('test:lock', 100);

    // Advance timers past the timeout
    // The loop does: INSERT (fail) → DELETE (no expired) → setTimeout(200)
    // We need to advance past the timeout
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('默认超时为 LOCK_TIMEOUT_MS (5000ms)', async () => {
    setupInsertAlwaysFails();

    const promise = acquireLock('test:lock');

    // Advance well past 5 seconds
    await vi.advanceTimersByTimeAsync(6000);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('INSERT 抛出异常时应 catch 并重试', async () => {
    let callCount = 0;
    executeRawFn.mockImplementation(async (strings) => {
      const sql = strings.join('');
      if (sql.includes('INSERT')) {
        callCount++;
        if (callCount === 1) throw new Error('DB connection error');
        return 1; // second attempt succeeds
      }
      return 0;
    });

    const promise = acquireLock('test:lock', 5000);
    // First call throws, then setTimeout(200), then retry succeeds
    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;
    expect(result).toBe(true);
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('acquireLock error'));
  });

  it('多次重试后最终成功', async () => {
    let insertCalls = 0;
    executeRawFn.mockImplementation(async (strings) => {
      const sql = strings.join('');
      if (sql.includes('INSERT')) {
        insertCalls++;
        if (insertCalls < 3) return 0; // fail twice
        return 1; // succeed on third
      }
      if (sql.includes('DELETE')) return 0; // no expired locks
      return 0;
    });

    const promise = acquireLock('test:lock', 10000);
    // Each failed attempt: INSERT(fail) → DELETE(no expired) → setTimeout(200)
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe(true);
    expect(insertCalls).toBe(3);
  });

  it('并发调用：两个不同的 lockKey 互不干扰', async () => {
    setupInsertSuccess();

    const r1 = await acquireLock('lock:A');
    const r2 = await acquireLock('lock:B');

    expect(r1).toBe(true);
    expect(r2).toBe(true);
  });

  it('异常持续触发时不会无限循环（受超时保护）', async () => {
    executeRawFn.mockRejectedValue(new Error('persistent error'));

    const promise = acquireLock('test:lock', 300);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toBe(false);
    expect(loggerWarn).toHaveBeenCalled();
  });
});

describe('releaseLock', () => {
  it('应执行 DELETE 语句删除锁记录', async () => {
    executeRawFn.mockResolvedValue(1);

    await releaseLock('test:lock');

    expect(executeRawFn).toHaveBeenCalledTimes(1);
    const callArgs = executeRawFn.mock.calls[0];
    const sql = callArgs[0].join('');
    expect(sql).toContain('DELETE');
    expect(sql).toContain('arrange_locks');
    const values = callArgs.slice(1);
    expect(values).toContain('test:lock');
  });

  it('DELETE 返回 0（锁不存在）时不应抛出异常', async () => {
    executeRawFn.mockResolvedValue(0);

    await expect(releaseLock('nonexistent:lock')).resolves.toBeUndefined();
  });

  it('DELETE 抛出异常时应 catch 并不抛出', async () => {
    executeRawFn.mockRejectedValue(new Error('DB error'));

    await expect(releaseLock('test:lock')).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('releaseLock error'));
  });

  it('多次释放同一锁不应报错', async () => {
    executeRawFn.mockResolvedValue(1);

    await releaseLock('test:lock');
    await releaseLock('test:lock');
    await releaseLock('test:lock');

    expect(executeRawFn).toHaveBeenCalledTimes(3);
  });
});

describe('acquireLock + releaseLock 集成场景', () => {
  it('获取锁后释放，再次获取应成功', async () => {
    // Simulate: acquire → release → acquire
    let insertCalls = 0;
    executeRawFn.mockImplementation(async (strings) => {
      const sql = strings.join('');
      if (sql.includes('INSERT')) {
        insertCalls++;
        return 1; // always succeed
      }
      if (sql.includes('DELETE')) return 1;
      return 0;
    });

    const r1 = await acquireLock('test:lock');
    expect(r1).toBe(true);

    await releaseLock('test:lock');

    const r2 = await acquireLock('test:lock');
    expect(r2).toBe(true);

    expect(insertCalls).toBe(2);
  });

  it('自定义 timeoutMs 参数生效', async () => {
    setupInsertAlwaysFails();

    // Very short timeout
    const start = Date.now();
    const promise = acquireLock('test:lock', 50);
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result).toBe(false);
  });
});
