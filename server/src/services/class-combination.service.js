import { prisma } from '../lib/prisma.js';
import { log } from '../utils/logger.js';

/**
 * 合班教学服务：管理合班组（class_combinations）的创建、解散、查询。
 *
 * 设计要点：
 * - 同 combination_id 的班级共享一套合班关系，combination_id 为空表示不合班。
 * - 业务约定合班伙伴须同学院，由调用方在传入前校验（见 applyCombination）。
 * - 班级删除/离校后，若所属组合仅剩 ≤1 个班级，自动解散该组合（见 cleanupCombination）。
 */

/**
 * 校验候选班级列表是否全部同学院（合班业务约束）。
 * BIZ-M4修复：增加事务客户端参数 txClient，避免 TOCTOU——并发场景下校验通过后
 * 伙伴班级学院可能被另一事务修改，导致合班伙伴最终不同学院。
 * 优先使用传入的事务客户端查询；若未传入则降级使用全局 prisma（向后兼容）。
 * @param {number[]} classIds - 班级 ID 列表（不含当前班级自身）
 * @param {number} collegeId - 当前班级所属学院 ID
 * @param {object} [txClient] - Prisma 事务客户端（推荐传入）
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
export async function validateSameCollege(classIds, collegeId, txClient) {
  if (!Array.isArray(classIds) || classIds.length === 0) return { ok: true };
  if (!collegeId) {
    return { ok: false, message: '当前班级未设置学院，无法添加合班伙伴' };
  }
  const client = txClient || prisma;
  const classes = await client.classes.findMany({
    where: { id: { in: classIds } },
    select: { id: true, name: true, college_id: true },
  });
  if (classes.length !== classIds.length) {
    return { ok: false, message: '部分合班伙伴班级不存在' };
  }
  const diff = classes.filter((c) => c.college_id !== collegeId);
  if (diff.length > 0) {
    const names = diff.map((c) => c.name).join('、');
    return { ok: false, message: `合班伙伴必须同学院，以下班级不一致：${names}` };
  }
  return { ok: true };
}

/**
 * 为班级应用合班关系。
 *
 * 规则：
 * - partnerClassIds 为空数组 → 解除该班级合班关系（combination_id 置 null），
 *   并清理原组合（若剩余班级 ≤1 则解散组合记录）。
 * - partnerClassIds 非空 → 将当前班级与这些班级合并到同一组合：
 *   1. 若当前班级已有组合，复用之；否则新建组合。
 *   2. 将 partnerClassIds 中的班级 combination_id 设为同一组合。
 *   3. 若伙伴班级原本属于其他组合，需将其从原组合迁移过来（原组合剩余 ≤1 则解散）。
 *
 * 必须在事务中调用。
 *
 * @param {object} tx - Prisma 事务客户端
 * @param {number} classId - 当前班级 ID
 * @param {number[]|null|undefined} partnerClassIds - 合班伙伴班级 ID 列表
 * @param {number|null} currentCollegeId - 当前班级学院 ID（用于同学院校验）
 * @returns {Promise<{combinationId: number|null, dissolvedCombinationIds: number[]}>}
 */
export async function applyCombination(tx, classId, partnerClassIds, currentCollegeId) {
  const currentClass = await tx.classes.findUnique({
    where: { id: classId },
    select: { id: true, combination_id: true, college_id: true },
  });
  if (!currentClass) {
    throw new Error(`班级 ${classId} 不存在，无法设置合班关系`);
  }

  const oldCombinationId = currentClass.combination_id;
  const dissolvedCombinationIds = [];

  // 无伙伴 → 解除合班
  if (!partnerClassIds || partnerClassIds.length === 0) {
    if (oldCombinationId != null) {
      await tx.classes.update({
        where: { id: classId },
        data: { combination_id: null },
      });
      const dissolved = await cleanupCombination(tx, oldCombinationId, [classId]);
      if (dissolved) dissolvedCombinationIds.push(oldCombinationId);
    }
    return { combinationId: null, dissolvedCombinationIds };
  }

  // 同学院校验（使用当前班级学院 ID）
  // BIZ-M4修复：传入事务客户端 tx，确保校验在事务内读取，避免 TOCTOU
  const collegeId = currentCollegeId != null ? currentCollegeId : currentClass.college_id;
  const validation = await validateSameCollege(partnerClassIds, collegeId, tx);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  // 去重并排除自身
  const uniquePartnerIds = [...new Set(partnerClassIds.map(Number))].filter((id) => id !== classId);
  if (uniquePartnerIds.length === 0) {
    // 传了自身以外的空集 → 解除
    if (oldCombinationId != null) {
      await tx.classes.update({
        where: { id: classId },
        data: { combination_id: null },
      });
      const dissolved = await cleanupCombination(tx, oldCombinationId, [classId]);
      if (dissolved) dissolvedCombinationIds.push(oldCombinationId);
    }
    return { combinationId: null, dissolvedCombinationIds };
  }

  // 查询伙伴班级当前所属组合
  const partners = await tx.classes.findMany({
    where: { id: { in: uniquePartnerIds } },
    select: { id: true, combination_id: true },
  });

  // 决定目标组合 ID：优先复用当前班级已有组合，否则新建
  let targetCombinationId = oldCombinationId;
  if (targetCombinationId == null) {
    // 若伙伴中已有组合，复用其中任意一个
    const partnerWithCombination = partners.find((p) => p.combination_id != null);
    if (partnerWithCombination) {
      targetCombinationId = partnerWithCombination.combination_id;
    } else {
      const created = await tx.class_combinations.create({ data: {} });
      targetCombinationId = created.id;
    }
  }

  // 收集需要清理的旧组合（伙伴从原组合迁移后，原组合可能剩 ≤1 班）
  const oldPartnerCombinationIds = new Set();
  for (const p of partners) {
    if (p.combination_id != null && p.combination_id !== targetCombinationId) {
      oldPartnerCombinationIds.add(p.combination_id);
    }
  }

  // 将当前班级 + 所有伙伴统一指向目标组合
  const allClassIds = [classId, ...uniquePartnerIds];
  await tx.classes.updateMany({
    where: { id: { in: allClassIds } },
    data: { combination_id: targetCombinationId },
  });

  // 清理旧组合（迁移后的原组合若剩余 ≤1 班则解散）
  for (const oldId of oldPartnerCombinationIds) {
    const dissolved = await cleanupCombination(tx, oldId, allClassIds);
    if (dissolved) dissolvedCombinationIds.push(oldId);
  }

  return { combinationId: targetCombinationId, dissolvedCombinationIds };
}

