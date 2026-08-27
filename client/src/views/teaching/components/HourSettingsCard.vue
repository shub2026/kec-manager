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
      <!-- 折叠头：课时表单默认收起，点击展开/收起，收起时展示当前配置摘要 -->
      <button
        type="button"
        class="hour-toggle"
        :aria-expanded="!hoursCollapsed"
        @click="toggleHours"
      >
        <span class="hour-settings-title">课时要求</span>
        <span v-if="hoursCollapsed" class="hour-summary">{{ hourSummary }}</span>
        <el-icon class="hour-toggle-icon"
          ><ArrowUp v-if="!hoursCollapsed" /><ArrowDown v-else
        /></el-icon>
      </button>
      <div v-show="!hoursCollapsed" class="hour-settings-body">
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
        <el-button
          type="primary"
          class="hour-save-btn"
          :loading="savingSettings"
          @click="handleSave"
        >
          <el-icon><Check /></el-icon> 确定
        </el-button>
      </div>
    </div>
    <!-- 未选课程时展示父组件传入的课程安排概览 -->
    <div v-else-if="$slots.default" class="overview-slot">
      <slot />
    </div>
  </el-card>
</template>

<script setup>
import { reactive, ref, watch, computed } from 'vue';
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

// ── 课时表单默认收起（全端），需要时点击标题展开 ──
const hoursCollapsed = ref(true);

// 收起时的一行摘要：专职 16/20 · 兼职 12/16 · 外聘 12/16
const hourSummary = computed(() =>
  personnelTypes
    .map((t) => `${t.label} ${hourSettings[t.key].standard}/${hourSettings[t.key].max}`)
    .join(' · ')
);

function toggleHours() {
  hoursCollapsed.value = !hoursCollapsed.value;
}

async function loadHourSettings(courseId) {
  Object.assign(hourSettings, JSON.parse(JSON.stringify(defaultHourSettings)));
  try {
    // 未选课程时加载全局配置（后端无 course_id 返回全局键），
    // 避免批量排课时卡片静默显示前端默认值误导用户
    const res = await getHourSettings(courseId ? { courseId } : {});
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

// 首次挂载时加载全局课时配置（无课程选中时的展示基准）
loadHourSettings(null);

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
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-1) 0 var(--space-2);
}
/* 折叠头：全端可点，整行作为触控目标 */
.hour-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  margin: 0 calc(-1 * var(--space-2));
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
  transition: background-color 0.2s;
}
.hour-toggle:hover {
  background: var(--bg-subtle);
}
.hour-summary {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hour-toggle-icon {
  display: block;
  flex: none;
  color: var(--text-secondary);
}
.hour-settings-body {
  display: flex;
  flex-wrap: wrap; /* 宽屏一行展示，窄屏自动折行适配移动端 */
  align-items: center;
  gap: var(--space-3);
}
.hour-settings-title {
  font-size: var(--font-size-body);
  font-weight: var(--fw-semibold);
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
  font-weight: var(--fw-semibold);
  font-size: var(--font-size-body-sm);
  color: var(--text-primary);
  white-space: nowrap;
}
.setting-field {
  display: flex;
  align-items: center;
  gap: var(--space-2); /* 标准/最大两组间距加大，视觉更舒展 */
}
.field-label {
  font-size: var(--font-size-caption);
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
  font-size: var(--font-size-caption);
  margin-left: var(--space-2);
}

/* 移动端（≤768px）：课时要求区块纵向排列，人员类型标签独占一行，
   标准/最大两组输入弹性均分并拉满宽度，避免固定 80px 输入框居中造成拥挤 */
@media (max-width: 768px) {
  .hour-settings-body {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .hour-setting-item {
    flex: 1 1 100%;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: flex-start;
    padding: var(--space-2);
  }
  .type-label {
    flex: 1 1 100%;
    text-align: left;
  }
  .setting-field {
    flex: 1 1 0;
    min-width: 0;
  }
  /* 提升特异性压过全局工具类 .filter-xs 的 80px 固定宽度 */
  .hour-setting-item .filter-xs {
    width: 100%;
    min-width: 0;
    flex: 1;
  }
}

/* 超窄屏（≤480px）：标准/最大改纵向堆叠，每组标签+输入框全宽，触控目标更大 */
@media (max-width: 480px) {
  .setting-field {
    flex: 1 1 100%;
  }
  .hour-save-btn {
    width: 100%;
    margin-left: 0;
  }
}
</style>
