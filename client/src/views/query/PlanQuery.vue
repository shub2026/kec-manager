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

      <!-- 矩阵表展示：复用 CourseMatrixTable 只读模式 -->
      <div v-if="selectedPlanId && planCourses.length > 0" class="matrix-container">
        <CourseMatrixTable
          :raw-courses="planCourses"
          :loading="loading"
          :readonly="true"
          :total-all-hours="totalAllHours"
        />
        <!-- 总计行（只读模式额外展示） -->
        <table v-if="planCourses.length > 0" class="matrix-total-final">
          <tr>
            <td class="matrix-fixed-col matrix-total-final-label">总计</td>
            <td v-for="s in maxSemester" :key="s" class="matrix-cell matrix-total-final-cell">
              {{ calcFinalSemesterTotal(s) }}
            </td>
            <td class="matrix-cell matrix-total-final-cell">
              <strong>{{ totalAllHours }}</strong>
            </td>
          </tr>
        </table>
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
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';

defineOptions({ name: 'PlanQuery' });

// 状态
const plans = ref([]);
const selectedPlanId = ref(null);
const loading = ref(false);
const planCourses = ref([]);

// 计算最大学期数
const maxSemester = computed(() => {
  if (!planCourses.value.length) return 8;
  const max = Math.max(...planCourses.value.map((c) => c.endSemester), 0);
  return Math.max(max, 8);
});

// 总课时
const totalAllHours = computed(() => {
  let total = 0;
  planCourses.value.forEach((c) => {
    for (let s = c.startSemester; s <= c.endSemester; s++) {
      const sem = (c.planCourseSemesters || []).find((x) => x.semester === s);
      if (sem) {
        total += (sem.weeklyHours || 0) * (sem.weeksCount || 18);
      } else {
        total += (c.weeklyHours || 0) * (c.weeksPerSemester || 18);
      }
    }
  });
  return Math.round(total);
});

// 获取方案显示标签
function getPlanLabel(plan) {
  const parts = [];
  if (plan.majors?.name) parts.push(plan.majors.name);
  if (plan.colleges?.name) parts.push(plan.colleges.name);
  if (plan.trainingLevels?.name) parts.push(plan.trainingLevels.name);
  if (plan.version) parts.push(`(${plan.version})`);
  return `${plan.name} ${parts.join(' - ')}`;
}

// 每学期总计（所有课程的该学期周课时之和）
function calcFinalSemesterTotal(semester) {
  let total = 0;
  planCourses.value.forEach((c) => {
    if (semester >= c.startSemester && semester <= c.endSemester) {
      const sem = (c.planCourseSemesters || []).find((x) => x.semester === semester);
      if (sem && sem.weeklyHours !== null) {
        total += sem.weeklyHours;
      }
    }
  });
  return total;
}

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
    return;
  }

  loading.value = true;
  try {
    const res = await getPlanCourses(selectedPlanId.value);
    planCourses.value = res.data || [];
  } catch (e) {
    if (import.meta.env.DEV) console.error(e);
    ElMessage.error('加载方案课程失败');
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
.page-toolbar {
  justify-content: flex-start;
}

.matrix-container {
  margin-top: 20px;
}

/* 总计行表格（紧接 CourseMatrixTable 下方） */
.matrix-total-final {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 13px;
  border: 1px solid var(--border-light);
  border-top: none;
}

.matrix-total-final td {
  background: var(--border-light);
  border-top: 3px solid var(--text-secondary);
  font-weight: 600;
  border: 1px solid var(--text-placeholder);
  padding: 4px 6px;
  text-align: center;
}

.matrix-total-final-label {
  padding: 8px 12px;
  font-weight: 700;
  color: var(--text-primary);
  text-align: left;
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--border-light);
  min-width: 160px;
}

.matrix-total-final-cell {
  font-weight: 700;
  color: var(--text-primary);
  font-size: 14px;
  min-width: 80px;
}
</style>
