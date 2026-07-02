<template>
  <el-card class="danger-card" shadow="never">
    <template #header>
      <div class="card-title-row">
        <span class="card-dot dot-red"></span>
        <span class="card-title-text danger-text">数据管理</span>
        <el-tag size="small" type="danger" effect="plain">危险操作</el-tag>
      </div>
    </template>

    <!-- 顶部警告横幅（紧凑） -->
    <div class="danger-banner">
      <el-icon :size="18"><WarningFilled /></el-icon>
      <span><strong>以下操作永久删除数据且不可恢复</strong>，请提前备份。</span>
    </div>

    <!-- 说明区：精简文案，分类清空已移除，引导用户使用基础数据页精细删除 -->
    <el-alert type="info" :closable="false" show-icon class="design-change-tip">
      <template #title>
        如需删除单条基础数据（学院/专业/层次/课程/教材/教师/班级/培养方案），请前往对应「基础数据管理」页面，每条删除均带级联保护。
      </template>
    </el-alert>

    <!-- 操作卡片：响应式栅格，≥992px 并排，<992px 堆叠 -->
    <el-row :gutter="20" class="reset-row">
      <!-- 系统重置 -->
      <el-col :xs="24" :sm="24" :md="12" :lg="12">
        <div class="reset-card warning">
          <div class="reset-card-header">
            <div class="reset-card-icon warning-icon">
              <el-icon :size="24"><WarningFilled /></el-icon>
            </div>
            <h4>系统重置</h4>
            <el-tag size="small" type="warning" effect="dark">恢复初始状态</el-tag>
          </div>
          <div class="reset-card-body">
            <p>
              清空所有业务数据（教师、班级、培养方案、课程、教材、专业、学院、培养层次、系统设置、操作日志），仅保留用户账号。
            </p>
            <div class="reset-card-scene">
              <el-icon><InfoFilled /></el-icon>
              <span>适用：更换测试环境、重新导入数据、系统初始化调试</span>
            </div>
          </div>
          <div class="reset-card-footer">
            <el-button type="danger" :loading="resetting" @click="$emit('reset', 'settings')">
              <el-icon><Delete /></el-icon>
              系统重置
            </el-button>
          </div>
        </div>
      </el-col>

      <!-- 清空操作日志 -->
      <el-col :xs="24" :sm="24" :md="12" :lg="12">
        <div class="reset-card">
          <div class="reset-card-header">
            <div class="reset-card-icon">
              <el-icon :size="24"><Delete /></el-icon>
            </div>
            <h4>清空操作日志</h4>
            <el-tag size="small" type="info" effect="plain">不影响业务数据</el-tag>
          </div>
          <div class="reset-card-body">
            <p>删除所有审计日志记录。此操作不可恢复，但不会影响任何业务数据。</p>
            <div class="reset-card-scene">
              <el-icon><InfoFilled /></el-icon>
              <span>适用：日志归档后清理、释放存储空间</span>
            </div>
          </div>
          <div class="reset-card-footer">
            <el-button
              type="danger"
              plain
              :loading="resetting"
              @click="$emit('reset', 'audit-logs')"
            >
              <el-icon><Delete /></el-icon>
              清空日志
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>
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
  margin-top: 20px;
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
  background-color: #f56c6c;
}

.card-title-text {
  font-weight: 600;
  font-size: 16px;
}

.danger-text {
  color: #f56c6c;
}

/* 顶部警告横幅 - 紧凑 */
.danger-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #fef0f0;
  border-left: 4px solid #f56c6c;
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #606266;
}

.danger-banner .el-icon {
  color: #f56c6c;
  flex-shrink: 0;
}

.design-change-tip {
  margin-bottom: 20px;
}

/* 响应式栅格：让 el-col 等高，内部卡片撑满 */
.reset-row :deep(.el-col) {
  display: flex;
}

.reset-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

.reset-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.reset-card.warning {
  background: #fdf6ec;
  border-color: #e6a23c;
}

/* 卡片头部：图标 + 标题 + 标签 */
.reset-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.reset-card-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 10px;
  color: #909399;
}

.reset-card-icon.warning-icon {
  color: #e6a23c;
}

.reset-card-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  flex: 1;
}

/* 卡片主体：描述 + 适用场景 */
.reset-card-body {
  flex: 1;
  margin-bottom: 20px;
}

.reset-card-body p {
  margin: 0 0 12px 0;
  font-size: 14px;
  line-height: 1.6;
  color: #606266;
}

.reset-card-scene {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.reset-card.warning .reset-card-scene {
  background: rgba(255, 255, 255, 0.5);
  color: #b88230;
}

.reset-card-scene .el-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

/* 卡片底部：按钮区，顶部分隔线 */
.reset-card-footer {
  display: flex;
  justify-content: flex-start;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}

.reset-card.warning .reset-card-footer {
  border-top-color: #f5dab1;
}

/* 响应式：小屏单列时卡片间距 */
@media (max-width: 991px) {
  .reset-row :deep(.el-col) + .el-col {
    margin-top: 16px;
  }
}
</style>
