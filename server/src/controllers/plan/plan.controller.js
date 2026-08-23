import { prisma } from '../../lib/prisma.js';
import { success, fail } from '../../utils/response.js';
import { NotFoundError, ValidationError } from '../../utils/error.js';
import { createAuditLog } from '../../services/audit.service.js';
import { autoFixSortOrder, invalidateSortOrderCache } from '../../utils/sort.js';
import {
  findBestMatchPlan,
  isClassMatchPlan,
  NOT_ARCHIVED_PLAN_WHERE,
} from '../../services/plan.service.js';

/**
 * 解析适用入学年份参数：空值（null/''/undefined）返回 null 表示不限，
 * 非法整数/越界抛 ValidationError
 * @param {*} value - 请求体中的年份参数
 * @returns {number|null} 合法年份或 null（不限）
 */
function parseApplyYear(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new ValidationError('适用入学年份必须为 2000~2100 的整数');
  }
  return n;
}

/**
 * 校验适用年份区间合法性（起 <= 止）
 */
function validateApplyYearRange(fromYear, toYear) {
  if (fromYear != null && toYear != null && fromYear > toYear) {
    throw new ValidationError('适用入学年份起不能大于止');
  }
}

/** 方案状态合法取值（与路由层 validatePlan/validatePlanCreate 的 isIn 白名单一致） */
const PLAN_STATUSES = ['draft', 'active', 'archived'];

/**
 * 控制器层 status 白名单兜底校验（纵深防御）：
 * 路由中间件已做 isIn 校验，但控制器可被绕过中间件的调用路径复用；
 * 所有归档拦截均为负逻辑（status != 'archived'），非法值一旦落库会静默参与全部业务匹配。
 * @param {*} status - 请求体中的状态值（undefined 表示未传，跳过校验）
 */
function assertValidPlanStatus(status) {
  if (status !== undefined && !PLAN_STATUSES.includes(status)) {
    throw new ValidationError('方案状态必须是 draft、active 或 archived');
  }
}

/**
 * 同维度（同专业或同层次）适用入学年份重叠校验：
 * 保证同一专业/层次下任意入学年份最多命中一个方案，匹配结果唯一确定。
 * null 端视为无穷；存量方案两端皆 null 时视为覆盖所有年份。
 * 归档方案已退出业务匹配，不参与重叠校验（支持「归档旧方案 → 同届新建」操作流）；
 * 草稿与生效方案均参与匹配，仍互相约束以保证唯一性。
 * @param {object} opts
 * @param {number|null} opts.majorId - 专业维度（与 trainingLevelId 二选一）
 * @param {number|null} opts.trainingLevelId - 层次维度
 * @param {number|null} opts.applyFromYear - 待校验区间起
 * @param {number|null} opts.applyToYear - 待校验区间止
 * @param {number|null} [opts.excludeId] - 排除的方案 ID（更新时排除自身）
 */
async function assertNoApplyYearOverlap({
  majorId,
  trainingLevelId,
  applyFromYear,
  applyToYear,
  excludeId = null,
}) {
  const where = majorId ? { major_id: majorId } : { training_level_id: trainingLevelId };
  // 归档方案不再占用适用年份区间（与业务匹配口径一致）
  where.status = NOT_ARCHIVED_PLAN_WHERE.status;
  if (excludeId != null) where.id = { not: excludeId };
  const others = await prisma.training_plans.findMany({
    where,
    select: { id: true, name: true, apply_from_year: true, apply_to_year: true },
  });
  for (const other of others) {
    // 区间相交判定：不相交当且仅当 a止 < b起 或 b止 < a起（null 端视为无穷）
    const disjoint =
      (applyToYear != null && other.apply_from_year != null && applyToYear < other.apply_from_year) ||
      (other.apply_to_year != null && applyFromYear != null && other.apply_to_year < applyFromYear);
    if (!disjoint) {
      throw new ValidationError(
        `适用入学年份与已有方案「${other.name}」重叠，请先调整其适用年份范围后再保存`
      );
    }
  }
}

