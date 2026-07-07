<template>
  <el-dialog
    :model-value="modelValue"
    title="排课进度"
    width="min(520px, 90vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    destroy-on-close
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="arrange-progress">
      <!-- 模式标识 -->
      <div class="progress-header">
        <el-icon class="progress-icon" :class="{ rotating: !finished }">
          <Loading v-if="!finished" />
          <CircleCheckFilled v-else />
        </el-icon>
        <span class="progress-title">
          {{ finished ? '排课完成' : type === 'batch' ? '批量排课进行中' : '排课进行中' }}
        </span>
        <el-tag v-if="modeLabel" :type="modeLabel === '全量模式' ? 'warning' : 'success'" size="small">
          {{ modeLabel }}
        </el-tag>
        <el-tag
          class="tabu-tag"
          :type="tabuEnabled ? 'success' : 'info'"
          size="small"
          effect="plain"
        >
          <el-icon class="tabu-icon"><MagicStick /></el-icon>
          {{ tabuEnabled ? '禁忌搜索已启用' : '禁忌搜索未启用' }}
        </el-tag>
      </div>

      <!-- 进度条 -->
      <el-progress
        :percentage="percentage"
        :status="progressStatus"
        :stroke-width="10"
        :show-text="type === 'batch'"
        striped
        striped-flow
        :duration="type === 'batch' ? 30 : 0"
        style="margin: 20px 0"
      />

      <!-- 单课程：显示当前阶段 -->
      <template v-if="type === 'single'">
        <div class="phase-list">
          <div
            v-for="p in phases"
            :key="p.phase"
            class="phase-item"
            :class="{
              active: currentPhase === p.phase && !finished,
              done: currentPhase > p.phase || finished,
            }"
          >
            <el-icon class="phase-icon">
              <Select v-if="currentPhase > p.phase || finished" />
              <Loading v-else-if="currentPhase === p.phase" class="rotating" />
              <CircleClose v-else />
            </el-icon>
            <span class="phase-name">阶段{{ p.phase }}：{{ p.name }}</span>
          </div>
        </div>
      </template>

      <!-- 批量：显示已处理课程数和当前课程 -->
      <template v-else>
        <div class="batch-stats">
          <div class="stat-item">
            <span class="stat-label">已处理课程</span>
            <span class="stat-value">{{ processed }} / {{ total }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">已安排班级</span>
            <span class="stat-value assigned">{{ cumulativeAssigned }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">未分配班级</span>
            <span class="stat-value unassigned">{{ cumulativeUnassigned }}</span>
          </div>
        </div>
        <div v-if="currentCourseName && !finished" class="current-course">
          <el-icon class="rotating"><Loading /></el-icon>
          <span>正在排课：{{ currentCourseName }}</span>
        </div>
        <div v-if="finished" class="current-course done">
          <el-icon><CircleCheckFilled /></el-icon>
          <span>{{ message || '全部课程处理完成' }}</span>
        </div>
      </template>
    </div>

    <template #footer>
      <el-button v-if="finished" type="primary" @click="emit('close')">关闭</el-button>
      <el-button v-else disabled>排课进行中，请勿关闭页面</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue';
import { Loading, CircleCheckFilled, CircleClose, Select, MagicStick } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  type: { type: String, default: 'single' }, // 'single' | 'batch'
  modeLabel: { type: String, default: '' },
  finished: { type: Boolean, default: false },
  // 单课程进度
  currentPhase: { type: Number, default: 0 },
  // 批量进度
  processed: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  currentCourseName: { type: String, default: '' },
  cumulativeAssigned: { type: Number, default: 0 },
  cumulativeUnassigned: { type: Number, default: 0 },
  message: { type: String, default: '' },
  // 禁忌搜索开关状态（来自系统设置），用于弹窗直观提示是否启用
  tabuEnabled: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'close']);

// 五阶段定义
const phases = [
  { phase: 1, name: '意向教师分配' },
  { phase: 2, name: '无意向教师分配' },
  { phase: 3, name: '追加同教材班级' },
  { phase: 4, name: '第二本教材分配' },
  { phase: 5, name: '兜底放宽约束' },
];

const percentage = computed(() => {
  if (props.finished) return 100;
  if (props.type === 'batch') {
    if (props.total === 0) return 0;
    return Math.round((props.processed / props.total) * 100);
  }
  // 单课程：基于阶段计算
  if (props.currentPhase === 0) return 0;
  return Math.round((props.currentPhase / 5) * 100);
});

const progressStatus = computed(() => {
  if (props.finished) return 'success';
  return '';
});
</script>

<style scoped>
.arrange-progress {
  padding: 8px 0;
}

.progress-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.progress-icon {
  font-size: 20px;
  color: var(--brand-primary);
}

.progress-icon.finished {
  color: var(--brand-success, #67c23a);
}

.progress-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
}

.tabu-tag {
  display: inline-flex;
  align-items: center;
}

.tabu-icon {
  margin-right: 3px;
}

/* 单课程阶段列表 */
.phase-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}

.phase-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  transition: color 0.2s;
}

.phase-item.active {
  color: var(--brand-primary);
  font-weight: 500;
}

.phase-item.done {
  color: var(--brand-success, #67c23a);
}

.phase-icon {
  font-size: 16px;
}

/* 批量统计 */
.batch-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 16px 0;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  background: var(--fill-light, #f5f7fa);
  border-radius: 6px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-value.assigned {
  color: var(--brand-success, #67c23a);
}

.stat-value.unassigned {
  color: var(--brand-warning, #e6a23c);
}

.current-course {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-regular);
  padding: 8px 12px;
  background: var(--fill-light, #f5f7fa);
  border-radius: 4px;
}

.current-course.done {
  color: var(--brand-success, #67c23a);
}

/* 旋转动画 */
.rotating {
  animation: rotating 1.5s linear infinite;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
