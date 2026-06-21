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
        <span>请务必提前备份重要数据，按推荐顺序执行清理。</span>
      </div>
    </div>

    <!-- 数据清理分组 Tab -->
    <el-tabs v-model="activeTab" class="reset-tabs">
      <!-- Tab 1: 基础数据 -->
      <el-tab-pane name="basic">
        <template #label>
          <span class="tab-label">
            <el-icon><Grid /></el-icon>
            基础数据
          </span>
        </template>

        <div class="reset-group-desc">
          清空基础数据表（教师、班级、课程、教材、专业、学院、层次），请按推荐顺序执行。
        </div>

        <div class="reset-grid">
          <div class="reset-item" :class="{ 'is-primary': true }">
            <div class="reset-item-icon">
              <el-icon :size="22"><UserFilled /></el-icon>
            </div>
            <div class="reset-item-info">
              <div class="reset-item-name">清空教师</div>
              <div class="reset-item-desc">
                仅删除教师数据及教学安排，不影响其他基础数据。建议优先执行。
              </div>
            </div>
            <div class="reset-item-action">
              <el-button
                type="danger"
                plain
                size="small"
                :loading="resetting"
                @click="$emit('reset', 'teachers')"
              >
                清空
              </el-button>
            </div>
          </div>

          <div class="reset-item">
            <div class="reset-item-icon">
              <el-icon :size="22"><User /></el-icon>
            </div>
            <div class="reset-item-info">
              <div class="reset-item-name">清空班级</div>
              <div class="reset-item-desc">仅删除班级数据，不影响其他数据。</div>
            </div>
            <div class="reset-item-action">
              <el-button
                type="danger"
                plain
                size="small"
                :loading="resetting"
                @click="$emit('reset', 'classes')"
              >
                清空
              </el-button>
            </div>
          </div>

          <div class="reset-item">
            <div class="reset-item-icon">
              <el-icon :size="22"><Reading /></el-icon>
            </div>
            <div class="reset-item-info">
              <div class="reset-item-name">清空课程</div>
              <div class="reset-item-desc">级联清空培养方案中的课程安排</div>
            </div>
            <div class="reset-item-action">
              <el-button
                type="warning"
                plain
                size="small"
                :loading="resetting"
                @click="$emit('reset', 'courses')"
              >
                清空
              </el-button>
            </div>
          </div>

          <div class="reset-item">
            <div class="reset-item-icon">
              <el-icon :size="22"><Notebook /></el-icon>
            </div>
            <div class="reset-item-info">
              <div class="reset-item-name">清空教材</div>
              <div class="reset-item-desc">级联清空培养方案中的教材关联</div>
            </div>
            <div class="reset-item-action">
              <el-button
                type="warning"
                plain
                size="small"
                :loading="resetting"
                @click="$emit('reset', 'textbooks')"
              >
                清空
              </el-button>
            </div>
          </div>

          <div class="reset-item">
            <div class="reset-item-icon">
              <el-icon :size="22"><Collection /></el-icon>
            </div>
            <div class="reset-item-info">
              <div class="reset-item-name">清空专业</div>
              <div class="reset-item-desc">需先清空班级。级联清空所有培养方案</div>
            </div>
            <div class="reset-item-action">
              <el-button
                type="info"
                plain
                size="small"
                :loading="resetting"
                @click="$emit('reset', 'majors')"
              >
                清空
              </el-button>
            </div>
          </div>

          <div class="reset-item">
            <div class="reset-item-icon">
              <el-icon :size="22"><OfficeBuilding /></el-icon>
            </div>
            <div class="reset-item-info">
              <div class="reset-item-name">清空学院</div>
              <div class="reset-item-desc">需先清空班级。级联清空所有培养方案</div>
            </div>
            <div class="reset-item-action">
              <el-button
                type="info"
                plain
                size="small"
                :loading="resetting"
                @click="$emit('reset', 'colleges')"
              >
                清空
              </el-button>
            </div>
          </div>

          <div class="reset-item">
            <div class="reset-item-icon">
              <el-icon :size="22"><Rank /></el-icon>
            </div>
            <div class="reset-item-info">
              <div class="reset-item-name">清空层次</div>
              <div class="reset-item-desc">需先清空班级。级联清空所有培养方案</div>
            </div>
            <div class="reset-item-action">
              <el-button
                type="info"
                plain
                size="small"
                :loading="resetting"
                @click="$emit('reset', 'levels')"
              >
                清空
              </el-button>
            </div>
          </div>
        </div>

        <el-alert type="info" :closable="false" show-icon class="order-tip">
          <template #title>
            推荐清理顺序：教师 → 班级 → 课程 / 教材 → 培养方案 → 专业 / 学院 / 层次
          </template>
        </el-alert>
      </el-tab-pane>

      <!-- Tab 2: 培养方案 -->
      <el-tab-pane name="plans">
        <template #label>
          <span class="tab-label">
            <el-icon><Document /></el-icon>
            培养方案
          </span>
        </template>

        <div class="reset-group-desc">
          清空所有培养方案及其关联数据（课程安排、教材关联），不影响基础数据。
        </div>

        <div class="reset-single-card">
          <div class="reset-single-icon">
            <el-icon :size="32"><Delete /></el-icon>
          </div>
          <div class="reset-single-body">
            <h4>清空所有培养方案</h4>
            <p>包括培养方案主表、课程安排、教材关联数据。基础数据（课程/教材/班级等）不受影响。</p>
          </div>
          <div class="reset-single-action">
            <el-button type="danger" :loading="resetting" @click="$emit('reset', 'plans')">
              <el-icon><Delete /></el-icon>
              清空培养方案
            </el-button>
          </div>
        </div>
      </el-tab-pane>

      <!-- Tab 3: 系统重置 -->
      <el-tab-pane name="system">
        <template #label>
          <span class="tab-label">
            <el-icon><Setting /></el-icon>
            系统重置
          </span>
        </template>

        <div class="reset-group-desc">
          将系统恢复到初始化状态，清空所有业务数据但保留用户账号。此操作不可恢复！
        </div>

        <div class="reset-single-card warning">
          <div class="reset-single-icon">
            <el-icon :size="32"><WarningFilled /></el-icon>
          </div>
          <div class="reset-single-body">
            <h4>系统重置（恢复初始状态）</h4>
            <p>
              清空所有业务数据（教师、班级、培养方案、课程、教材、专业、学院、培养层次、系统设置、操作日志），仅保留用户账号。
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
      </el-tab-pane>

      <!-- Tab 4: 操作日志 -->
      <el-tab-pane name="logs">
        <template #label>
          <span class="tab-label">
            <el-icon><DocumentChecked /></el-icon>
            操作日志
          </span>
        </template>

        <div class="reset-group-desc">
          清空所有操作日志记录，释放存储空间。此操作不影响业务数据。
        </div>

        <div class="reset-single-card">
          <div class="reset-single-icon">
            <el-icon :size="32"><Delete /></el-icon>
          </div>
          <div class="reset-single-body">
            <h4>清空操作日志</h4>
            <p>删除所有审计日志记录。此操作不可恢复，但不会影响任何业务数据。</p>
          </div>
          <div class="reset-single-action">
            <el-button type="danger" :loading="resetting" @click="$emit('reset', 'audit-logs')">
              <el-icon><Delete /></el-icon>
              清空操作日志
            </el-button>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup>
import { ref } from 'vue';
import {
  WarningFilled,
  Grid,
  Document,
  Setting,
  DocumentChecked,
  Delete,
  User,
  UserFilled,
  Reading,
  Notebook,
  Collection,
  OfficeBuilding,
  Rank,
} from '@element-plus/icons-vue';

const props = defineProps({
  resetting: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['reset']);

const activeTab = ref('basic');
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

.reset-group-desc {
  margin-bottom: 20px;
  padding: 12px 16px;
  background: #f4f4f5;
  border-radius: 4px;
  font-size: 14px;
  color: #606266;
}

.reset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.reset-item {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 15px;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  transition: all 0.3s;
}

.reset-item:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.reset-item.is-primary {
  border-color: #f56c6c;
  background: #fef0f0;
}

.reset-item-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 50%;
  color: #909399;
}

.reset-item-info {
  flex: 1;
}

.reset-item-name {
  font-weight: 500;
  color: #303133;
  margin-bottom: 4px;
}

.reset-item-desc {
  font-size: 12px;
  color: #909399;
}

.order-tip {
  margin-top: 15px;
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

.reset-single-action {
  flex-shrink: 0;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
