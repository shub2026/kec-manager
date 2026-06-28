/**
 * naming.js 单元测试
 *
 * 重点覆盖：
 * - camelToSnake / snakeToCamel 基本转换
 * - 嵌套对象与数组的递归转换
 * - Array.isArray 必须在 constructor 守卫之前（已知 bug 修复）
 * - 类实例（如 Prisma Decimal）不被递归展开（constructor !== Object 守卫）
 * - Date 对象直接返回
 * - null / undefined / 基本类型直接返回
 * - shallow 版本只转换第一层
 */
import { describe, it, expect } from 'vitest';
import {
  camelToSnake,
  snakeToCamel,
  shallowSnakeToCamel,
  shallowCamelToSnake,
} from '../naming.js';

// ──────────────────────────────────────────────
// 模拟 Prisma Decimal 类实例
// ──────────────────────────────────────────────
class FakeDecimal {
  constructor(value) {
    this.s = 1;
    this.e = 2;
    this.d = [value];
  }
}

// ──────────────────────────────────────────────
// camelToSnake
// ──────────────────────────────────────────────
describe('camelToSnake', () => {
  describe('基本转换', () => {
    it('应将 camelCase 键名转为 snake_case', () => {
      expect(camelToSnake({ firstName: 'Alice', lastName: 'Smith' })).toEqual({
        first_name: 'Alice',
        last_name: 'Smith',
      });
    });

    it('应处理多个连续大写字母', () => {
      expect(camelToSnake({ myURLParser: true })).toEqual({
        my_u_r_l_parser: true,
      });
    });

    it('已是 snake_case 的键名不应被重复转换', () => {
      expect(camelToSnake({ already_snake: 1 })).toEqual({ already_snake: 1 });
    });

    it('空对象应返回空对象', () => {
      expect(camelToSnake({})).toEqual({});
    });
  });

  describe('嵌套结构', () => {
    it('应递归转换嵌套对象', () => {
      const input = { userName: 'Bob', homeAddress: { cityName: 'Beijing', zipCode: '100000' } };
      expect(camelToSnake(input)).toEqual({
        user_name: 'Bob',
        home_address: { city_name: 'Beijing', zip_code: '100000' },
      });
    });

    it('应递归转换数组中的对象', () => {
      const input = [{ firstName: 'A' }, { firstName: 'B' }];
      expect(camelToSnake(input)).toEqual([{ first_name: 'A' }, { first_name: 'B' }]);
    });

    it('应处理对象内的数组值', () => {
      const input = { userList: [{ userName: 'A' }, { userName: 'B' }] };
      expect(camelToSnake(input)).toEqual({
        user_list: [{ user_name: 'A' }, { user_name: 'B' }],
      });
    });

    it('深层嵌套（3层）应全部转换', () => {
      const input = { levelOne: { levelTwo: { levelThree: 'deep' } } };
      expect(camelToSnake(input)).toEqual({
        level_one: { level_two: { level_three: 'deep' } },
      });
    });
  });

  describe('特殊类型保护', () => {
    it('null 应直接返回 null', () => {
      expect(camelToSnake(null)).toBeNull();
    });

    it('undefined 应直接返回 undefined', () => {
      expect(camelToSnake(undefined)).toBeUndefined();
    });

    it('数字应直接返回', () => {
      expect(camelToSnake(42)).toBe(42);
    });

    it('字符串应直接返回', () => {
      expect(camelToSnake('hello')).toBe('hello');
    });

    it('布尔值应直接返回', () => {
      expect(camelToSnake(true)).toBe(true);
    });

    it('Date 对象应直接返回（不展开）', () => {
      const d = new Date('2025-01-01');
      expect(camelToSnake(d)).toBe(d);
    });
  });

  describe('数组处理', () => {
    it('空数组应返回空数组', () => {
      expect(camelToSnake([])).toEqual([]);
    });

    it('基本类型数组应原样返回', () => {
      expect(camelToSnake([1, 'two', true])).toEqual([1, 'two', true]);
    });

    it('数组内的 Date 对象应保持不变', () => {
      const d = new Date('2025-06-01');
      const result = camelToSnake([{ createdAt: d }]);
      expect(result[0].created_at).toBe(d);
    });
  });

  describe('类实例守卫（constructor !== Object）', () => {
    it('类实例应直接返回，不被递归展开', () => {
      const decimal = new FakeDecimal(100);
      const result = camelToSnake({ priceValue: decimal });
      // priceValue → price_value，但 decimal 对象不被展开
      expect(result.price_value).toBe(decimal);
      expect(result.price_value).toBeInstanceOf(FakeDecimal);
    });

    it('类实例在数组中时也不被展开', () => {
      const decimal = new FakeDecimal(200);
      const result = camelToSnake([decimal]);
      expect(result[0]).toBe(decimal);
    });

    it('嵌套对象中的类实例应保持引用', () => {
      const decimal = new FakeDecimal(300);
      const result = camelToSnake({
        orderInfo: { totalAmount: decimal, itemCount: 5 },
      });
      expect(result.order_info.total_amount).toBe(decimal);
      expect(result.order_info.item_count).toBe(5);
    });
  });

  describe('关键修复验证：Array.isArray 在 constructor 守卫之前', () => {
    it('数组的 constructor 是 Array（!== Object），必须靠 isArray 先拦截', () => {
      // 如果 constructor 守卫在 Array.isArray 之前，
      // 数组会因为 Array.constructor !== Object 而被直接返回，内部对象不转换
      const input = [{ myKey: 'val' }];
      const result = camelToSnake(input);
      expect(result).toEqual([{ my_key: 'val' }]);
      // 如果顺序错误，结果会是 [{ myKey: 'val' }]（未转换）
      expect(result[0].my_key).toBe('val');
    });
  });

  describe('值中的特殊对象', () => {
    it('值为 null 时应保留 null', () => {
      expect(camelToSnake({ myField: null })).toEqual({ my_field: null });
    });

    it('值为 Date 时应保留 Date 引用', () => {
      const d = new Date();
      expect(camelToSnake({ createdAt: d })).toEqual({ created_at: d });
    });
  });
});

