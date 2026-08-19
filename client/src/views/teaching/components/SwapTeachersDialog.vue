<template>
  <el-dialog
    v-model="visible"
    title="交换教师班级"
    width="var(--dialog-width-lg)"
    :fullscreen="isMobile"
    align-center
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="swap-tip"
      title="将两位教师在本课程的全部班级安排互换"
      description="已锁定的安排不参与交换；交换后的安排标记为手动安排。单教材开关冲突时将被拦截。"
    />

    <el-form label-width="90px" class="swap-form">
      <el-form-item label="教师 A">
        <el-select
          v-model="teacherIdA"
          placeholder="选择教师"
          filterable
          clearable
          class="teacher-select"
        >
          <el-option
            v-for="t in teacherList"
            :key="t.id"
            :label="t.name"
            :value="t.id"
            :disabled="t.id === teacherIdB"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="教师 B">
        <el-select
          v-model="teacherIdB"
          placeholder="选择教师"
          filterable
          clearable
          class="teacher-select"
        >
          <el-option
            v-for="t in teacherList"
            :key="t.id"
            :label="t.name"
            :value="t.id"
            :disabled="t.id === teacherIdA"
          />
        </el-select>
      </el-form-item>
    </el-form>

    <!-- 双方当前安排预览（从页面班级数据聚合） -->
    <div v-if="statsA || statsB" class="swap-preview">
      <div v-if="statsA" class="preview-item">
        <span class="preview-name">{{ nameA }}</span>
        <span>已安排 {{ statsA.count }} 班 / {{ statsA.hours }} 课时</span>
        <span v-if="statsA.locked" class="preview-locked">
          （其中 {{ statsA.locked }} 班已锁定，不参与交换）
        </span>
      </div>
      <div v-if="statsB" class="preview-item">
        <span class="preview-name">{{ nameB }}</span>
        <span>已安排 {{ statsB.count }} 班 / {{ statsB.hours }} 课时</span>
        <span v-if="statsB.locked" class="preview-locked">
          （其中 {{ statsB.locked }} 班已锁定，不参与交换）
        </span>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" :disabled="!canConfirm" @click="handleConfirm">
        确认交换
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useResponsive } from '../../../composables/useResponsive';

const props = defineProps({
  /** 本课程教师列表（getCourseTeachers 数据） */
  teacherList: {
    type: Array,
    default: () => [],
  },
  /** 本课程班级列表（含 assignment，用于聚合预览） */
  classList: {
    type: Array,
    default: () => [],
  },
  /** 交换请求进行中标记 */
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['confirm']);

const { isMobile } = useResponsive();

const visible = ref(false);
const teacherIdA = ref(null);
const teacherIdB = ref(null);

const canConfirm = computed(
  () =>
    teacherIdA.value != null && teacherIdB.value != null && teacherIdA.value !== teacherIdB.value
);

const nameA = computed(() => props.teacherList.find((t) => t.id === teacherIdA.value)?.name || '');
const nameB = computed(() => props.teacherList.find((t) => t.id === teacherIdB.value)?.name || '');

// 按教师聚合当前课程内安排：班级数 / 周课时 / 锁定班数
function statsFor(teacherId) {
  if (teacherId == null) return null;
  const rows = props.classList.filter((c) => c.assignment?.teacherId === teacherId);
  return {
    count: rows.length,
    hours: rows.reduce((sum, c) => sum + (c.weeklyHours || 0), 0),
    locked: rows.filter((c) => c.assignment.isLocked).length,
  };
}

const statsA = computed(() => statsFor(teacherIdA.value));
const statsB = computed(() => statsFor(teacherIdB.value));

function open() {
  teacherIdA.value = null;
  teacherIdB.value = null;
  visible.value = true;
}

function close() {
  visible.value = false;
}

function handleClosed() {
  teacherIdA.value = null;
  teacherIdB.value = null;
}

function handleConfirm() {
  if (!canConfirm.value) return;
  emit('confirm', { teacherIdA: teacherIdA.value, teacherIdB: teacherIdB.value });
}

defineExpose({ open, close });
</script>

<style scoped>
.swap-tip {
  margin-bottom: var(--space-4);
}
.swap-form {
  margin-bottom: var(--space-2);
}
.teacher-select {
  width: 100%;
  max-width: 320px;
}
.swap-preview {
  padding: var(--space-2) var(--space-3);
  background: var(--el-fill-color-light);
  border-radius: var(--el-border-radius-base);
}
.preview-item {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  font-size: var(--font-size-body-sm);
  line-height: 1.8;
}
.preview-name {
  font-weight: 600;
}
.preview-locked {
  color: var(--brand-warning-text, #e6a23c);
}
</style>
