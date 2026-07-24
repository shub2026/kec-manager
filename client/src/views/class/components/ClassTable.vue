<template>
  <div v-loading="loading">
    <el-table
      :data="classes"
      stripe
      row-key="id"
      :default-sort="{ prop: 'name', order: 'ascending' }"
      @selection-change="$emit('selection-change', $event)"
    >
      <template #empty>
        <EmptyState type="class" description="暂无班级数据" />
      </template>
      <el-table-column type="selection" width="45" />
      <el-table-column type="index" label="序号" width="60" align="center" />
      <el-table-column prop="name" label="班级名称" min-width="180" show-overflow-tooltip />
      <el-table-column label="二级学院" min-width="115" show-overflow-tooltip>
        <template #default="{ row }">{{ row.colleges?.name || '-' }}</template>
      </el-table-column>
      <el-table-column label="专业" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ row.majors?.name || '-' }}</template>
      </el-table-column>
      <el-table-column label="培养层次" min-width="100" show-overflow-tooltip>
        <template #default="{ row }">{{ row.trainingLevels?.name || '-' }}</template>
      </el-table-column>
      <el-table-column label="入学年份" min-width="85" show-overflow-tooltip>
        <template #default="{ row }">{{ row.enrollmentYear || '-' }}</template>
      </el-table-column>
      <el-table-column label="学制" min-width="55">
        <template #default="{ row }">{{ row.durationYears || '-' }}</template>
      </el-table-column>
      <el-table-column label="人数" min-width="55">
        <template #default="{ row }">{{ row.studentCount || '-' }}</template>
      </el-table-column>
      <el-table-column label="年级" min-width="75">
        <template #default="{ row }">
          <el-tag v-if="calcGrade(row)" size="small">{{ calcGrade(row) }}年级</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" min-width="80">
        <template #default="{ row }">
          <el-tag :type="getStatusType(row.status)">
            {{ getStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="合班教学" min-width="95">
        <template #default="{ row }">
          <el-tooltip
            v-if="row.isCombinedClass"
            :content="
              row.partnerClassNames
                ? `合班伙伴：${row.partnerClassNames}`
                : '已标记合班（暂无伙伴）'
            "
            placement="top"
            effect="light"
          >
            <el-tag class="combined-tag" size="small">
              <el-icon class="combined-tag-icon"><Connection /></el-icon>
              {{ row.partnerClassNames ? '合班' : '合班(无伙伴)' }}
            </el-tag>
          </el-tooltip>
          <span v-else class="combined-empty">-</span>
        </template>
      </el-table-column>
      <el-table-column label="关联类型" min-width="90">
        <template #default="{ row }">
          <el-tag :type="getRelationTypeTag(row)" size="small">
            {{ getRelationTypeText(row) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="当前方案" min-width="180">
        <template #default="{ row }">
          <div v-if="row.planMatchWarning" class="plan-warning">
            <el-tooltip :content="row.planMatchWarning" placement="top" effect="light">
              <el-tag type="warning" size="small">
                <el-icon><Warning /></el-icon>
                {{ getCurrentPlanName(row) }}
              </el-tag>
            </el-tooltip>
          </div>
          <el-tag v-else :type="getPlanTagType(row)" size="small">
            {{ getCurrentPlanName(row) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" align="center">
        <template #default="{ row }">
          <el-button size="small" :icon="Edit" circle title="编辑" @click="$emit('edit', row)" />
          <el-button
            size="small"
            :icon="Delete"
            type="danger"
            circle
            title="删除"
            @click="$emit('delete', row.id)"
          />
        </template>
      </el-table-column>
    </el-table>

    <!-- 批量操作栏 -->
    <div v-if="selectedClasses.length > 0" class="batch-operations">
      <span class="selected-count">已选择 {{ selectedClasses.length }} 个班级</span>
      <el-button type="danger" size="small" @click="$emit('batch-delete')">
        <el-icon><Delete /></el-icon> 批量删除
      </el-button>
      <el-button size="small" @click="$emit('batch-set', 'major')">
        <el-icon><Edit /></el-icon> 批量设置专业
      </el-button>
      <el-button size="small" @click="$emit('batch-set', 'college')">
        <el-icon><Edit /></el-icon> 批量设置学院
      </el-button>
      <el-button size="small" @click="$emit('batch-set', 'level')">
        <el-icon><Edit /></el-icon> 批量设置层次
      </el-button>
      <el-button size="small" @click="$emit('batch-set', 'year')">
        <el-icon><Edit /></el-icon> 批量设置入学年份
      </el-button>
      <el-button size="small" @click="$emit('batch-set', 'duration')">
        <el-icon><Edit /></el-icon> 批量设置学制
      </el-button>
      <el-button size="small" @click="$emit('batch-set', 'leftSchool')">
        <el-icon><Edit /></el-icon> 批量设置离校
      </el-button>
    </div>

    <!-- 分页 -->
    <div v-if="pagination.total > 0" class="pagination-container">
      <el-pagination
        :current-page="pagination.page"
        :page-size="pagination.pageSize"
        :page-sizes="[20, 50, 100]"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next"
        background
        @size-change="(s) => $emit('size-change', s)"
        @current-change="(p) => $emit('page-change', p)"
      />
    </div>
  </div>
</template>

<script setup>
import { Edit, Delete, Connection } from '@element-plus/icons-vue';
import EmptyState from '../../../components/EmptyState.vue';

defineProps({
  classes: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  selectedClasses: {
    type: Array,
    default: () => [],
  },
  pagination: {
    type: Object,
    required: true,
  },
  semesterInfo: {
    type: Object,
    default: null,
  },
});

defineEmits([
  'selection-change',
  'edit',
  'delete',
  'batch-delete',
  'batch-set',
  'size-change',
  'page-change',
]);

// FR3修复：直接使用后端计算的 grade 字段，消除重复公式和硬编码边界月
function calcGrade(row) {
  return row.grade ?? null;
}

function getStatusType(status) {
  if (status === 'left_school') return 'danger';
  if (status === 'active') return 'success';
  return 'info';
}

function getStatusText(status) {
  if (status === 'left_school') return '离校';
  if (status === 'active') return '在读';
  return '已毕业';
}

// 获取关联类型文本 — 使用后端 matchedPlanType 反映实际匹配方式
function getRelationTypeText(row) {
  if (row.matchedPlanType === 'custom') return '自定义';
  if (row.matchedPlanType === 'major') return '专业';
  if (row.matchedPlanType === 'level') return '层次';
  return '未关联';
}

// 获取关联类型标签样式
function getRelationTypeTag(row) {
  if (row.matchedPlanType === 'custom') return 'warning'; // 自定义方案用橙色
  if (row.matchedPlanType === 'major') return 'success'; // 专业关联用绿色
  if (row.matchedPlanType === 'level') return 'primary'; // 层次关联用蓝色
  return 'info'; // 未关联用灰色
}

function getPlanTagType(row) {
  if (row.matchedPlanType === 'custom') return 'warning'; // 自定义方案用橙色
  if (row.matchedPlanType) return 'success'; // 已关联方案用绿色
  return 'info'; // 未关联用灰色
}

function getCurrentPlanName(row) {
  // 使用后端返回的匹配方案名称
  if (row.matchedPlanName) {
    return row.matchedPlanName;
  }

  // 如果没有匹配到方案，统一显示"未关联"
  return '未关联';
}
</script>

<style scoped>
.plan-warning {
  display: inline-block;
}

.plan-warning .el-tag {
  cursor: help;
}

/* 合班标签 — 紫色，与教学安排页合班图标配色一致 */
.combined-tag {
  --el-tag-bg-color: var(--brand-indigo-soft);
  --el-tag-border-color: var(--brand-indigo-soft);
  --el-tag-text-color: var(--brand-indigo);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: help;
}

.combined-tag-icon {
  vertical-align: middle;
}
</style>