/**
 * 从源版本号递增主版本号（派生新版本时的默认版本号）
 * 规则：首个数字段为主版本号，+1；若存在次版本号（.x）则归零。
 * 示例："V1.0" → "V2.0"；"V1.2" → "V2.0"；"v3" → "v4"；"2.5" → "3.0"。
 * 无法解析（无数字或为空）时返回原值。
 * @param {string|null|undefined} version - 源方案版本号
 * @returns {string|null} 递增后的版本号；源为空时返回 null
 */
export function incrementVersion(version) {
  if (version == null || String(version).trim() === '') return null;
  const v = String(version);
  const m = v.match(/^(.*?)(\d+)(\.\d+)?(.*)$/);
  if (!m) return v;
  const [, prefix, major, minor, suffix] = m;
  const nextMajor = Number(major) + 1;
  // 保留原有前导零风格（如 "01" → "02"）
  const majorStr =
    major.length > 1 && major.startsWith('0')
      ? String(nextMajor).padStart(major.length, '0')
      : String(nextMajor);
  return `${prefix}${majorStr}${minor ? '.0' : ''}${suffix}`;
}

/**
 * 获取培养方案列表（含班级使用统计）
 */
export async function listPlans(req, res, next) {
  try {
    const { college_id } = req.query;
    const where = {};

    if (college_id) {
      where.college_id = Number(college_id);
    }

    await autoFixSortOrder('training_plans');
    const plans = await prisma.training_plans.findMany({
      where,
      include: {
        majors: { select: { id: true, name: true } },
        colleges: { select: { id: true, name: true } },
        training_levels: { select: { id: true, name: true } },
        plan_courses: { select: { id: true } },
      },
      orderBy: { sort_order: 'asc' },
    });

    // 归档方案不作为现行方案：班级匹配统计（使用班级/匹配班级数）应将其视为无方案
    const effectivePlans = plans.filter((p) => p.status !== 'archived');
    const effectivePlanMap = new Map(effectivePlans.map((p) => [p.id, p]));

    const allClasses = await prisma.classes.findMany({
      where: { is_left_school: false },
      select: {
        id: true,
        major_id: true,
        training_level_id: true,
        custom_plan_id: true,
        // 供 findBestMatchPlan/isClassMatchPlan 按方案适用入学年份范围过滤
        enrollment_year: true,
      },
    });

    const classCountMap = {};
    const customLinkedCountMap = {};
    const matchedCountMap = {};
    plans.forEach((p) => {
      classCountMap[p.id] = 0;
      customLinkedCountMap[p.id] = 0;
      matchedCountMap[p.id] = 0;
    });

    // S-05 修复：使用 findBestMatchPlan 优先级语义（自定义>专业>层次），
    // 每个班级只计入其最佳匹配方案，避免同一班级被重复计入多个方案
    // 构建自定义方案的快速查找 Map：归档方案不在候选内（与排课/开课口径一致）
    const customPlanMap = new Map();
    for (const cls of allClasses) {
      if (cls.custom_plan_id) {
        customPlanMap.set(cls.id, effectivePlanMap.get(cls.custom_plan_id) || null);
      }
    }
    // 候选方案列表：包含有专业/层次的方案 + 被 custom_plan_id 引用的方案（均为非归档）
    const referencedCustomPlanIds = new Set(
      allClasses.filter((c) => c.custom_plan_id).map((c) => c.custom_plan_id)
    );
    const candidatePlans = effectivePlans.filter(
      (p) => p.major_id || p.training_level_id || referencedCustomPlanIds.has(p.id)
    );

    for (const cls of allClasses) {
      // classCount：最佳匹配（用于"使用班级"列展示）
      const bestPlan = findBestMatchPlan(cls, candidatePlans, customPlanMap);
      if (bestPlan && classCountMap[bestPlan.id] !== undefined) {
        classCountMap[bestPlan.id]++;
      }
      // customLinkedClassCount：仅 custom_plan_id === plan.id 的班级数。
      // deletePlan 在事务中显式将这些班级的 custom_plan_id 置 null，
      // 让班级回归未关联状态——这才是删除时真正会被"解除关联"的班级。
      if (cls.custom_plan_id && customLinkedCountMap[cls.custom_plan_id] !== undefined) {
        customLinkedCountMap[cls.custom_plan_id]++;
      }
      // matchedClassCount：通过 isClassMatchPlan 任意匹配的班级数（含 major/level 匹配，
      // 也含 custom 匹配）。删除方案后这些班级将不再匹配此方案。
      // 注意：deletePlan 从不调用 isClassMatchPlan、也从不真正阻塞删除，
      // 此字段仅用于前端删除弹窗准确预告"删除后将丢失匹配的班级数"。
      // 归档方案不参与匹配计数（视为无方案）。
      for (const plan of effectivePlans) {
        if (isClassMatchPlan(cls, plan)) {
          if (matchedCountMap[plan.id] !== undefined) matchedCountMap[plan.id]++;
        }
      }
    }

    const plansWithCount = plans.map((plan) => {
      const customLinked = customLinkedCountMap[plan.id] || 0;
      return {
        ...plan,
        courseCount: plan.plan_courses.length,
        classCount: classCountMap[plan.id] || 0,
        // 删除时实际会被解除关联（custom_plan_id 置 null）的班级数
        customLinkedClassCount: customLinked,
        // 通过任意匹配（含 major/level 匹配）的班级数，删除后将丢失匹配
        matchedClassCount: matchedCountMap[plan.id] || 0,
        // 向后兼容：保留旧字段，值同 customLinkedClassCount。
        // deletePlan 从不真正阻塞删除流程，旧字段名保留以避免前端立即崩溃。
        blockingClassCount: customLinked,
      };
    });

    success(res, plansWithCount);
  } catch (e) {
    next(e);
  }
}

