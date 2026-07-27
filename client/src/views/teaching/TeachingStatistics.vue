<template>
  <div class="teaching-statistics">
    <PageHeader
      title="课时统计"
      subtitle="教学安排"
      description="查看本学期各教师的课时分配情况和教学统计"
    />
    <el-card>
      <!-- 汇总统计 -->
      <div v-if="statsData" class="summary-section">
        <el-row :gutter="16">
          <el-col :span="8" :xs="24" :sm="12" :md="8">
            <el-statistic title="参与教师" :value="filteredSummary.totalTeachers" suffix="人" />
          </el-col>
          <el-col :span="8" :xs="24" :sm="12" :md="8">
            <el-statistic
              title="总周课时"
              :value="filteredSummary.totalWeeklyHours"
              suffix="课时"
            />
          </el-col>
          <el-col :span="8" :xs="24" :sm="12" :md="8">
            <el-statistic title="总安排班级数" :value="filteredSummary.totalClasses" suffix="个" />
          </el-col>
        </el-row>
        <el-divider />
      </div>

      <!-- 筛选器 -->
      <div class="page-toolbar">
        <SemesterSelect v-model="semester" @change="loadStats" />
        <el-input v-model="filterName" placeholder="姓名" clearable class="filter-md" />
        <el-select v-model="filterType" placeholder="类别" clearable class="filter-sm">
          <el-option label="专职" value="full_time" />
          <el-option label="兼职" value="part_time" />
          <el-option label="外聘" value="external" />
        </el-select>
        <el-select
          v-model="filterSubject"
          placeholder="科目"
          clearable
          filterable
          class="filter-xl"
        >
          <el-option v-for="v in subjectOptions" :key="v" :label="v" :value="v" />
        </el-select>
        <el-select
          v-model="filterAffiliatedCollege"
          placeholder="归属学院"
          clearable
          filterable
          class="filter-lg"
        >
          <el-option v-for="v in affiliatedCollegeOptions" :key="v" :label="v" :value="v" />
        </el-select>
        <el-select
          v-model="filterLevel"
          placeholder="任课层次"
          clearable
          filterable
          class="filter-md"
        >
          <el-option v-for="v in levelOptions" :key="v" :label="v" :value="v" />
        </el-select>
        <el-select
          v-model="filterCollege"
          placeholder="任课学院"
          clearable
          filterable
          class="filter-md"
        >
          <el-option v-for="v in collegeOptions" :key="v" :label="v" :value="v" />
        </el-select>
        <el-button :loading="exporting" :disabled="!statsData" @click="handleExport"
          >数据导出</el-button
        >
      </div>

      <!-- 错误状态 -->
      <ListErrorState v-if="error" :message="error" @retry="loadStats" />
      <!-- 空状态 -->
      <EmptyState v-else-if="!loading && !statsData" type="generic" description="暂无数据" />
      <EmptyState
        v-else-if="!loading && statsData && filteredTeachers.length === 0"
        type="generic"
        description="暂无数据"
      />

      <!-- 教师课时统计表 -->
      <div v-if="filteredTeachers.length > 0">
        <el-table
          v-loading="loading"
          :data="pagedTeachers"
          stripe
          row-key="teacherId"
          class="stats-table"
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="expand-content">
                <div v-for="detail in row.details" :key="detail.course.id" class="course-detail">
                  <h4>{{ detail.course.name }}（周课时：{{ detail.weeklyHours }}）</h4>
                  <el-table
                    :data="detail.classes"
                    size="small"
                    border
                    class="nested-table"
                    row-key="unitKey"
                  >
                    <el-table-column label="班级" min-width="150">
                      <template #default="{ row: cls }">
                        <span>{{ cls.className }}</span>
                        <el-tag
                          v-if="cls.isCombined"
                          size="small"
                          type="success"
                          class="tag-item"
                          disable-transitions
                          >合班</el-tag
                        >
                      </template>
                    </el-table-column>
                    <el-table-column label="学院" min-width="100">
                      <template #default="{ row: cls }">
                        <el-tag
                          v-if="cls.collegeName"
                          size="small"
                          type="info"
                          disable-transitions
                          >{{ cls.collegeName }}</el-tag
                        >
                        <span v-else class="text-muted">-</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="层次" min-width="80">
                      <template #default="{ row: cls }">
                        <el-tag
                          v-if="cls.trainingLevelName"
                          size="small"
                          type="warning"
                          disable-transitions
                          >{{ cls.trainingLevelName }}</el-tag
                        >
                        <span v-else class="text-muted">-</span>
                      </template>
                    </el-table-column>
                    <el-table-column
                      prop="weeklyHours"
                      label="周课时"
                      min-width="80"
                      align="center"
                    />
                    <el-table-column label="安排方式" min-width="100" align="center">
                      <template #default="{ row: cls }">
                        <el-tag
                          :type="cls.isAuto ? 'info' : 'primary'"
                          size="small"
                          disable-transitions
                        >
                          {{ cls.isAuto ? '自动' : '手动' }}
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column label="当前教材" min-width="160">
                      <template #default="{ row: cls }">
                        <span v-if="cls.textbookName">{{ cls.textbookName }}</span>
                        <span v-else class="text-muted">-</span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column type="index" label="#" width="48" />
          <el-table-column prop="teacherName" label="姓名" width="85" />
          <el-table-column label="归属学院" width="140">
            <template #default="{ row }">
              <span>{{ row.affiliatedCollege?.name || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="人员类别" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="personnelTagType(row.personnelType)" size="small" disable-transitions>
                {{ personnelLabel(row.personnelType) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="任教科目" width="150" cell-class-name="wrap-cell">
            <template #default="{ row }">
              <el-tag
                v-for="d in row.details"
                :key="d.course.id"
                size="small"
                class="tag-item"
                disable-transitions
                >{{ d.course.name }}</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column label="任课层次" min-width="110" cell-class-name="wrap-cell">
            <template #default="{ row }">
              <el-tag
                v-for="l in row.trainingLevelList"
                :key="l.id"
                size="small"
                type="warning"
                class="tag-item"
                disable-transitions
                >{{ l.name }}</el-tag
              >
              <span v-if="!row.trainingLevelList?.length" class="text-muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="任课学院" min-width="210" cell-class-name="wrap-cell">
            <template #default="{ row }">
              <el-tag
                v-for="c in row.collegeList"
                :key="c.id"
                size="small"
                type="info"
                class="tag-item"
                disable-transitions
                >{{ c.name }}</el-tag
              >
              <span v-if="!row.collegeList?.length" class="text-muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="教材数" width="90" align="center">
            <template #default="{ row }">
              <el-tooltip
                v-if="row.textbookNames?.length"
                :content="row.textbookNames.join('、')"
                placement="top"
              >
                <span class="textbook-count">{{ row.textbookCount }}</span>
              </el-tooltip>
              <span v-else>{{ row.textbookCount || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="班级数" width="100" align="center">
            <template #default="{ row }">
              <span>{{ row.totalClassCount }}</span>
              <el-tooltip
                v-if="combinedUnitsOf(row) > 0"
                :content="`含 ${combinedUnitsOf(row)} 个合班教学单元`"
                placement="top"
              >
                <el-tag size="small" type="primary" class="combined-tag" disable-transitions
                  >合{{ combinedUnitsOf(row) }}</el-tag
                >
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column
            label="总周课时"
            width="110"
            align="center"
            sortable
            :sort-method="(a, b) => a.totalWeeklyHours - b.totalWeeklyHours"
          >
            <template #default="{ row }">
              <span class="hours-value">{{ row.totalWeeklyHours }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination-container">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :total="filteredTeachers.length"
            :page-sizes="[20, 50, 100]"
            layout="total, sizes, prev, pager, next"
            background
            @size-change="currentPage = 1"
          />
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { getTeachingStatistics } from '../../api/teachingArrange';
import { useSettingsStore } from '../../stores/settings';
import { exportStatistics } from '../../api/export';
import { downloadBlob } from '../../utils/download';
import { personnelLabel, personnelTagType } from '../../utils/personnel';
import { useDebounceFn } from '../../composables/useDebounce';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import SemesterSelect from '../../components/SemesterSelect.vue';

defineOptions({ name: 'TeachingStatistics' });

const settingsStore = useSettingsStore();
const semester = ref('');
const statsData = ref(null);
const loading = ref(false);
// 列表加载错误状态，供 ListErrorState 占位
const error = ref(null);
const exporting = ref(false);

// 筛选器
const filterName = ref('');
const debouncedFilterName = ref('');
const filterType = ref('');
const filterSubject = ref('');
const filterCollege = ref('');
const filterLevel = ref('');
const filterAffiliatedCollege = ref('');

// 防抖：姓名搜索200ms后触发筛选
const applyFilter = useDebounceFn((val) => {
  debouncedFilterName.value = val;
}, 200);
watch(filterName, (val) => applyFilter(val));

const teacherList = computed(() => statsData.value?.teachers || []);

const subjectOptions = computed(() => {
  const set = new Set();
  for (const t of teacherList.value) {
    for (const d of t.details || []) {
      if (d.course?.name) set.add(d.course.name);
    }
  }
  return [...set].sort();
});

const collegeOptions = computed(() => {
  const set = new Set();
  for (const t of teacherList.value) {
    for (const c of t.collegeList || []) {
      if (c.name) set.add(c.name);
    }
  }
  return [...set].sort();
});

const levelOptions = computed(() => {
  const set = new Set();
  for (const t of teacherList.value) {
    for (const l of t.trainingLevelList || []) {
      if (l.name) set.add(l.name);
    }
  }
  return [...set].sort();
});

const affiliatedCollegeOptions = computed(() => {
  const set = new Set();
  for (const t of teacherList.value) {
    if (t.affiliatedCollege?.name) set.add(t.affiliatedCollege.name);
  }
  return [...set].sort();
});

const filteredTeachers = computed(() => {
  return teacherList.value.filter((t) => {
    if (debouncedFilterName.value && !t.teacherName.includes(debouncedFilterName.value))
      return false;
    if (filterType.value && t.personnelType !== filterType.value) return false;
    if (filterSubject.value) {
      const hasSubject = (t.details || []).some((d) => d.course?.name === filterSubject.value);
      if (!hasSubject) return false;
    }
    if (filterCollege.value) {
      const hasCollege = (t.collegeList || []).some((c) => c.name === filterCollege.value);
      if (!hasCollege) return false;
    }
    if (filterLevel.value) {
      const hasLevel = (t.trainingLevelList || []).some((l) => l.name === filterLevel.value);
      if (!hasLevel) return false;
    }
    if (filterAffiliatedCollege.value) {
      if (t.affiliatedCollege?.name !== filterAffiliatedCollege.value) return false;
    }
    return true;
  });
});

// 前端分页：外层教师统计表按页切片渲染，避免大量教师行一次性渲染卡顿（嵌套展开表不受影响）
const currentPage = ref(1);
const pageSize = ref(20);
const pagedTeachers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredTeachers.value.slice(start, start + pageSize.value);
});
// 筛选条件变化后回到第一页，避免停留在越界页码
watch(filteredTeachers, () => {
  currentPage.value = 1;
});

const filteredSummary = computed(() => {
  const list = filteredTeachers.value;
  return {
    totalTeachers: list.length,
    totalWeeklyHours: list.reduce((sum, t) => sum + t.totalWeeklyHours, 0),
    totalClasses: list.reduce((sum, t) => sum + t.totalClassCount, 0),
  };
});

// 统计某教师行包含的合班教学单元数（用于「班级数」列标记，合班改变的是教学班口径）
function combinedUnitsOf(row) {
  let n = 0;
  for (const d of row.details || []) {
    for (const c of d.classes || []) {
      if (c.isCombined) n++;
    }
  }
  return n;
}

async function loadSemester() {
  try {
    // P-05 修复：复用 settingsStore 缓存，避免重复 API 请求
    await settingsStore.load();
    const semValue = settingsStore.currentSemesterValue();
    if (semValue) {
      semester.value = semValue;
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('获取学期失败:', e);
    }
  }
}

async function loadStats() {
  if (!semester.value) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await getTeachingStatistics({ semester: semester.value });
    statsData.value = res.data || null;
  } catch (e) {
    error.value = e?.response?.data?.message || '统计数据加载失败，请稍后重试';
    if (import.meta.env.DEV) {
      console.error('加载统计数据失败:', e);
    }
  } finally {
    loading.value = false;
  }
}

async function handleExport() {
  if (!semester.value) return ElMessage.warning('请先设置当前学期');
  exporting.value = true;
  try {
    const params = { semester: semester.value };

    // 添加筛选条件
    if (filterName.value) params.name = filterName.value;
    if (filterType.value) params.type = filterType.value;
    if (filterSubject.value) params.subject = filterSubject.value;
    if (filterAffiliatedCollege.value) params.affiliatedCollege = filterAffiliatedCollege.value;
    if (filterLevel.value) params.level = filterLevel.value;
    if (filterCollege.value) params.college = filterCollege.value;

    const response = await exportStatistics(params);
    downloadBlob(response, `课时统计_${semester.value}.xlsx`);
    ElMessage.success('导出成功');
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('导出失败:', error);
    }
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
}

onMounted(async () => {
  await loadSemester();
  await loadStats();
});
</script>

<style scoped>
.summary-section {
  margin-bottom: var(--space-2);
}
.expand-content {
  padding: var(--space-2) var(--space-4);
}
.expand-content :deep(.el-table .cell) {
  min-height: 26px;
  padding: 2px var(--space-2);
}
.expand-content :deep(.el-table th .cell) {
  min-height: 28px;
  padding: 2px var(--space-2);
}
/* 内嵌表格禁用行hover高亮，避免与外层表格hover效果叠加造成视觉干扰
   .expand-content 类带来更高特异性，无需 !important 即可覆盖全局规则 */
.expand-content :deep(.el-table tbody tr:hover > td) {
  background: inherit;
}
.course-detail h4 {
  margin: 6px 0 2px;
  font-size: 13px;
  color: var(--text-primary);
}
.tag-item {
  margin: 2px;
}
.text-muted {
  color: var(--text-secondary);
}
.hours-value {
  font-weight: bold;
  font-size: 16px;
}
.combined-tag {
  margin-left: var(--space-1);
  vertical-align: middle;
  cursor: default;
}
.textbook-count {
  cursor: default;
}
/* 标签密集列允许换行，避免学院/科目名称被单元格 nowrap 裁切 */
.teaching-statistics :deep(.wrap-cell .cell) {
  white-space: normal;
  line-height: 1.5;
}
/* 表头强制单行不换行（与单元格换行互不干扰） */
.teaching-statistics :deep(.el-table__header .cell) {
  white-space: nowrap;
}
.stats-table {
  width: 100%;
}
.nested-table {
  margin: 4px 0;
}
</style>
