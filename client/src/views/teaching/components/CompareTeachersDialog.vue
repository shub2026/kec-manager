<template>
  <el-dialog
    v-model="visible"
    title="教师任课对比"
    width="var(--dialog-width-xxl)"
    :fullscreen="isMobile"
    align-center
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="compare-tip"
      title="对比两位教师在本课程的任课班级，勾选后按名单互换"
      description="合班班级按整组联动换出；已锁定的安排不参与互换；互换后的安排标记为手动安排。"
    />

    <el-form label-width="90px" class="compare-form">
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

    <div v-if="loadError" class="compare-error">
      <el-alert type="error" :closable="false" :title="loadError" />
      <el-button size="small" class="retry-btn" @click="loadCompare">重试</el-button>
    </div>

    <div v-else-if="bothSelected" v-loading="loadingData" class="compare-columns">
      <template v-if="compareData">
        <div v-for="(side, idx) in sides" :key="side.id" class="compare-col">
          <div class="col-header">
            <span class="col-title">{{ idx === 0 ? '教师 A' : '教师 B' }}：{{ side.name }}</span>
            <span class="col-stat">
              {{ side.classCount }} 班 / {{ side.totalHours }} 课时
              <template v-if="side.lockedCount">（{{ side.lockedCount }} 班已锁定）</template>
            </span>
            <el-checkbox
              :model-value="isAllSelected(idx)"
              :indeterminate="isIndeterminate(idx)"
              :disabled="loading || unlockedIds(side).length === 0"
              class="select-all"
              @update:model-value="(v) => toggleAll(idx, v)"
            >
              全选
            </el-checkbox>
          </div>
          <el-checkbox-group v-model="selections[idx]" class="col-list">
            <div
              v-for="c in side.classes"
              :key="c.assignmentId"
              class="class-row"
              :class="{ 'is-locked': c.isLocked }"
            >
              <el-checkbox :value="c.classId" :disabled="c.isLocked || loading" />
              <div class="class-main">
                <div class="class-line">
                  <span class="class-name">{{ c.className }}</span>
                  <el-tag
                    v-if="c.isCombined"
                    size="small"
                    type="warning"
                    :title="c.partnerClassNames ? `合班伙伴：${c.partnerClassNames}` : ''"
                  >
                    合班{{ c.combinationNo != null ? ` ${c.combinationNo} 组` : '' }}
                  </el-tag>
                  <el-tag v-if="c.isLocked" size="small" type="info">已锁定</el-tag>
                </div>
                <div class="class-sub">
                  {{ c.weeklyHours }} 课时
                  <template v-if="c.collegeName || c.majorName">
                    · {{ [c.collegeName, c.majorName].filter(Boolean).join(' / ') }}
                  </template>
                  <template v-if="c.textbookTitles && c.textbookTitles.length">
                    · {{ c.textbookTitles.join('、') }}
                  </template>
                </div>
              </div>
            </div>
          </el-checkbox-group>
          <el-empty v-if="!side.classes.length" description="本课程暂无任课安排" :image-size="60" />
          <div v-if="side.classes.length" class="col-footer">
            已勾选 {{ selections[idx].length }} / {{ side.classCount }} 班
          </div>
        </div>
      </template>
    </div>

    <el-empty v-else description="请选择两位教师开始对比" :image-size="80" />

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" :disabled="!canConfirm" @click="handleConfirm">
        互换所选班级
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useResponsive } from '../../../composables/useResponsive';
import { compareTeacherAssignments } from '../../../api/teachingArrange';

