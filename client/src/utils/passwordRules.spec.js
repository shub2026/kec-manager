/**
 * utils/passwordRules.js 单元测试
 *
 * 覆盖全站统一密码强度口径：
 * - 复杂度校验器：空值放行、单一字符类型拒绝、两类型组合放行
 * - createPasswordRules：required 开关、长度区间、每次返回新数组
 * - createConfirmPasswordValidator：与目标密码比对
 */
import { describe, it, expect, vi } from 'vitest';
import {
  passwordComplexityValidator,
  createPasswordRules,
  createConfirmPasswordValidator,
  PASSWORD_MIN,
  PASSWORD_MAX,
} from './passwordRules';

function runValidator(validator, value) {
  return new Promise((resolve) => {
    validator({}, value, (err) => resolve(err));
  });
}

describe('passwordComplexityValidator', () => {
  it('空值直接放行（由 required 规则负责必填校验）', async () => {
    expect(await runValidator(passwordComplexityValidator, '')).toBeUndefined();
    expect(await runValidator(passwordComplexityValidator, null)).toBeUndefined();
    expect(await runValidator(passwordComplexityValidator, undefined)).toBeUndefined();
  });

  it.each(['abcdefgh', 'ABCDEFGH', '12345678', '!@#$%^&*'])(
    '仅一种字符类型 "%s" 被拒绝',
    async (value) => {
      const err = await runValidator(passwordComplexityValidator, value);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('至少包含两种字符类型');
    }
  );

  it.each([
    ['小写+数字', 'abcd1234'],
    ['小写+大写', 'abcdEFGH'],
    ['小写+特殊', 'abcd!@#$'],
    ['大写+数字', 'ABCD1234'],
    ['数字+特殊', '1234!@#$'],
    ['四种齐全', 'aA1!aA1!'],
  ])('%s 组合放行', async (_label, value) => {
    expect(await runValidator(passwordComplexityValidator, value)).toBeUndefined();
  });
});

describe('createPasswordRules', () => {
  it('默认 required=true 返回 3 条规则且首条为必填', () => {
    const rules = createPasswordRules();
    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatchObject({ required: true, message: '请输入新密码' });
  });

  it('required=false 时不含必填规则', () => {
    const rules = createPasswordRules({ required: false });
    expect(rules).toHaveLength(2);
    expect(rules.some((r) => r.required)).toBe(false);
  });

  it('长度规则使用统一常量区间 8-128', () => {
    const rules = createPasswordRules();
    const lenRule = rules.find((r) => r.min != null);
    expect(lenRule).toMatchObject({ min: PASSWORD_MIN, max: PASSWORD_MAX });
    expect(PASSWORD_MIN).toBe(8);
    expect(PASSWORD_MAX).toBe(128);
  });

  it('每次调用返回新数组，避免多组件共享引用', () => {
    expect(createPasswordRules()).not.toBe(createPasswordRules());
  });
});

describe('createConfirmPasswordValidator', () => {
  it('两次输入一致时放行', async () => {
    const validator = createConfirmPasswordValidator(() => 'aA1!aA1!');
    expect(await runValidator(validator, 'aA1!aA1!')).toBeUndefined();
  });

  it('两次输入不一致时报错', async () => {
    const getPassword = vi.fn(() => 'aA1!aA1!');
    const validator = createConfirmPasswordValidator(getPassword);
    const err = await runValidator(validator, 'different1');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('两次输入的密码不一致');
    expect(getPassword).toHaveBeenCalled();
  });

  it('取值函数每次校验动态读取（改密后可重新比对）', async () => {
    let pwd = 'first123';
    const validator = createConfirmPasswordValidator(() => pwd);
    expect(await runValidator(validator, 'first123')).toBeUndefined();
    pwd = 'second456';
    const err = await runValidator(validator, 'first123');
    expect(err).toBeInstanceOf(Error);
  });
});
