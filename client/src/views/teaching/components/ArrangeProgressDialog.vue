<template>
  <el-dialog
    :model-value="modelValue"
    title="排课进度"
    width="var(--dialog-width-lg)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    destroy-on-close
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="arrange-progress">
      <!-- 头部：图标徽章 + 标题/模式标签 + 百分比 -->
      <div class="progress-header">
        <div class="progress-icon-wrap" :class="{ 'is-done': finished }">
          <el-icon class="progress-icon" :class="{ rotating: !finished }">
            <Loading v-if="!finished" />
            <CircleCheckFilled v-else />
          </el-icon>
        </div>
        <div class="progress-title-group">
          <span class="progress-title">
            {{ finished ? '排课完成' : type === 'batch' ? '批量排课进行中' : '排课进行中' }}
          </span>
          <div class="progress-tags">
            <el-tag
              v-if="modeLabel"
              :type="modeLabel === '全量模式' ? 'warning' : 'success'"
              size="small"
              round
              disable-transitions
            >
              {{ modeLabel }}
            </el-tag>
            <el-tag
              class="tabu-tag"
              :type="tabuEnabled ? 'success' : 'info'"
              size="small"
              effect="plain"
              round
              disable-transitions
            >
              <el-icon class="tabu-icon"><MagicStick /></el-icon>
              {{ tabuEnabled ? '禁忌搜索已启用' : '禁忌搜索未启用' }}
            </el-tag>
          </div>
        </div>
        <span class="progress-percent" :class="{ 'is-done': finished }">{{ percentage }}%</span>
      </div>

      <!-- 进度条（百分比已在头部展示，不重复显示内联文字） -->
      <el-progress
        :percentage="percentage"
        :status="progressStatus"
        :stroke-width="10"
        :show-text="false"
        striped
        striped-flow
        :duration="type === 'batch' ? 30 : 3"
        class="progress-bar"
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
            <span class="stat-value"
              >{{ processed }} <span class="stat-sub">/ {{ total }}</span></span
            >
          </div>
          <div class="stat-item" :class="{ 'is-ok': cumulativeAssigned > 0 }">
            <span class="stat-label">已安排班级</span>
            <span class="stat-value assigned">{{ cumulativeAssigned }}</span>
          </div>
          <div class="stat-item" :class="{ 'is-warn': cumulativeUnassigned > 0 }">
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
      <el-button v-if="finished" type="primary" @click="emit('close')">确定</el-button>
      <template v-else>
        <el-button text type="danger" @click="cancelConfirmVisible = true">取消排课</el-button>
        <el-button disabled>排课进行中，请勿关闭页面</el-button>
      </template>
    </template>
  </el-dialog>

  <!-- 取消排课二次确认 -->
  <BaseConfirmDialog
    v-model="cancelConfirmVisible"
    title="取消排课"
    message="确定要中止本次排课吗？已完成的分配不会回退，服务端已启动的任务可能继续执行。"
    confirm-text="中止排课"
    cancel-text="继续等待"
    confirm-type="danger"
    @confirm="handleCancelConfirm"
  />
</template>

<script setup>
import { computed, ref } from 'vue';
import {
  Loading,
  CircleCheckFilled,
  CircleClose,
  Select,
  MagicStick,
} from '@element-plus/icons-vue';
import BaseConfirmDialog from '../../../components/BaseConfirmDialog.vue';

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

const emit = defineEmits(['update:modelValue', 'close', 'cancel']);

// 取消排课二次确认（进行中状态的逃生通道）
const cancelConfirmVisible = ref(false);

function handleCancelConfirm() {
  cancelConfirmVisible.value = false;
  emit('cancel');
}

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
  let pct;
  if (props.type === 'batch') {
    if (props.total === 0) return 0;
    pct = Math.round((props.processed / props.total) * 100);
  } else {
    // 单课程：基于阶段计算
    if (props.currentPhase === 0) return 0;
    pct = Math.round((props.currentPhase / 5) * 100);
  }
  // 未完成时封顶 99%：批量主轮结束后可能进入补漏轮（processed=total），
  // 单课程阶段事件在阶段开始时推送（阶段5进行中即达 5/5），
  // 避免进度条提前满格让用户误以为卡死
  return Math.min(pct, 99);
});

const progressStatus = computed(() => {
  if (props.finished) return 'success';
  return '';
});
</script>

<style scoped>
.arrange-progress {
  padding: var(--space-2) 0;
}

/* —— 头部：图标徽章 + 标题/标签组 + 百分比 —— */
.progress-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.progress-icon-wrap {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-primary-soft);
  color: var(--brand-primary);
  flex-shrink: 0;
  transition:
    background var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
}

.progress-icon-wrap.is-done {
  background: var(--brand-success-soft);
  color: var(--brand-success-text);
}

.progress-icon {
  font-size: 22px;
}

.progress-title-group {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.progress-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.progress-tags {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.tabu-tag {
  display: inline-flex;
  align-items: center;
}

.tabu-icon {
  margin-right: 3px;
}

.progress-percent {
  font-size: var(--font-size-display);
  font-weight: 700;
  color: var(--brand-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  flex-shrink: 0;
  transition: color var(--dur-base) var(--ease-out);
}

.progress-percent.is-done {
  color: var(--brand-success-text);
}

.progress-bar {
  margin: var(--space-4) 0;
}

/* —— 单课程阶段列表：活跃阶段胶囊高亮 —— */
.phase-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.phase-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  transition:
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.phase-item.active {
  color: var(--brand-primary);
  font-weight: 600;
  background: var(--brand-primary-soft);
}

.phase-item.done {
  color: var(--brand-success-text);
}

.phase-icon {
  font-size: 16px;
}

/* —— 批量统计卡片：有数据时语义着色 —— */
.batch-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-3) var(--space-2);
  background: var(--bg-subtle);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  transition:
    background var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.stat-item.is-ok {
  background: var(--brand-success-soft);
  border-color: var(--brand-success-lighter);
}

.stat-item.is-warn {
  background: var(--brand-warning-soft);
  border-color: var(--brand-warning-lighter);
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: var(--space-1);
}

.stat-value {
  font-size: var(--font-size-h2);
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.stat-value .stat-sub {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.stat-value.assigned {
  color: var(--brand-success-text);
}

.stat-value.unassigned {
  color: var(--brand-warning-text);
}

/* —— 当前课程提示条 —— */
.current-course {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  font-weight: 500;
  color: var(--brand-primary);
  padding: var(--space-2) var(--space-3);
  background: var(--brand-primary-soft);
  border-radius: var(--radius-sm);
}

.current-course.done {
  color: var(--brand-success-text);
  background: var(--brand-success-soft);
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
