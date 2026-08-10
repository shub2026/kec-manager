<template>
  <el-card
    class="settings-card"
    :class="{ 'settings-card--compact': !selectedCourseId && !$slots.default }"
  >
    <template #header>
      <div class="card-header">
        <span
          ><el-icon><Setting /></el-icon> 教学安排设置</span
        >
        <div class="card-header-actions">
          <el-tag type="info" disable-transitions>{{ currentSemesterLabel }}</el-tag>
          <el-select
            :model-value="selectedCourseId"
            placeholder="请选择课程"
            filterable
            clearable
            class="course-select"
            @update:model-value="handleCourseChange"
          >
            <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id">
              <span>{{ c.name }}</span>
              <span class="course-code-hint">{{ c.code }}</span>
            </el-option>
          </el-select>
          <el-dropdown @command="(command) => emit('export', command)">
            <el-button :loading="exporting">
              <el-icon><Download /></el-icon> 导出Excel<el-icon class="el-icon--right"
                ><ArrowDown
              /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="current" :disabled="!selectedCourseId">
                  导出当前科目
                </el-dropdown-item>
                <el-dropdown-item command="all">导出全部科目</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </template>

    <!-- 课时设置 -->
    <div v-if="selectedCourseId" class="hour-settings">
      <span class="hour-settings-title">课时要求</span>
      <div v-for="type in personnelTypes" :key="type.key" class="hour-setting-item">
        <span class="type-label">{{ type.label }}</span>
        <span class="setting-field">
          <span class="field-label">标准</span>
          <el-input-number
            v-model="hourSettings[type.key].standard"
            :min="0"
            :max="40"
            :step="1"
            controls-position="right"
            size="small"
            class="filter-xs"
          />
        </span>
        <span class="setting-field">
          <span class="field-label">最大</span>
          <el-input-number
            v-model="hourSettings[type.key].max"
            :min="0"
            :max="40"
            :step="1"
            controls-position="right"
            size="small"
            class="filter-xs"
          />
        </span>
      </div>
      <el-button type="primary" class="hour-save-btn" :loading="savingSettings" @click="handleSave">
        <el-icon><Check /></el-icon> 确定
      </el-button>
    </div>
    <!-- 未选课程时展示父组件传入的课程安排概览 -->
    <div v-else-if="$slots.default" class="overview-slot">
      <slot />
    </div>
  </el-card>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { getHourSettings, saveHourSettings } from '../../../api/teachingArrange';

const props = defineProps({
  currentSemesterLabel: { type: String, default: '' },
  allCourses: { type: Array, default: () => [] },
  selectedCourseId: { type: [Number, String], default: null },
  exporting: { type: Boolean, default: false },
});

const emit = defineEmits(['update:selectedCourseId', 'course-change', 'export']);

const personnelTypes = [
  { key: 'fullTime', label: '专职' },
  { key: 'partTime', label: '兼职' },
  { key: 'external', label: '外聘' },
];

const defaultHourSettings = {
  fullTime: { standard: 16, max: 20 },
  partTime: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
};

const hourSettings = reactive({
  fullTime: { standard: 16, max: 20 },
  partTime: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
});

const savingSettings = ref(false);

async function loadHourSettings(courseId) {
  Object.assign(hourSettings, JSON.parse(JSON.stringify(defaultHourSettings)));
  if (!courseId) return;
  try {
    const res = await getHourSettings({ courseId });
    if (res.data) {
      const d = res.data;
      if (d.fullTime) hourSettings.fullTime = { ...d.fullTime };
      if (d.partTime) hourSettings.partTime = { ...d.partTime };
      if (d.external) hourSettings.external = { ...d.external };
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('加载课时设置失败:', e);
    }
  }
}

async function handleSave() {
  savingSettings.value = true;
  try {
    await saveHourSettings({
      courseId: props.selectedCourseId,
      hourSettings,
    });
    ElMessage.success('课时要求已保存');
  } catch (e) {
    ElMessage.error('保存失败');
    if (import.meta.env.DEV) {
      console.error('保存课时设置失败:', e);
    }
  } finally {
    savingSettings.value = false;
  }
}

function handleCourseChange(courseId) {
  emit('update:selectedCourseId', courseId);
  emit('course-change', courseId);
  loadHourSettings(courseId);
}

// 父组件外部变更课程（如概览卡片点选）时同步加载课时设置；首次挂载不触发
watch(
  () => props.selectedCourseId,
  (id, old) => {
    if (old === undefined || id === old) return;
    if (id) loadHourSettings(id);
  }
);

// 暴露 hourSettings 供父组件读取
defineExpose({ hourSettings });
</script>

<style scoped>
.settings-card {
  margin-bottom: var(--space-4);
}
/* 未选课程时卡片体无内容，隐藏 body 避免 el-card 自带内边距留白，卡片只剩头部一行 */
.settings-card--compact :deep(.el-card__body) {
  display: none;
}
/* 概览嵌入卡片体内后去除其自身底部外边距，避免卡片底部多余留白 */
.overview-slot :deep(.overview-section) {
  margin-bottom: 0;
}
.hour-settings {
  display: flex;
  flex-wrap: wrap; /* 宽屏一行展示，窄屏自动折行适配移动端 */
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) 0 var(--space-2);
}
.hour-settings-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}
.hour-setting-item {
  flex: 1 1 260px; /* 三块均分剩余宽度，间隙随容器自适应拉伸 */
  min-width: 260px;
  display: flex;
  align-items: center;
  justify-content: center; /* 标签与输入区居中对称，间隙均匀无大空洞 */
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-subtle); /* 仅用底色区分区块，无边框、无 hover 外框，视觉更安静 */
  border-radius: var(--radius-sm);
}
.type-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}
.setting-field {
  display: flex;
  align-items: center;
  gap: var(--space-2); /* 标准/最大两组间距加大，视觉更舒展 */
}
.field-label {
  font-size: 12px;
  color: var(--text-regular);
  white-space: nowrap;
}
.hour-save-btn {
  margin-left: auto; /* 卡片填满后按钮靠右；折行后仍保持右对齐 */
}
.course-select {
  width: 220px;
}
.course-code-hint {
  color: var(--text-secondary);
  font-size: 12px;
  margin-left: var(--space-2);
}
</style>