// ──────────────────────────────────────────────
// snakeToCamel
// ──────────────────────────────────────────────
describe('snakeToCamel', () => {
  describe('基本转换', () => {
    it('应将 snake_case 键名转为 camelCase', () => {
      expect(snakeToCamel({ first_name: 'Alice', last_name: 'Smith' })).toEqual({
        firstName: 'Alice',
        lastName: 'Smith',
      });
    });

    it('应处理连续下划线后的字母', () => {
      expect(snakeToCamel({ my_url_parser: true })).toEqual({ myUrlParser: true });
    });

    it('已是 camelCase 的键名不应被改变', () => {
      expect(snakeToCamel({ alreadyCamel: 1 })).toEqual({ alreadyCamel: 1 });
    });

    it('空对象应返回空对象', () => {
      expect(snakeToCamel({})).toEqual({});
    });
  });

  describe('嵌套结构', () => {
    it('应递归转换嵌套对象', () => {
      const input = { user_name: 'Bob', home_address: { city_name: 'Beijing' } };
      expect(snakeToCamel(input)).toEqual({
        userName: 'Bob',
        homeAddress: { cityName: 'Beijing' },
      });
    });

    it('应递归转换数组中的对象', () => {
      const input = [{ first_name: 'A' }, { first_name: 'B' }];
      expect(snakeToCamel(input)).toEqual([{ firstName: 'A' }, { firstName: 'B' }]);
    });

    it('应处理对象内的数组值', () => {
      const input = { user_list: [{ user_name: 'A' }] };
      expect(snakeToCamel(input)).toEqual({ userList: [{ userName: 'A' }] });
    });
  });

  describe('特殊类型保护', () => {
    it('null / undefined / 基本类型应直接返回', () => {
      expect(snakeToCamel(null)).toBeNull();
      expect(snakeToCamel(undefined)).toBeUndefined();
      expect(snakeToCamel(42)).toBe(42);
      expect(snakeToCamel('hello')).toBe('hello');
    });

    it('Date 对象应直接返回', () => {
      const d = new Date();
      expect(snakeToCamel(d)).toBe(d);
    });
  });

  describe('类实例守卫', () => {
    it('Prisma Decimal 类实例不应被展开为 {s,e,d}', () => {
      const decimal = new FakeDecimal(100);
      const result = snakeToCamel({ price_value: decimal });
      // price_value → priceValue，但 decimal 不被展开
      expect(result.priceValue).toBe(decimal);
      expect(result.priceValue).toBeInstanceOf(FakeDecimal);
    });

    it('嵌套中的类实例也应保持引用', () => {
      const decimal = new FakeDecimal(500);
      const result = snakeToCamel({
        order_info: { total_amount: decimal, item_count: 3 },
      });
      expect(result.orderInfo.totalAmount).toBe(decimal);
      expect(result.orderInfo.itemCount).toBe(3);
    });
  });

  describe('关键修复验证：Array.isArray 在 constructor 守卫之前', () => {
    it('数组必须被递归处理，不因 constructor 守卫而跳过', () => {
      const input = [{ my_key: 'val' }];
      const result = snakeToCamel(input);
      expect(result).toEqual([{ myKey: 'val' }]);
      expect(result[0].myKey).toBe('val');
    });
  });
});

