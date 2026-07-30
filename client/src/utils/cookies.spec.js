import { describe, it, expect, beforeEach } from 'vitest';
import { setCookie, getCookie, deleteCookie, clearAuthCookies } from '@/utils/cookies';

// jsdom 提供可读写的 document.cookie（http 环境，不带 Secure 标志）
function clearAllCookies() {
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
    }
  });
}

describe('cookies 工具', () => {
  beforeEach(() => {
    clearAllCookies();
  });

  it('setCookie 后可通过 getCookie 读取', () => {
    setCookie('foo', 'bar');
    expect(getCookie('foo')).toBe('bar');
  });

  it('setCookie 对值做 URI 编码，getCookie 解码还原', () => {
    setCookie('token', 'a b;c=d');
    expect(getCookie('token')).toBe('a b;c=d');
  });

  it('getCookie 读取不存在的键返回 null', () => {
    expect(getCookie('nonexistent')).toBeNull();
  });

  it('多个 cookie 共存时按名称精确读取', () => {
    setCookie('a', '1');
    setCookie('b', '2');
    expect(getCookie('a')).toBe('1');
    expect(getCookie('b')).toBe('2');
  });

  it('deleteCookie 删除后读取为 null', () => {
    setCookie('foo', 'bar');
    deleteCookie('foo');
    expect(getCookie('foo')).toBeNull();
  });

  it('clearAuthCookies 清除全部认证相关 cookie', () => {
    setCookie('auth_token', 't1');
    setCookie('auth_refreshToken', 't2');
    setCookie('XSRF-TOKEN', 't3');
    setCookie('other', 'keep');

    clearAuthCookies();

    expect(getCookie('auth_token')).toBeNull();
    expect(getCookie('auth_refreshToken')).toBeNull();
    expect(getCookie('XSRF-TOKEN')).toBeNull();
    expect(getCookie('other')).toBe('keep');
  });
});