/**
 * 获取单个培养方案详情
 */
export async function getPlanById(req, res, next) {
  try {
    const { id } = req.params;

    const plan = await prisma.training_plans.findUnique({
      where: { id: Number(id) },
      include: {
        majors: { select: { id: true, name: true } },
        colleges: { select: { id: true, name: true } },
        training_levels: { select: { id: true, name: true } },
        plan_courses: { select: { id: true } },
      },
    });

    if (!plan) {
      return fail(res, '培养方案不存在', 404);
    }

    success(res, plan);
  } catch (e) {
    next(e);
  }
}

/**
 * 创建培养方案
 */
export async function createPlan(req, res, next) {
  try {
    const {
      name,
      college_id,
      major_id,
      training_level_id,
      version,
      description,
      status,
      apply_from_year,
      apply_to_year,
    } = req.body;
    if (!name) throw new ValidationError('方案名称为必填项');
    assertValidPlanStatus(status);

    if (major_id && training_level_id) {
      throw new ValidationError('专业类别和培养层次只能选择一项');
    }
    if (!major_id && !training_level_id) {
      throw new ValidationError('请选择专业类别或培养层次');
    }

    // 适用入学年份：解析 + 区间合法性 + 同维度重叠校验
    const applyFromYear = parseApplyYear(apply_from_year);
    const applyToYear = parseApplyYear(apply_to_year);
    validateApplyYearRange(applyFromYear, applyToYear);
    await assertNoApplyYearOverlap({
      majorId: major_id ? Number(major_id) : null,
      trainingLevelId: training_level_id ? Number(training_level_id) : null,
      applyFromYear,
      applyToYear,
    });

    const maxSortOrder = await prisma.training_plans.aggregate({
      _max: { sort_order: true },
    });
    const newSortOrder = (maxSortOrder._max.sort_order || 0) + 1;

    const plan = await prisma.training_plans.create({
      data: {
        name,
        college_id: college_id ? Number(college_id) : null,
        major_id: major_id ? Number(major_id) : null,
        training_level_id: training_level_id ? Number(training_level_id) : null,
        version,
        description,
        apply_from_year: applyFromYear,
        apply_to_year: applyToYear,
        status: status || 'draft',
        sort_order: newSortOrder,
      },
      include: {
        majors: true,
        colleges: true,
        training_levels: true,
      },
    });

    const logDetails = {
      id: plan.id,
      name: plan.name,
      colleges: plan.colleges?.name || '未设置',
      majors: plan.majors?.name || '未设置',
      training_levels: plan.training_levels?.name || '未设置',
      version: plan.version,
      apply_from_year: plan.apply_from_year,
      apply_to_year: plan.apply_to_year,
    };

    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      details: logDetails,
      message: `创建培养方案：${plan.name}${plan.colleges?.name ? `（使用部门：${plan.colleges.name}）` : ''}`,
    });

    invalidateSortOrderCache('training_plans');
    success(res, plan, '创建成功');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'create',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * 更新培养方案
 */
