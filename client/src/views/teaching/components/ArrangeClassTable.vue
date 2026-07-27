<template>
  <div>
    <el-table
      v-loading="loading"
      :data="paginatedClassList"
      stripe
      row-key="classId"
      :row-class-name="tableRowClassName"
      class="adaptive-table"
    >
      <el-table-column type="index" label="#" width="50" />
      <el-table-column prop="className" label="班级名称" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span>{{ row.className }}</span>
          <el-tooltip
            v-if="row.combinationId != null"
            :content="
              row.partnerClassNames ? `合班伙伴：${row.partnerClassNames}` : '已标记合班教学'
            "
            placement="top"
            effect="light"
          >
            <el-icon class="combined-icon" :size="16"><Connection /></el-icon>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="collegeName" label="学院" min-width="100" show-overflow-tooltip />
      <el-table-column prop="majorName" label="专业" min-width="100" show-overflow-tooltip />
      <el-table-column
        prop="trainingLevelName"
        label="培养层次"
        min-width="80"
        show-overflow-tooltip
      />
      <el-table-column label="入学年份" min-width="80" align="center">
        <template #default="{ row }">{{ row.enrollmentYear }}</template>
      </el-table-column>
      <el-table-column label="年级" min-width="60" align="center">
        <template #default="{ row }">{{ row.grade }}</template>
      </el-table-column>
      <el-table-column label="在读学期" min-width="80" align="center">
        <template #default="{ row }">第{{ row.currentSemester }}学期</template>
      </el-table-column>
      <el-table-column label="人数" min-width="60" align="center">
        <template #default="{ row }">{{ row.studentCount }}</template>
      </el-table-column>
      <el-table-column label="周课时" min-width="70" align="center">
        <template #default="{ row }">{{ row.weeklyHours }}</template>
      </el-table-column>
      <el-table-column label="教材" min-width="160" class-name="textbook-col">
        <template #default="{ row }">
          <div v-if="row.textbooks?.length" class="textbook-tags">
            <el-tag
              v-for="tb in row.textbooks"
              :key="tb.id"
              size="small"
              type="info"
              class="tag-item"
              disable-transitions
              >{{ tb.title }}</el-tag
            >
          </div>
          <span v-else class="text-muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="任课教师" min-width="160">
        <template #default="{ row }">
          <div
            class="teacher-cell"
            :class="{
              'has-teacher': row.assignment,
              'no-teacher': !row.assignment,
              'is-readonly': historicalReadOnly,
            }"
            @click="emit('select-teacher', row)"
          >
            <template v-if="row.assignment">
              <el-tag
                :type="
                  row.assignment.isLocked ? 'success' : row.assignment.isAuto ? 'info' : 'primary'
                "
                size="small"
                :closable="!historicalReadOnly"
                disable-transitions
                @close.stop="emit('remove-assignment', row)"
              >
                <el-icon v-if="row.assignment.isLocked" class="locked-icon" :size="12"
                  ><Lock
                /></el-icon>
                {{ row.assignment.teacherName }}
              </el-tag>
              <!-- 锁定/解锁按钮：仅自动安排显示 -->
              <el-tooltip
                v-if="row.assignment.isAuto && !historicalReadOnly"
                :content="
                  row.assignment.isLocked
                    ? '点击解锁（解锁后重新排课可覆盖）'
                    : '点击锁定（锁定后重新排课不受影响）'
                "
                placement="top"
                effect="light"
              >
                <el-icon
                  class="lock-toggle-icon"
                  :class="{ 'is-locked': row.assignment.isLocked }"
                  :size="14"
                  @click.stop="emit('toggle-lock', row)"
                >
                  <Lock v-if="row.assignment.isLocked" />
                  <Unlock v-else />
                </el-icon>
              </el-tooltip>
              <span v-if="!historicalReadOnly && !row.assignment.isLocked" class="replace-hint">
                <el-icon :size="12"><EditPen /></el-icon>
                更换
              </span>
              <span v-else-if="!historicalReadOnly && row.assignment.isLocked" class="locked-hint">
                已锁定
              </span>
              <span v-else class="readonly-hint">
                <el-icon :size="12"><Lock /></el-icon>
                只读
              </span>
            </template>
            <template v-else>
              <template v-if="historicalReadOnly">
                <el-icon :size="14" class="cell-hint-icon"><Lock /></el-icon>
                <span class="text-muted">只读</span>
              </template>
              <template v-else>
                <el-icon :size="14" class="cell-hint-icon"><Plus /></el-icon>
                <span class="text-placeholder">点击安排</span>
              </template>
            </template>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[20, 50, 100]"
        :total="classList.length"
        layout="total, sizes, prev, pager, next"
        background
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
// Lock 已全局注册，Unlock/Connection 未注册需显式导入
import { Connection, Lock, Unlock } from '@element-plus/icons-vue';

