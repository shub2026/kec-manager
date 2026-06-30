<template>
  <el-card class="danger-card" shadow="never">
    <template #header>
      <div class="card-title-row">
        <span class="card-dot dot-red"></span>
        <span class="card-title-text danger-text">数据管理</span>
        <el-tag size="small" type="danger" effect="plain">危险操作</el-tag>
      </div>
    </template>

    <!-- 顶部警告横幅 -->
    <div class="danger-banner">
      <div class="banner-icon">
        <el-icon :size="22"><WarningFilled /></el-icon>
      </div>
      <div class="banner-text">
        <strong>以下操作将永久删除数据且不可恢复。</strong>
        <span>请务必提前备份重要数据。</span>
      </div>
    </div>

    <!-- 说明区：分类清空已移除，引导用户使用基础数据页精细删除 -->
    <el-alert type="info" :closable="false" show-icon class="design-change-tip">
      <template #title>
        如需删除个别学院/专业/层次/课程/教材/教师/班级/培养方案，请前往对应的「基础数据管理」页面操作，每条删除均带级联保护。
      </template>
      <template #default>
        系统设置页仅保留「系统重置」与「清空操作日志」两个全量操作，避免分类清空带来的隐式级联混乱。
      </template>
    </el-alert>

    <!-- 操作卡片列表 -->
    <div class="reset-list">
      <!-- 系统重置 -->
      <div class="reset-single-card warning">
        <div class="reset-single-icon">
          <el-icon :size="32"><WarningFilled /></el-icon>
        </div>
        <div class="reset-single-body">
          <h4>系统重置（恢复初始状态）</h4>
          <p>
            清空所有业务数据（教师、班级、培养方案、课程、教材、专业、学院、培养层次、系统设置、操作日志），仅保留用户账号。此操作不可恢复！
          </p>
          <p class="highlight-text">适用场景：更换测试环境、重新导入数据、系统初始化调试</p>
        </div>
        <div class="reset-single-action">
          <el-button type="danger" :loading="resetting" @click="$emit('reset', 'settings')">
            <el-icon><Delete /></el-icon>
            系统重置
          </el-button>
        </div>
      </div>

      <!-- 清空操作日志 -->
      <div class="reset-single-card">
        <div class="reset-single-icon">
          <el-icon :size="32"><Delete /></el-icon>
        </div>
        <div class="reset-single-body">
          <h4>清空操作日志</h4>
          <p>删除所有审计日志记录。此操作不可恢复，但不会影响任何业务数据。</p>
          <p class="muted-text">适用场景：日志归档后清理、释放存储空间</p>
        </div>
        <div class="reset-single-action">
          <el-button type="danger" :loading="resetting" @click="$emit('reset', 'audit-logs')">
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

.danger-banner {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 15px 20px;
  background: #fef0f0;
  border-left: 4px solid #f56c6c;
  border-radius: 4px;
  margin-bottom: 20px;
}

.banner-text {
  font-size: 14px;
  color: #606266;
}

.design-change-tip {
  margin-bottom: 20px;
}

.reset-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.reset-single-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 25px;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.reset-single-card.warning {
  background: #fdf6ec;
  border-color: #e6a23c;
}

.reset-single-icon {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 50%;
  color: #f56c6c;
}

.reset-single-body {
  flex: 1;
}

.reset-single-body h4 {
  margin: 0 0 10px 0;
  font-size: 16px;
  color: #303133;
}

.reset-single-body p {
  margin: 0;
  font-size: 14px;
  color: #606266;
}

.highlight-text {
  margin-top: 10px !important;
  padding: 8px 12px;
  background: #fff7e6;
  border-left: 3px solid #e6a23c;
  border-radius: 4px;
  font-size: 13px !important;
  color: #e6a23c !important;
}

.muted-text {
  margin-top: 10px !important;
  font-size: 13px !important;
  color: #909399 !important;
}

.reset-single-action {
  flex-shrink: 0;
}
</style>