export async function updatePlan(req, res, next) {
  try {
    const { id } = req.params;
    const {
      name,
      college_id,
      major_id,
      training_level_id,
      version,
      description,
      sort_order,
      status,
      apply_from_year,
      apply_to_year,
    } = req.body;

    // status 白名单兜底：覆盖下方「排序交换 / 仅状态快捷 / 完整更新」三条分支
    assertValidPlanStatus(status);

    // 排序交换：仅更新 sort_order
    if (sort_order !== undefined && name === undefined) {
      try {
        const plan = await prisma.training_plans.update({
          where: { id: Number(id) },
          data: { sort_order: Number(sort_order) },
          include: {
            majors: true,
            colleges: true,
            training_levels: true,
          },
        });
        invalidateSortOrderCache('training_plans');
        // BIZ-H1修复：补全 sort_order 交换分支的审计记录
        await createAuditLog({
          action: 'update',
          module: 'trainingPlan',
          userId: req.user?.id,
          ip: req.ip,
          details: { id: Number(id), sort_order: Number(sort_order), type: 'sort_order' },
          result: 'success',
          message: `调整培养方案排序：${plan.name} → ${sort_order}`,
        });
        return success(res, plan, '更新成功');
      } catch (e) {
        if (e.code === 'P2025') {
          await createAuditLog({
            action: 'update',
            module: 'trainingPlan',
            userId: req.user?.id,
            ip: req.ip,
            details: { id: Number(id), sort_order: Number(sort_order), error: 'not_found' },
            result: 'failed',
            message: `调整培养方案排序失败：方案不存在`,
          });
          return fail(res, '培养方案不存在', 404);
        }
        throw e;
      }
    }

    // 状态快捷切换：仅更新 status（列表页状态下拉，跳过表单必填校验）
    if (status !== undefined && name === undefined && sort_order === undefined) {
      try {
        const plan = await prisma.training_plans.update({
          where: { id: Number(id) },
          data: { status },
          include: {
            majors: true,
            colleges: true,
            training_levels: true,
          },
        });
        await createAuditLog({
          action: 'update',
          module: 'trainingPlan',
          userId: req.user?.id,
          ip: req.ip,
          details: { id: Number(id), status, type: 'status' },
          result: 'success',
          message: `切换培养方案状态：${plan.name} → ${status}`,
        });
        return success(res, plan, '更新成功');
      } catch (e) {
        if (e.code === 'P2025') {
          await createAuditLog({
            action: 'update',
            module: 'trainingPlan',
            userId: req.user?.id,
            ip: req.ip,
            details: { id: Number(id), status, error: 'not_found' },
            result: 'failed',
            message: `切换培养方案状态失败：方案不存在`,
          });
          return fail(res, '培养方案不存在', 404);
        }
        throw e;
      }
    }

    if (major_id && training_level_id) {
      return fail(res, '专业类别和培养层次只能选择一项');
    }
    if (!major_id && !training_level_id) {
      return fail(res, '请选择专业类别或培养层次');
    }

    // 提前读取旧值：apply 字段未传（undefined）时保持现值，传 null/'' 时清空
    const oldPlan = await prisma.training_plans.findUnique({
      where: { id: Number(id) },
      include: { colleges: true },
    });
    if (!oldPlan) return fail(res, '方案不存在', 404);

    // 适用入学年份：解析 + 区间合法性 + 同维度重叠校验（排除自身）
    const applyFromYear =
      apply_from_year === undefined ? oldPlan.apply_from_year : parseApplyYear(apply_from_year);
    const applyToYear =
      apply_to_year === undefined ? oldPlan.apply_to_year : parseApplyYear(apply_to_year);
    validateApplyYearRange(applyFromYear, applyToYear);
    await assertNoApplyYearOverlap({
      majorId: major_id ? Number(major_id) : null,
      trainingLevelId: training_level_id ? Number(training_level_id) : null,
      applyFromYear,
      applyToYear,
      excludeId: Number(id),
    });

    const updateData = {
      name,
      college_id: college_id ? Number(college_id) : null,
      major_id: major_id ? Number(major_id) : null,
      training_level_id: training_level_id ? Number(training_level_id) : null,
      version,
      description,
      apply_from_year: applyFromYear,
      apply_to_year: applyToYear,
    };

    if (status !== undefined) {
      updateData.status = status;
    }

    if (sort_order !== undefined) {
      updateData.sort_order = Number(sort_order);
    }

    try {
      const plan = await prisma.training_plans.update({
        where: { id: Number(id) },
        data: updateData,
        include: {
          majors: true,
          colleges: true,
          training_levels: true,
        },
      });

      const changes = {
        id: plan.id,
        name: plan.name,
      };

      if (oldPlan?.college_id !== plan.college_id) {
        changes.collegeChange = {
          from: oldPlan?.colleges?.name || '未设置',
          to: plan.colleges?.name || '未设置',
        };
      }

      await createAuditLog({
        module: 'trainingPlan',
        action: 'update',
        userId: req.user?.id,
        ip: req.ip,
        result: 'success',
        details: changes,
        message: `更新培养方案：${plan.name}${plan.colleges?.name ? `（使用部门：${plan.colleges.name}）` : ''}`,
      });

      invalidateSortOrderCache('training_plans');
      success(res, plan, '更新成功');
    } catch (e) {
      if (e.code === 'P2025') return fail(res, '方案不存在', 404);
      throw e;
    }
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'update',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * 删除培养方案
 *
 * 行为变更（应需求）：已关联班级的方案允许删除。
 * - custom_plan_id 直接引用的班级：在事务中显式置 null，让班级回归未关联状态
 * - 按专业/层次匹配的班级：删除方案后自然不再匹配该方案（班级自身的 major_id/
 *   training_level_id 是班级属性，保持不变，不视为"关联"）
 * - 级联清理：plan_courses / plan_course_semesters / plan_textbooks 通过 schema
 *   onDelete: Cascade 自动级联删除
 */
export async function deletePlan(req, res, next) {
  try {
    const { id } = req.params;
    const planId = Number(id);

    const plan = await prisma.training_plans.findUnique({
      where: { id: planId },
      select: { id: true, name: true, major_id: true, training_level_id: true },
    });
    if (!plan) throw new NotFoundError('培养方案');

    // 预先统计将被级联删除的子记录（用于审计日志，P2-3）
    // schema: plan_courses → plan_course_semesters → plan_textbooks（均 onDelete: Cascade）
    const [cascadeCourseCount, cascadeSemesterCount, cascadeTextbookCount] = await Promise.all([
      prisma.plan_courses.count({ where: { plan_id: planId } }),
      prisma.plan_course_semesters.count({
        where: { plan_courses: { plan_id: planId } },
      }),
      prisma.plan_textbooks.count({
        where: { plan_course_semesters: { plan_courses: { plan_id: planId } } },
      }),
    ]);

    try {
      // P2-7: 将解除关联操作移入事务内，并直接读取 updateMany 返回的 count 作为审计依据，
      // 避免原 findMany 在事务外读取导致的竞态（统计与实际解除数不一致）
      let unlinkedCount = 0;
      await prisma.$transaction(async (tx) => {
        // 1. 解除 custom_plan_id 直接引用，让班级回归未关联状态
        const unlinkResult = await tx.classes.updateMany({
          where: { custom_plan_id: planId },
          data: { custom_plan_id: null },
        });
        unlinkedCount = unlinkResult.count;
        // 2. 删除方案；plan_courses/plan_course_semesters/plan_textbooks 级联删除
        await tx.training_plans.delete({ where: { id: planId } });
      });

      await createAuditLog({
        module: 'trainingPlan',
        action: 'delete',
        userId: req.user?.id,
        ip: req.ip,
        result: 'success',
        details: {
          plan_id: planId,
          plan_name: plan.name,
          unlinked_count: unlinkedCount,
          // 级联删除的子记录数量（schema onDelete: Cascade 自动执行）
          cascaded_plan_courses: cascadeCourseCount,
          cascaded_plan_course_semesters: cascadeSemesterCount,
          cascaded_plan_textbooks: cascadeTextbookCount,
        },
        message: `删除培养方案：${plan.name}${unlinkedCount > 0 ? `（同时解除 ${unlinkedCount} 个班级关联）` : ''}`,
      });

      invalidateSortOrderCache('training_plans');
      success(res, null, '删除成功');
    } catch (e) {
      if (e.code === 'P2025') throw new NotFoundError('培养方案');
      throw e;
    }
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'delete',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      details: { error: e.message },
    });
    next(e);
  }
}

