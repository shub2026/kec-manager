<template>
  <el-dialog
    :model-value="modelValue"
    title="排课优化确认"
    width="var(--dialog-width)"
    align-center
    destroy-on-close
    class="optimize-confirm-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="confirm-content">
      <el-icon class="confirm-icon" :size="48" color="var(--brand-primary)">
        <DataAnalysis />
      </el-icon>
      <div class="confirm-title">开始排课优化分析？</div>
      <div class="confirm-description">
        系统将对当前学期所有已排课的教师进行全局优化分析，通过禁忌搜索算法尝试改善排课质量。
      </div>
      <div class="confirm-features">
        <div class="feature-item">
          <el-icon class="feature-icon"><CircleCheck /></el-icon>
          <span>负载均衡：优化教师工作量分配</span>
        </div>
        <div class="feature-item">
          <el-icon class="feature-icon"><CircleCheck /></el-icon>
          <span>教材内聚：尽量让同一教师教同一教材</span>
        </div>
        <div class="feature-item">
          <el-icon class="feature-icon"><CircleCheck /></el-icon>
          <span>预览模式：先查看优化效果再决定是否应用</span>
        </div>
      </div>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="confirm-alert"
      >
        <template #title>温馨提示</template>
        手动安排和已锁定的排课不会被优化，仅自动排课且未锁定的记录会被调整。
      </el-alert>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="emit('update:modelValue', false)">取消</el-button>
        <el-button type="primary" :loading="loading" @click="emit('confirm')">
          开始优化分析
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { DataAnalysis, CircleCheck } from '@element-plus/icons-vue';

defineProps({
  modelValue: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'confirm']);
</script>

<style scoped>
.confirm-content {
  text-align: center;
  padding: var(--space-4) var(--space-2);
}

.confirm-icon {
  margin-bottom: var(--space-3);
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-3);
}

.confirm-description {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: var(--space-4);
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}

.confirm-features {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  text-align: left;
  max-width: 360px;
  margin-left: auto;
  margin-right: auto;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 14px;
  color: var(--text-primary);
}

.feature-icon {
  color: var(--brand-success);
  flex-shrink: 0;
}

.confirm-alert {
  text-align: left;
  max-width: 480px;
  margin: 0 auto;
}

.dialog-footer {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
}

/* 移动端响应式：紧凑布局 + footer 按钮等宽（与 OptimizeResultDialog 风格统一） */
@media (max-width: 480px) {
  .confirm-content {
    padding: var(--space-3) var(--space-1);
  }

  .confirm-icon {
    font-size: 36px;
    margin-bottom: var(--space-2);
  }

  .confirm-title {
    font-size: 16px;
    margin-bottom: var(--space-2);
  }

  .confirm-description {
    font-size: 13px;
    margin-bottom: var(--space-3);
  }

  .confirm-features {
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }

  .feature-item {
    font-size: 13px;
  }

  .dialog-footer {
    flex-wrap: wrap;
    justify-content: stretch;
  }

  .dialog-footer .el-button {
    flex: 1;
  }
}
</style>