defineProps({
  /** 本课程教师列表（getCourseTeachers 数据） */
  teacherList: {
    type: Array,
    default: () => [],
  },
  /** 互换请求进行中标记（父级发起交换时禁用勾选与确认） */
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
const compareData = ref(null);
const loadingData = ref(false);
const loadError = ref('');
const selections = ref([[], []]);

// 请求序列号：教师快速切换时丢弃过期响应
let loadSeq = 0;

const scope = ref({ courseId: null, semester: null });

const bothSelected = computed(() => teacherIdA.value != null && teacherIdB.value != null);
const sides = computed(() =>
  compareData.value ? [compareData.value.teacherA, compareData.value.teacherB] : []
);
const canConfirm = computed(
  () =>
    bothSelected.value &&
    !loadingData.value &&
    (selections.value[0].length > 0 || selections.value[1].length > 0)
);

// 全选只覆盖未锁定班级（锁定行勾选框禁用，不参与互换）
function unlockedIds(side) {
  return side.classes.filter((c) => !c.isLocked).map((c) => c.classId);
}

function isAllSelected(idx) {
  const side = sides.value[idx];
  if (!side) return false;
  const unlocked = unlockedIds(side);
  return unlocked.length > 0 && unlocked.every((id) => selections.value[idx].includes(id));
}

function isIndeterminate(idx) {
  return selections.value[idx].length > 0 && !isAllSelected(idx);
}

function toggleAll(idx, val) {
  const side = sides.value[idx];
  if (!side) return;
  selections.value[idx] = val ? unlockedIds(side) : [];
}

watch([teacherIdA, teacherIdB], () => {
  selections.value = [[], []];
  compareData.value = null;
  loadError.value = '';
  if (bothSelected.value) loadCompare();
});

async function loadCompare() {
  const seq = ++loadSeq;
  loadingData.value = true;
  loadError.value = '';
  try {
    const res = await compareTeacherAssignments({
      courseId: scope.value.courseId,
      semester: scope.value.semester,
      teacherIdA: teacherIdA.value,
      teacherIdB: teacherIdB.value,
    });
    if (seq !== loadSeq) return;
    compareData.value = res.data || null;
  } catch (e) {
    if (seq !== loadSeq) return;
    compareData.value = null;
    loadError.value = e?.response?.data?.message || '加载对比数据失败，请稍后重试';
  } finally {
    if (seq === loadSeq) loadingData.value = false;
  }
}

function open({ courseId, semester } = {}) {
  scope.value = { courseId, semester };
  teacherIdA.value = null;
  teacherIdB.value = null;
  compareData.value = null;
  loadError.value = '';
  selections.value = [[], []];
  visible.value = true;
}

function close() {
  visible.value = false;
}

function handleClosed() {
  teacherIdA.value = null;
  teacherIdB.value = null;
  compareData.value = null;
  loadError.value = '';
  selections.value = [[], []];
}

function handleConfirm() {
  if (!canConfirm.value) return;
  if (!selections.value[0].length && !selections.value[1].length) {
    ElMessage.warning('请先勾选要互换的班级');
    return;
  }
  emit('confirm', {
    teacherIdA: teacherIdA.value,
    teacherIdB: teacherIdB.value,
    classIdsA: [...selections.value[0]],
    classIdsB: [...selections.value[1]],
  });
}

defineExpose({ open, close });
</script>

<style scoped>
.compare-tip {
  margin-bottom: var(--space-4);
}
.compare-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: var(--space-4);
  margin-bottom: var(--space-2);
}
.teacher-select {
  width: 100%;
  max-width: 420px;
}
.compare-error {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}
.retry-btn {
  align-self: flex-start;
}
.compare-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  min-height: 200px;
}
.compare-col {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  overflow: hidden;
}
.col-header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--el-fill-color-light);
  font-size: var(--font-size-body-sm);
}
.col-title {
  font-weight: var(--fw-semibold);
}
.col-stat {
  color: var(--el-text-color-secondary);
}
.select-all {
  margin-left: auto;
}
.col-list {
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow-y: auto;
  padding: var(--space-2) var(--space-3);
}
.class-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}
.class-row:last-child {
  border-bottom: none;
}
.class-row.is-locked .class-name {
  color: var(--el-text-color-secondary);
}
.class-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.class-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  line-height: 1.5;
}
.class-name {
  font-size: var(--font-size-body-sm);
}
.class-sub {
  font-size: var(--font-size-caption);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.col-footer {
  padding: var(--space-1) var(--space-3) var(--space-2);
  font-size: var(--font-size-caption);
  color: var(--el-text-color-secondary);
}
@media (max-width: 768px) {
  .compare-columns {
    grid-template-columns: 1fr;
  }
  .compare-form {
    grid-template-columns: 1fr;
  }
}
</style>