// ──────────────────────────────────────────────
// 双向转换一致性
// ──────────────────────────────────────────────
describe('camelToSnake ↔ snakeToCamel 往返', () => {
  it('camelCase → snake_case → camelCase 应还原', () => {
    const original = { firstName: 'A', homeAddress: { zipCode: '100' } };
    const roundTrip = snakeToCamel(camelToSnake(original));
    expect(roundTrip).toEqual(original);
  });

  it('snake_case → camelCase → snake_case 应还原', () => {
    const original = { first_name: 'A', home_address: { zip_code: '100' } };
    const roundTrip = camelToSnake(snakeToCamel(original));
    expect(roundTrip).toEqual(original);
  });

  it('含数组的复杂对象往返应还原', () => {
    const original = {
      userList: [
        { firstName: 'A', tags: ['x', 'y'] },
        { firstName: 'B', tags: ['z'] },
      ],
      totalCount: 2,
    };
    expect(snakeToCamel(camelToSnake(original))).toEqual(original);
  });
});

// ──────────────────────────────────────────────
// shallowSnakeToCamel
// ──────────────────────────────────────────────
describe('shallowSnakeToCamel', () => {
  it('应只转换第一层键名', () => {
    const input = { user_name: 'Bob', home_address: { city_name: 'Beijing' } };
    const result = shallowSnakeToCamel(input);
    expect(result.userName).toBe('Bob');
    // 嵌套对象不转换
    expect(result.homeAddress).toEqual({ city_name: 'Beijing' });
  });

  it('null / undefined / 基本类型应直接返回', () => {
    expect(shallowSnakeToCamel(null)).toBeNull();
    expect(shallowSnakeToCamel(undefined)).toBeUndefined();
    expect(shallowSnakeToCamel(42)).toBe(42);
  });

  it('Date 对象应直接返回', () => {
    const d = new Date();
    expect(shallowSnakeToCamel(d)).toBe(d);
  });
});

// ──────────────────────────────────────────────
// shallowCamelToSnake
// ──────────────────────────────────────────────
describe('shallowCamelToSnake', () => {
  it('应只转换第一层键名', () => {
    const input = { userName: 'Bob', homeAddress: { cityName: 'Beijing' } };
    const result = shallowCamelToSnake(input);
    expect(result.user_name).toBe('Bob');
    // 嵌套对象不转换
    expect(result.home_address).toEqual({ cityName: 'Beijing' });
  });

  it('null / undefined / 基本类型应直接返回', () => {
    expect(shallowCamelToSnake(null)).toBeNull();
    expect(shallowCamelToSnake(42)).toBe(42);
  });

  it('Date 对象应直接返回', () => {
    const d = new Date();
    expect(shallowCamelToSnake(d)).toBe(d);
  });
});