const props = defineProps({
  /** 经父页面筛选后的班级列表，分页由本组件内部完成 */
  classList: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  historicalReadOnly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['select-teacher', 'remove-assignment', 'toggle-lock']);

// P-04: 客户端分页
const currentPage = ref(1);
const pageSize = ref(20);

const paginatedClassList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return props.classList.slice(start, start + pageSize.value);
});

watch(
  () => props.classList,
  () => {
    currentPage.value = 1;
  }
);

function tableRowClassName({ row }) {
  return row.assignment ? '' : 'unassigned-row';
}
</script>

<style scoped>
.combined-icon {
  margin-left: var(--space-1);
  vertical-align: middle;
  color: var(--brand-indigo);
  cursor: help;
}
.teacher-cell {
  cursor: pointer;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  /* flex:1 撑满父级 .cell（flex容器），负边距消除父级 padding 点击死区 */
  flex: 1;
  margin: -4px -10px;
  padding: var(--space-1) 10px;
  border-radius: var(--radius-sm);
  transition: background-color 0.15s ease;
}
.teacher-cell:hover {
  background-color: var(--el-color-primary-light-9, #e8f3fe);
}
.teacher-cell.no-teacher:hover .text-placeholder {
  color: var(--el-color-primary);
}
.teacher-cell.is-readonly {
  cursor: not-allowed;
}
.teacher-cell.is-readonly:hover {
  background-color: transparent;
}
.readonly-hint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.replace-hint {
  display: none;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--el-color-primary);
  white-space: nowrap;
}
.teacher-cell.has-teacher:hover .replace-hint {
  display: inline-flex;
}
.text-placeholder {
  color: var(--text-placeholder);
  font-size: 12px;
}
.textbook-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag-item {
  /* 单个长书名超出列宽时省略显示 */
  max-width: 100%;
  overflow: hidden;
}
.tag-item :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.unassigned-row) {
  background-color: var(--brand-danger-soft) !important;
}
.adaptive-table :deep(.el-table__header th .cell) {
  white-space: nowrap;
}
.adaptive-table :deep(.el-table__body td .cell) {
  white-space: nowrap;
}
/* 教材列允许多 TAG 换行（覆盖上方 nowrap，需更高优先级选择器） */
.adaptive-table :deep(.el-table__body td.textbook-col .cell) {
  white-space: normal;
}
.cell-hint-icon {
  margin-right: 4px;
  opacity: 0.5;
}
.lock-toggle-icon {
  cursor: pointer;
  color: var(--text-placeholder);
  transition: color 0.15s ease;
  flex-shrink: 0;
}
.lock-toggle-icon:hover {
  color: var(--el-color-primary);
}
.lock-toggle-icon.is-locked {
  color: var(--el-color-success);
}
.lock-toggle-icon.is-locked:hover {
  color: var(--el-color-warning);
}
.locked-icon {
  margin-right: 2px;
  vertical-align: -1px;
}
.locked-hint {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--el-color-success);
  white-space: nowrap;
}
</style>
