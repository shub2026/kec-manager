/**
 * 合班教学工具函数
 * 从 ClassFormDialog.vue 抽取的合班伙伴候选过滤与方案推算逻辑，保持行为一致并便于单元测试。
 * 口径与后端 findBestMatchPlan 一致：自定义方案 > 专业匹配 > 层次匹配，多匹配取最新创建。
 */

/**
 * 推算当前班级匹配的培养方案 ID（合班伙伴"同方案"过滤依据）。
 * - 编辑态（form.id 存在）：直接透传后端返回的 matchedPlanId
 * - 新增态：后端尚未计算，按同语义本地推算：
 *   自定义方案 > 专业匹配 > 层次匹配；同维度多匹配取 createdAt 最新（同秒取 id 大者）
 * @param {object|null} form - 班级表单（camelCase 字段）
 * @param {Array} plans - 培养方案列表（需含 id/majorId/trainingLevelId/createdAt）
 * @returns {number|null} 匹配方案 ID，无匹配返回 null
 */
export function resolveMatchedPlanId(form, plans) {
  if (!form) return null;
  if (form.id) return form.matchedPlanId ?? null;
  if (form.customPlanId != null) return form.customPlanId;
  const sorted = [...(plans || [])].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return (b.id || 0) - (a.id || 0);
  });
  let majorMatch = null;
  let levelMatch = null;
  for (const p of sorted) {
    if (!majorMatch && p.majorId && p.majorId === form.majorId) majorMatch = p;
    if (!levelMatch && p.trainingLevelId && p.trainingLevelId === form.trainingLevelId) {
      levelMatch = p;
    }
  }
  return majorMatch?.id ?? levelMatch?.id ?? null;
}

/**
 * 过滤合班伙伴候选班级。
 * 规则：
 * - 同学院且排除自身
 * - 已加入"其他"合班组（combinationId 非空且不同于当前组合）的班级排除
 * - 当前班级的现有伙伴（同 combinationId）保留，便于继续查看/移除
 * - 新候选必须与当前班级匹配同一培养方案；currentPlanId 为空时不产生新候选（现有伙伴豁免）
 * - 结果按班级名称排序
 * @param {Array} classes - 全量候选班级（轻量字段：id/name/collegeId/combinationId/matchedPlanId）
 * @param {object} options
 * @param {number|null} options.collegeId - 当前班级学院 ID（为空直接返回 []）
 * @param {number|null} [options.currentId] - 当前班级 ID（排除自身）
 * @param {number|null} [options.currentCombinationId] - 当前班级所属合班组 ID
 * @param {number|null} [options.currentPlanId] - 当前班级匹配的培养方案 ID
 * @returns {Array} 过滤并排序后的候选列表
 */
export function filterPartnerCandidates(
  classes,
  { collegeId, currentId = null, currentCombinationId = null, currentPlanId = null } = {}
) {
  if (!collegeId) return [];
  return (classes || [])
    .filter((c) => {
      if (c.id === currentId) return false;
      if (c.collegeId !== collegeId) return false;
      // 当前班级自己的现有伙伴保留（便于继续查看/移除）
      const isExistingPartner =
        currentCombinationId != null && c.combinationId === currentCombinationId;
      // 已加入"其他"合班组的班级排除
      if (c.combinationId != null && !isExistingPartner) return false;
      // 合班伙伴必须是相同培养方案的班级（现有伙伴豁免，避免已选值丢失无法移除）
      if (!isExistingPartner && (currentPlanId == null || c.matchedPlanId !== currentPlanId)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
