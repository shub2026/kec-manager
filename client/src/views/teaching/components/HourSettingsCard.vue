<template>
  <el-card class="settings-card">
    <template #header>
      <div class="card-header">
        <span
          ><el-icon><Setting /></el-icon> 教学安排设置</span
        >
        <div class="card-header-actions">
          <el-tag type="info">{{ currentSemesterLabel }}</el-tag>
          <el-select
            :model-value="selectedCourseId"
            placeholder="请选择课程"
            filterable
            clearable
            style="width: 220px"
            @update:model-value="handleCourseChange"
          >
            <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id">
              <span>{{ c.name }}</span>
              <span style="color: #999; font-size: 12px; margin-left: 8px">{{ c.code }}</span>
            </el-option>
          </el-select>
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
            style="width: 80px"
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
            style="width: 80px"
          />
        </span>
      </div>
      <el-button type="primary" size="small" :loading="savingSettings" @click="handleSave">
        <el-icon><Check /></el-icon> 确定
      </el-button>
    </div>
    <el-empty v-else description="请选择课程查看教学安排" />
  </el-card>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getHourSettings, saveHourSettings } from '../../../api/teachingArrange';

const props = defineProps({
  currentSemesterLabel: { type: String, default: '' },
  allCourses: { type: Array, default: () => [] },
  selectedCourseId: { type: [Number, String, null], default: null },
});

const emit = defineEmits(['update:selectedCourseId', 'course-change']);

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

// 暴露 hourSettings 供父组件读取
defineExpose({ hourSettings });
</script>

<style scoped>
.settings-card {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.card-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.hour-settings {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}
.hour-settings-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
}
.hour-setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: #f5f7fa;
  border-radius: 4px;
}
.type-label {
  font-weight: bold;
  font-size: 13px;
  color: #303133;
}
.setting-field {
  display: flex;
  align-items: center;
  gap: 4px;
}
.field-label {
  font-size: 12px;
  color: #606266;
}
</style>
