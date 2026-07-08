<template>
  <el-card class="insight-card">
    <template #header>
      <span class="card-title">
        <el-icon><Finished /></el-icon>
        排课完成度
      </span>
    </template>

    <div class="progress-section">
      <div class="progress-header">
        <span class="progress-label">本学期课程排课进度</span>
        <span class="progress-percent">{{ data.rate }}%</span>
      </div>
      <el-progress
        :percentage="data.rate"
        :stroke-width="16"
        :color="progressColor"
        :show-text="false"
        class="progress-bar"
      />
      <div class="progress-detail">
        <span>
          已排课 <strong>{{ data.assignedCourses }}</strong> / {{ data.totalCourses }} 门课程
        </span>
        <span class="progress-remaining" v-if="data.totalCourses - data.assignedCourses > 0">
          剩余 {{ data.totalCourses - data.assignedCourses }} 门
        </span>
      </div>
    </div>

    <div v-if="data.rate === 100" class="progress-complete">
      <el-icon color="var(--brand-success)"><CircleCheckFilled /></el-icon>
      <span>所有课程已完成排课</span>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: {
    type: Object,
    default: () => ({ totalCourses: 0, assignedCourses: 0, rate: 0 }),
  },
});

const progressColor = computed(() => {
  const r = props.data.rate;
  if (r >= 80) return 'var(--brand-success)';
  if (r >= 50) return 'var(--brand-primary)';
  if (r >= 20) return 'var(--brand-warning)';
  return 'var(--brand-danger)';
});
</script>

<style scoped>
.insight-card {
  height: 100%;
}

.progress-section {
  padding: 4px 0;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-label {
  font-size: 14px;
  color: var(--text-regular);
}

.progress-percent {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.progress-bar {
  margin-bottom: 12px;
}

.progress-detail {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.progress-detail strong {
  color: var(--text-primary);
  font-weight: 600;
}

.progress-remaining {
  color: var(--brand-warning);
  font-weight: 500;
}

.progress-complete {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--brand-success-soft);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--brand-success);
  font-weight: 500;
}
</style>
