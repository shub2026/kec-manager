<template>
  <el-card class="danger-card" shadow="never">
    <template #header>
      <div class="card-title-row">
        <span class="card-dot dot-red"></span>
        <span class="card-title-text">数据管理</span>
        <el-tag size="small" type="danger" effect="plain">危险操作</el-tag>
      </div>
    </template>

    <!-- 顶部提示 -->
    <div class="danger-hint">
      <el-icon :size="16"><WarningFilled /></el-icon>
      <span>以下操作永久删除数据且不可恢复，请提前备份。</span>
    </div>

    <!-- 操作列表 -->
    <div class="reset-list">
      <!-- 系统重置 -->
      <div class="reset-item">
        <div class="reset-item-info">
          <div class="reset-item-header">
            <h4>系统重置</h4>
            <el-tag size="small" type="warning" effect="plain">恢复初始状态</el-tag>
          </div>
          <p class="reset-item-desc">
            清空所有业务数据（教师、班级、培养方案、课程、教材、专业、学院、培养层次、系统设置、操作日志），仅保留用户账号。
          </p>
        </div>
        <div class="reset-item-action">
          <el-button type="danger" size="small" :loading="resetting" @click="$emit('reset', 'settings')">
            <el-icon><Delete /></el-icon>
            系统重置
          </el-button>
        </div>
      </div>

      <!-- 清空操作日志 -->
      <div class="reset-item">
        <div class="reset-item-info">
          <div class="reset-item-header">
            <h4>清空操作日志</h4>
            <el-tag size="small" type="info" effect="plain">不影响业务数据</el-tag>
          </div>
          <p class="reset-item-desc">
            删除所有审计日志记录。此操作不可恢复，但不会影响任何业务数据。
          </p>
        </div>
        <div class="reset-item-action">
          <el-button type="danger" plain size="small" :loading="resetting" @click="$emit('reset', 'audit-logs')">
            <el-icon><Delete /></el-icon>
            清空日志
          </el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
defineProps({
  resetting: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['reset']);
</script>

<style scoped>
.danger-card {
  margin-bottom: 20px;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-red {
  background-color: var(--brand-danger);
}

.card-title-text {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}

/* 顶部提示 - 轻量内联风格 */
.danger-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--brand-danger-soft);
  border-radius: var(--radius-sm);
  margin-bottom: 16px;
  font-size: 13px;
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
  gap: 0;
}

.reset-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-light);
}

.reset-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.reset-item:first-child {
  padding-top: 0;
}

.reset-item-info {
  flex: 1;
  min-width: 0;
}

.reset-item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.reset-item-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.reset-item-desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.reset-item-action {
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .reset-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .reset-item-action {
    align-self: flex-end;
  }
}
</style>
