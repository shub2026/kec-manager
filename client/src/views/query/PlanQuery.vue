<template>
  <div class="plan-query">
    <PageHeader
      title="方案查询"
      subtitle="查询中心"
      description="按培养方案查看课程矩阵和学期安排"
    />
    <el-card>
      <div class="page-toolbar">
        <el-select
          v-model="selectedPlanId"
          placeholder="请选择培养方案"
          clearable
          class="filter-2xl"
          style="max-width: 400px"
          @change="handlePlanChange"
        >
          <el-option
            v-for="plan in plans"
            :key="plan.id"
            :label="getPlanLabel(plan)"
            :value="plan.id"
          />
        </el-select>
      </div>

      <!-- 方案概览条：选中方案后展示名称/版本/专业/层次与核心指标（结构与方案明细页概览条一致） -->
      <section v-if="selectedPlan" class="plan-overview" aria-label="方案概览">
        <!-- 标题行：方案名 + 版本 + 专业/层次 tag -->
        <div class="ov-title-row">
          <span class="ov-plan-name">{{ selectedPlan.name }}</span>
          <span v-if="selectedPlan.version" class="ov-version">{{ selectedPlan.version }}</span>
          <el-tag v-if="selectedPlan.majors?.name" size="small" disable-transitions>{{
            selectedPlan.majors.name
          }}</el-tag>
          <el-tag
            v-if="selectedPlan.trainingLevels?.name"
            class="tag-indigo"
            size="small"
            disable-transitions
            >{{ selectedPlan.trainingLevels.name }}</el-tag
          >
        </div>
        <!-- 指标行：与明细页概览条同规格，loading 期间显示占位符避免 0 值闪动 -->
        <div class="ov-metrics">
          <div class="ov-item">
            <span class="ov-label">学院</span>
            <span class="ov-value">{{ selectedPlan.colleges?.name || '—' }}</span>
          </div>
          <div class="ov-divider"></div>
          <div class="ov-item">
            <span class="ov-label">公共/专业</span>
            <span class="ov-value">{{
              loading ? '—' : `${publicCount} / ${professionalCount}`
            }}</span>
          </div>
          <div class="ov-item">
            <span class="ov-label">课程数</span>
            <span class="ov-value">{{ loading ? '—' : courseCount }}</span>
          </div>
          <div class="ov-item">
            <span class="ov-label">总课时</span>
            <span class="ov-value ov-accent">{{ loading ? '—' : totalAllHours }}</span>
          </div>
        </div>
      </section>

      <!-- 矩阵表展示：复用 CourseMatrixTable 只读模式 -->
      <ListErrorState v-if="error" :message="error" @retry="handlePlanChange" />
      <div v-else-if="selectedPlanId && planCourses.length > 0" class="matrix-container">
        <CourseMatrixTable
          :raw-courses="planCourses"
          :loading="loading"
          :readonly="true"
          :total-all-hours="totalAllHours"
          :show-grand-total="true"
        />
        <!-- 颜色语义图例 -->
        <MatrixLegend class="plan-query-legend" />
      </div>

      <EmptyState v-else-if="selectedPlanId" type="plan" description="该方案暂无课程数据" />
      <EmptyState v-else type="plan" description="请选择培养方案查看明细" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getPlans, getPlanCourses } from '../../api/plan';
import CourseMatrixTable from '../../components/CourseMatrixTable.vue';
import MatrixLegend from '../../components/MatrixLegend.vue';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import { useMatrixCalculations } from '../../composables/useMatrixCalculations';

defineOptions({ name: 'PlanQuery' });

// 状态
const plans = ref([]);
const selectedPlanId = ref(null);
const loading = ref(false);
const planCourses = ref([]);
// 列表加载错误状态，供 ListErrorState 占位
const error = ref(null);

// FE-P2 优化：总课时复用共享 composable，消除与 useMatrixCalculations 的重复实现
const { totalAllHours } = useMatrixCalculations(planCourses);

// 获取方案显示标签
function getPlanLabel(plan) {
  const parts = [];
  if (plan.majors?.name) parts.push(plan.majors.name);
  if (plan.colleges?.name) parts.push(plan.colleges.name);
  if (plan.trainingLevels?.name) parts.push(plan.trainingLevels.name);
  if (plan.version) parts.push(`(${plan.version})`);
  return `${plan.name} ${parts.join(' - ')}`;
}

// 每学期总计（所有课程的该学期周课时之和）—— 已由 CourseMatrixTable 的 showGrandTotal 接管
// function calcFinalSemesterTotal(semester) { ... }

// 当前选中的方案对象（列表数据直接查找，含 majors/colleges/trainingLevels 关联）
const selectedPlan = computed(() => plans.value.find((p) => p.id === selectedPlanId.value) || null);
// 课程数与公共/专业课数口径与方案明细页一致
const courseCount = computed(() => planCourses.value.length);
const publicCount = computed(
  () => planCourses.value.filter((c) => (c.courses?.type || 'public') === 'public').length
);
const professionalCount = computed(
  () => planCourses.value.filter((c) => c.courses?.type === 'professional').length
);

// 加载方案列表
async function loadPlans() {
  try {
    const res = await getPlans();
    plans.value = res.data || [];
  } catch (e) {
    if (import.meta.env.DEV) console.error(e);
    ElMessage.error('加载培养方案失败');
  }
}

// 处理方案选择变化
async function handlePlanChange() {
  if (!selectedPlanId.value) {
    planCourses.value = [];
    error.value = null;
    return;
  }

  loading.value = true;
  error.value = null;
  try {
    const res = await getPlanCourses(selectedPlanId.value);
    planCourses.value = res.data || [];
  } catch (e) {
    if (import.meta.env.DEV) console.error(e);
    error.value = '加载方案课程失败，请稍后重试';
    planCourses.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadPlans();
});
</script>

<style scoped>
/* 方案概览条：结构与方案明细页概览条一致（查询页只读，无按钮无学期周数） */
.plan-overview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--el-box-shadow-light, 0 1px 2px rgba(0, 0, 0, 0.04));
}

/* 标题行：方案名 16px/600 + 版本小字 + 专业/层次 tag */
.ov-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.ov-plan-name {
  font-size: var(--font-size-h3);
  font-weight: 600;
  color: var(--text-primary);
}

.ov-version {
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
}

/* 指标行：与明细页 ov-item/ov-label/ov-value 同规格 */
.ov-metrics {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 20px;
}

.ov-item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.ov-label {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.ov-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.ov-accent {
  color: var(--brand-primary);
}

.ov-divider {
  width: 1px;
  height: 18px;
  background: var(--border-light);
}

.matrix-container {
  margin-top: 20px;
}

/* 图例间距 */
.plan-query-legend {
  margin-top: var(--space-3);
}

/* 窄屏（≤768px）：指标换行后隐藏分隔符（与明细页同策略） */
@media (max-width: 768px) {
  .ov-divider {
    display: none;
  }

  .plan-overview {
    padding: var(--space-3);
  }
}
</style>