/**
 * 从现有方案派生新版本（POST /api/plans/:id/new-version）
 *
 * 场景：同一专业/层次的培养方案修订后，新年级使用新版本（如 2025 级用 V1.0、2026 级用 V2.0）。
 * 行为（单事务）：
 * 1. 校验新版本起始入学年份与同维度其他方案不重叠；
 * 2. 默认同步收窄源方案 apply_to_year = applyFromYear - 1（可通过 update_source_end_year=false 关闭）；
 * 3. 复制源方案基本信息与全部 plan_courses → plan_course_semesters → plan_textbooks；
 * 4. 新方案状态为 draft，待管理员确认课程差异后自行启用。
 */
export async function createPlanNewVersion(req, res, next) {
  try {
    const sourceId = Number(req.params.id);
    // naming 中间件已将 camelCase 转 snake_case
    const { name, version, apply_from_year, update_source_end_year } = req.body;

    const applyFromYear = parseApplyYear(apply_from_year);
    if (applyFromYear == null) {
      throw new ValidationError('请填写新版本适用起始入学年份');
    }
    const updateSourceEndYear = update_source_end_year !== false; // 默认收窄

    const source = await prisma.training_plans.findUnique({
      where: { id: sourceId },
      include: {
        plan_courses: {
          include: {
            plan_course_semesters: { include: { plan_textbooks: true } },
          },
        },
      },
    });
    if (!source) throw new NotFoundError('培养方案');

    // 新版本区间 [applyFromYear, +∞)，源方案是否与之重叠（源止年为 null 或 >= 起始年）
    const sourceOverlaps = source.apply_to_year == null || source.apply_to_year >= applyFromYear;
    // 源方案可被收窄的前提：收窄后区间不倒挂（源起年 <= 新起始年-1）
    const canNarrowSource = source.apply_from_year == null || source.apply_from_year <= applyFromYear - 1;

    if (!updateSourceEndYear) {
      // 不收窄源方案时，源方案也纳入重叠校验
      if (sourceOverlaps) {
        throw new ValidationError(
          `源方案「${source.name}」适用年份覆盖 ${applyFromYear} 年，请勾选同步收窄旧方案适用止年`
        );
      }
    } else if (sourceOverlaps && !canNarrowSource) {
      throw new ValidationError(
        `源方案「${source.name}」适用起始年份晚于新版本起始年份，无法自动收窄，请手工调整`
      );
    }

    // 与同维度其他方案的重叠校验（收窄场景下排除源方案自身）
    await assertNoApplyYearOverlap({
      majorId: source.major_id,
      trainingLevelId: source.training_level_id,
      applyFromYear,
      applyToYear: null,
      excludeId: updateSourceEndYear ? sourceId : null,
    });

    const newName = (name || `${source.name}（新版本）`).slice(0, 200);

    // 与 createPlan 一致：取全局最大 sort_order + 1，避免继承源方案导致排序值重复
    const maxSortOrder = await prisma.training_plans.aggregate({
      _max: { sort_order: true },
    });
    const newSortOrder = (maxSortOrder._max.sort_order || 0) + 1;

    const newPlan = await prisma.$transaction(async (tx) => {
      // 1. 收窄源方案适用止年（仅当源区间覆盖新起始年时）
      if (updateSourceEndYear && sourceOverlaps && canNarrowSource) {
        await tx.training_plans.update({
          where: { id: sourceId },
          data: { apply_to_year: applyFromYear - 1 },
        });
      }

      // 2. 复制方案基本信息（关联维度继承，适用起始年 = 新版本起始年）
      const created = await tx.training_plans.create({
        data: {
          name: newName,
          college_id: source.college_id,
          major_id: source.major_id,
          training_level_id: source.training_level_id,
          version:
            version !== undefined && String(version).trim() !== ''
              ? String(version).trim()
              : incrementVersion(source.version),
          description: source.description,
          apply_from_year: applyFromYear,
          apply_to_year: null,
          status: 'draft',
          sort_order: newSortOrder,
        },
      });

      // 3. 深拷贝课程 → 学期明细 → 教材关联
      for (const pc of source.plan_courses) {
        const newPc = await tx.plan_courses.create({
          data: {
            plan_id: created.id,
            course_id: pc.course_id,
            start_semester: pc.start_semester,
            end_semester: pc.end_semester,
            weekly_hours: pc.weekly_hours,
            weeks_per_semester: pc.weeks_per_semester,
            // 继承源课程的启用状态（禁用课程派生后仍保持禁用）
            is_active: pc.is_active,
            sort_order: pc.sort_order,
          },
        });
        for (const sem of pc.plan_course_semesters) {
          const newSem = await tx.plan_course_semesters.create({
            data: {
              plan_course_id: newPc.id,
              semester: sem.semester,
              weekly_hours: sem.weekly_hours,
              weeks_count: sem.weeks_count,
            },
          });
          for (const tb of sem.plan_textbooks) {
            await tx.plan_textbooks.create({
              data: {
                semester_id: newSem.id,
                textbook_id: tb.textbook_id,
                is_required: tb.is_required,
              },
            });
          }
        }
      }

      return created;
    });

    await createAuditLog({
      module: 'trainingPlan',
      action: 'createVersion',
      userId: req.user?.id,
      ip: req.ip,
      result: 'success',
      details: {
        source_id: sourceId,
        source_name: source.name,
        new_id: newPlan.id,
        new_name: newPlan.name,
        apply_from_year: applyFromYear,
        source_end_year_narrowed: updateSourceEndYear && sourceOverlaps && canNarrowSource,
      },
      message: `派生培养方案新版本：${source.name} → ${newPlan.name}（自 ${applyFromYear} 级起适用）`,
    });

    invalidateSortOrderCache('training_plans');
    success(res, newPlan, '新版本创建成功');
  } catch (e) {
    await createAuditLog({
      module: 'trainingPlan',
      action: 'createVersion',
      userId: req.user?.id,
      ip: req.ip,
      result: 'failed',
      details: { source_id: Number(req.params.id), error: e.message },
    });
    next(e);
  }
}
