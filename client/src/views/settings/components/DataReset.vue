<template>
  <el-card>
    <template #header>
      <SettingsCardHeader dot="red" tag="数据维护" tag-type="danger">数据管理</SettingsCardHeader>
    </template>

    <!-- 顶部提示 -->
    <div class="danger-hint">
      <el-icon :size="16"><WarningFilled /></el-icon>
      <span>操作不可恢复，请提前备份数据。</span>
    </div>

    <!-- 操作列表 -->
    <div class="reset-list">
      <!-- 系统重置 -->
      <div class="reset-item">
        <div class="reset-item-header">
          <h4>系统重置</h4>
          <el-tag size="small" type="warning" effect="plain">恢复初始状态</el-tag>
          <span class="header-spacer"></span>
          <el-button type="danger" :loading="resetting" @click="$emit('reset', 'settings')">
            <el-icon><Delete /></el-icon>
            系统重置
          </el-button>
        </div>
        <p class="reset-item-desc">
          清空所有业务数据（教师、班级、培养方案、课程、教材、专业、学院、培养层次、系统设置、操作日志），仅保留用户账号。
        </p>
      </div>

      <!-- 清空操作日志 -->
      <div class="reset-item">
        <div class="reset-item-header">
          <h4>清空操作日志</h4>
          <el-tag size="small" type="warning" effect="plain">日常维护</el-tag>
          <span class="header-spacer"></span>
          <el-button
            type="warning"
            plain
            :loading="resetting"
            @click="$emit('reset', 'audit-logs')"
          >
            <el-icon><Delete /></el-icon>
            清空日志
          </el-button>
        </div>
        <p class="reset-item-desc">
          删除所有审计日志记录。此操作不可恢复，但不会影响任何业务数据。
        </p>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import SettingsCardHeader from './SettingsCardHeader.vue';

defineProps({
  resetting: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['reset']);
</script>

<style scoped>
/* 顶部提示 - 轻量内联风格 */
.danger-hint {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 14px 18px;
  background: var(--brand-danger-soft);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-6);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-regular);
}

.danger-hint .el-icon {
  color: var(--brand-danger);
  flex-shrink: 0;
}

/* 操作列表 */
.reset-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.reset-item {
  padding: var(--space-5) var(--space-5);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.reset-item-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: var(--space-3);
}

.reset-item-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.01em;
}

.header-spacer {
  flex: 1;
}

.reset-item-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

@media (max-width: 768px) {
  .reset-item-header {
    flex-wrap: wrap;
  }
}
</style>
