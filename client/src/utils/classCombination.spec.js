/**
 * 合班教学工具函数单元测试
 *
 * 覆盖修复点：
 * - 合班伙伴候选不受数量限制（回归 pageSize=100 截断问题）
 * - 排除已加入其他合班组的班级，现有伙伴豁免保留
 * - 仅保留与当前班级相同培养方案的候选
 * - 新增班级时本地推算匹配方案（与后端 findBestMatchPlan 同语义）
 */
import { describe, it, expect } from 'vitest';
import { filterPartnerCandidates, resolveMatchedPlanId } from './classCombination';

/** 构造候选班级快捷方法 */
function cls(overrides = {}) {
  return {
    id: 1,
    name: '班级',
    collegeId: 10,
    combinationId: null,
    matchedPlanId: null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════
// filterPartnerCandidates
// ════════════════════════════════════════════════
describe('filterPartnerCandidates — 合班伙伴候选过滤', () => {
  it('排除自身与不同学院的班级', () => {
    const classes = [
      cls({ id: 1, name: '自己' }),
      cls({ id: 2, name: '同院', collegeId: 10, matchedPlanId: 5 }),
      cls({ id: 3, name: '外院', collegeId: 99, matchedPlanId: 5 }),
    ];
    const result = filterPartnerCandidates(classes, {
      collegeId: 10,
      currentId: 1,
      currentPlanId: 5,
    });
    expect(result.map((c) => c.name)).toEqual(['同院']);
  });

  it('候选不受数量限制：超过 100 条同学院候选全部保留（回归截断修复）', () => {
    const classes = Array.from({ length: 150 }, (_, i) =>
      cls({ id: i + 1, name: `班级${i + 1}`, matchedPlanId: 5 })
    );
    const result = filterPartnerCandidates(classes, {
      collegeId: 10,
      currentId: null,
      currentPlanId: 5,
    });
    expect(result).toHaveLength(150);
  });

  it('排除已加入其他合班组的班级', () => {
    const classes = [
      cls({ id: 2, name: '未合班', matchedPlanId: 5 }),
      cls({ id: 3, name: '已在他组', combinationId: 88, matchedPlanId: 5 }),
    ];
    const result = filterPartnerCandidates(classes, {
      collegeId: 10,
      currentId: 1,
      currentCombinationId: null,
      currentPlanId: 5,
    });
    expect(result.map((c) => c.name)).toEqual(['未合班']);
  });

  it('现有伙伴（同合班组）保留，即使方案不同或为空（豁免规则）', () => {
    const classes = [
      cls({ id: 2, name: '伙伴-同方案', combinationId: 7, matchedPlanId: 5 }),
      cls({ id: 3, name: '伙伴-异方案', combinationId: 7, matchedPlanId: 6 }),
      cls({ id: 4, name: '伙伴-无方案', combinationId: 7, matchedPlanId: null }),
    ];
    const result = filterPartnerCandidates(classes, {
      collegeId: 10,
      currentId: 1,
      currentCombinationId: 7,
      currentPlanId: 5,
    });
    // 三个伙伴均保留（不依赖排序断言完整性）
    expect(result).toHaveLength(3);
    expect(new Set(result.map((c) => c.id))).toEqual(new Set([2, 3, 4]));
  });

  it('同方案过滤：仅保留 matchedPlanId 与当前一致的候选', () => {
    const classes = [
      cls({ id: 2, name: '同方案', matchedPlanId: 5 }),
      cls({ id: 3, name: '异方案', matchedPlanId: 6 }),
      cls({ id: 4, name: '无方案', matchedPlanId: null }),
    ];
    const result = filterPartnerCandidates(classes, {
      collegeId: 10,
      currentId: 1,
      currentPlanId: 5,
    });
    expect(result.map((c) => c.name)).toEqual(['同方案']);
  });

  it('当前班级无匹配方案：新候选为空，现有伙伴仍保留', () => {
    const classes = [
      cls({ id: 2, name: '普通候选', matchedPlanId: 5 }),
      cls({ id: 3, name: '现有伙伴', combinationId: 7, matchedPlanId: 5 }),
    ];
    const result = filterPartnerCandidates(classes, {
      collegeId: 10,
      currentId: 1,
      currentCombinationId: 7,
      currentPlanId: null,
    });
    expect(result.map((c) => c.name)).toEqual(['现有伙伴']);
  });

  it('结果按班级名称排序', () => {
    const classes = [
      cls({ id: 2, name: 'C班', matchedPlanId: 5 }),
      cls({ id: 3, name: 'A班', matchedPlanId: 5 }),
      cls({ id: 4, name: 'B班', matchedPlanId: 5 }),
    ];
    const result = filterPartnerCandidates(classes, { collegeId: 10, currentPlanId: 5 });
    expect(result.map((c) => c.name)).toEqual(['A班', 'B班', 'C班']);
  });

  it('未设置学院 → 直接返回空数组', () => {
    const classes = [cls({ id: 2, matchedPlanId: 5 })];
    expect(filterPartnerCandidates(classes, { collegeId: null, currentPlanId: 5 })).toEqual([]);
  });
});

// ════════════════════════════════════════════════
// resolveMatchedPlanId
// ════════════════════════════════════════════════
describe('resolveMatchedPlanId — 当前班级匹配方案推算', () => {
  const PLANS = [
    { id: 20, majorId: 1, trainingLevelId: null, createdAt: '2026-01-01T00:00:00Z' },
    { id: 30, majorId: null, trainingLevelId: 2, createdAt: '2026-01-02T00:00:00Z' },
  ];

  it('编辑态（form.id 存在）直接透传 matchedPlanId', () => {
    expect(resolveMatchedPlanId({ id: 1, matchedPlanId: 42 }, PLANS)).toBe(42);
    expect(resolveMatchedPlanId({ id: 1, matchedPlanId: null }, PLANS)).toBeNull();
  });

  it('新增态：customPlanId 优先于专业/层次匹配', () => {
    const form = { id: null, customPlanId: 99, majorId: 1, trainingLevelId: 2 };
    expect(resolveMatchedPlanId(form, PLANS)).toBe(99);
  });

  it('新增态：专业匹配优先于层次匹配', () => {
    const form = { id: null, customPlanId: null, majorId: 1, trainingLevelId: 2 };
    expect(resolveMatchedPlanId(form, PLANS)).toBe(20);
  });

  it('新增态：无专业匹配时回退层次匹配', () => {
    const form = { id: null, customPlanId: null, majorId: 99, trainingLevelId: 2 };
    expect(resolveMatchedPlanId(form, PLANS)).toBe(30);
  });

  it('新增态：同维度多匹配取 createdAt 最新，同秒取 id 大者', () => {
    const majorPlans = [
      { id: 21, majorId: 1, trainingLevelId: null, createdAt: '2026-01-01T00:00:00Z' },
      { id: 22, majorId: 1, trainingLevelId: null, createdAt: '2026-02-01T00:00:00Z' },
      { id: 23, majorId: 1, trainingLevelId: null, createdAt: '2026-02-01T00:00:00Z' },
    ];
    const form = { id: null, customPlanId: null, majorId: 1, trainingLevelId: null };
    // 最新为 22 与 23（同秒），取 id 大者 23
    expect(resolveMatchedPlanId(form, majorPlans)).toBe(23);
  });

  it('新增态：无任何匹配返回 null', () => {
    const form = { id: null, customPlanId: null, majorId: 99, trainingLevelId: 99 };
    expect(resolveMatchedPlanId(form, PLANS)).toBeNull();
  });

  it('入参缺省安全：form/plans 为空不抛错', () => {
    expect(resolveMatchedPlanId(null, PLANS)).toBeNull();
    expect(resolveMatchedPlanId({ id: null, customPlanId: null }, null)).toBeNull();
  });
});

// ════════════════════════════════════════════════
// resolveMatchedPlanId — 适用入学年份范围（镜像后端口径）
// ════════════════════════════════════════════════
describe('resolveMatchedPlanId — 适用入学年份范围', () => {
  // 同层次两个版本：V1.0 止于 2025，V2.0 起于 2026
  const VERSIONED_PLANS = [
    {
      id: 41,
      majorId: null,
      trainingLevelId: 2,
      applyFromYear: null,
      applyToYear: 2025,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 42,
      majorId: null,
      trainingLevelId: 2,
      applyFromYear: 2026,
      applyToYear: null,
      createdAt: '2026-02-01T00:00:00Z',
    },
  ];

  it('2025 级应匹配止年为 2025 的旧版方案', () => {
    const form = {
      id: null,
      customPlanId: null,
      majorId: null,
      trainingLevelId: 2,
      enrollmentYear: 2025,
    };
    expect(resolveMatchedPlanId(form, VERSIONED_PLANS)).toBe(41);
  });

  it('2026 级应匹配起年为 2026 的新版方案（不受 createdAt 最新者胜影响）', () => {
    const form = {
      id: null,
      customPlanId: null,
      majorId: null,
      trainingLevelId: 2,
      enrollmentYear: 2026,
    };
    expect(resolveMatchedPlanId(form, VERSIONED_PLANS)).toBe(42);
  });

  it('2024 级早于新版起年、落在旧版区间内时匹配旧版', () => {
    const form = {
      id: null,
      customPlanId: null,
      majorId: null,
      trainingLevelId: 2,
      enrollmentYear: 2024,
    };
    expect(resolveMatchedPlanId(form, VERSIONED_PLANS)).toBe(41);
  });

  it('customPlanId 显式钉住豁免年份范围校验', () => {
    const form = {
      id: null,
      customPlanId: 41,
      majorId: null,
      trainingLevelId: 2,
      enrollmentYear: 2026,
    };
    expect(resolveMatchedPlanId(form, VERSIONED_PLANS)).toBe(41);
  });

  it('专业维度同样按年份范围过滤', () => {
    const majorPlans = [
      {
        id: 51,
        majorId: 1,
        trainingLevelId: null,
        applyFromYear: null,
        applyToYear: 2025,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 52,
        majorId: 1,
        trainingLevelId: null,
        applyFromYear: 2026,
        applyToYear: null,
        createdAt: '2026-02-01T00:00:00Z',
      },
    ];
    const form2025 = {
      id: null,
      customPlanId: null,
      majorId: 1,
      trainingLevelId: null,
      enrollmentYear: 2025,
    };
    const form2026 = {
      id: null,
      customPlanId: null,
      majorId: 1,
      trainingLevelId: null,
      enrollmentYear: 2026,
    };
    expect(resolveMatchedPlanId(form2025, majorPlans)).toBe(51);
    expect(resolveMatchedPlanId(form2026, majorPlans)).toBe(52);
  });

  it('所有方案年份区间均不覆盖时返回 null', () => {
    const form = {
      id: null,
      customPlanId: null,
      majorId: null,
      trainingLevelId: 2,
      enrollmentYear: 2030,
    };
    const plans = [VERSIONED_PLANS[0]]; // 仅旧版（止 2025）
    expect(resolveMatchedPlanId(form, plans)).toBeNull();
  });

  it('applyFromYear/applyToYear 缺省（undefined/null）视为不限，兼容存量数据', () => {
    const legacyPlans = [
      { id: 61, majorId: null, trainingLevelId: 2, createdAt: '2026-01-01T00:00:00Z' },
    ];
    const form = {
      id: null,
      customPlanId: null,
      majorId: null,
      trainingLevelId: 2,
      enrollmentYear: 2025,
    };
    expect(resolveMatchedPlanId(form, legacyPlans)).toBe(61);
    // form 未填 enrollmentYear 时同样不过滤
    const noYearForm = { id: null, customPlanId: null, majorId: null, trainingLevelId: 2 };
    expect(resolveMatchedPlanId(noYearForm, VERSIONED_PLANS)).toBe(42); // 回退 createdAt 最新
  });
});