/**
 * 清理组合：当组合内剩余有效班级 ≤1 时，解散该组合记录，并将剩余班级的 combination_id 置 null。
 *
 * @param {object} tx - Prisma 事务客户端
 * @param {number} combinationId - 组合 ID
 * @param {number[]} justRemovedClassIds - 刚刚移出此组合的班级 ID（用于排除后统计剩余）
 * @returns {Promise<boolean>} 是否已解散
 */
export async function cleanupCombination(tx, combinationId, justRemovedClassIds = []) {
  if (combinationId == null) return false;

  const remaining = await tx.classes.count({
    where: {
      combination_id: combinationId,
      id: { notIn: justRemovedClassIds },
    },
  });

  // 剩余 ≤1 个班级，组合无意义，解散
  if (remaining <= 1) {
    // 先把剩余班级的 combination_id 置空
    if (remaining === 1) {
      await tx.classes.updateMany({
        where: { combination_id: combinationId },
        data: { combination_id: null },
      });
    }
    await tx.class_combinations.delete({ where: { id: combinationId } }).catch((e) => {
      // 组合可能已被并发删除，忽略
      if (e.code !== 'P2025') throw e;
    });
    return true;
  }
  return false;
}

/**
 * 构建全局合班组号映射：现存合班组按 id 升序密集编号 1..N。
 * 解散的组合记录已从表中删除，不参与编号；组合解散会导致后续组号前移（可接受）。
 * 各列表接口共用同一映射，保证同一合班组在班级列表/教学安排等页面编号一致。
 *
 * @returns {Promise<Map<number, number>>} key=combinationId, value=组号（从 1 开始）
 */
export async function buildCombinationNoMap() {
  const map = new Map();
  const rows = await prisma.class_combinations.findMany({
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  rows.forEach((r, i) => map.set(r.id, i + 1));
  return map;
}

/**
 * 批量查询多个组合的成员班级名称映射，供列表展示用。
 *
 * @param {number[]} combinationIds - 组合 ID 列表（去重）
 * @returns {Promise<Map<number, Array<{id: number, name: string}>>>}
 *   key=combinationId, value=成员班级列表（含所有成员，调用方按需排除自身）
 */
export async function buildCombinationMemberMap(combinationIds) {
  const map = new Map();
  if (!combinationIds || combinationIds.length === 0) return map;

  const uniqueIds = [...new Set(combinationIds.filter((id) => id != null))];
  if (uniqueIds.length === 0) return map;

  const classes = await prisma.classes.findMany({
    where: { combination_id: { in: uniqueIds } },
    select: { id: true, name: true, combination_id: true },
    orderBy: { id: 'asc' },
  });

  for (const c of classes) {
    if (c.combination_id == null) continue;
    if (!map.has(c.combination_id)) map.set(c.combination_id, []);
    map.get(c.combination_id).push({ id: c.id, name: c.name });
  }
  return map;
}

/**
 * 获取指定班级的合班伙伴名称列表（不含自身）。
 *
 * @param {number} classId - 班级 ID
 * @param {number|null} combinationId - 组合 ID（若已知可传入避免查询）
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function getPartnersOfClass(classId, combinationId = null) {
  let combId = combinationId;
  if (combId == null) {
    const cls = await prisma.classes.findUnique({
      where: { id: classId },
      select: { combination_id: true },
    });
    combId = cls?.combination_id;
  }
  if (combId == null) return [];

  const members = await prisma.classes.findMany({
    where: { combination_id: combId, id: { not: classId } },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  return members;
}

/**
 * 拼接合班伙伴名称为字符串，供导出和展示用。
 *
 * @param {Array<{id: number, name: string}>|null} partners - 伙伴列表
 * @returns {string} 如 "A班、B班"，无伙伴返回空串
 */
export function formatPartnerNames(partners) {
  if (!partners || partners.length === 0) return '';
  return partners.map((p) => p.name).join('、');
}

/**
 * 解散班级所属组合（用于班级删除后清理）。
 * 返回被解散的组合 ID（若未解散返回 null）。
 *
 * @param {object} tx - Prisma 事务客户端
 * @param {number} combinationId - 组合 ID
 * @returns {Promise<number|null>}
 */
export async function dissolveAfterClassDeletion(tx, combinationId) {
  if (combinationId == null) return null;
  const dissolved = await cleanupCombination(tx, combinationId, []);
  log.info('班级删除后清理合班组合', { combinationId, dissolved });
  return dissolved ? combinationId : null;
}
