<template>
  <div class="teaching-statistics">
    <PageHeader
      title="课时统计"
      subtitle="教学安排"
      description="查看本学期各教师的课时分配情况和教学统计"
    >
      <template #extra>
        <SemesterSelect v-model="semester" @change="loadStats" />
      </template>
    </PageHeader>
    <el-card>
      <!-- 汇总统计：等分网格 + 竖线分隔（对齐 Dashboard 指标条视觉）
           页面重新挂载时 statsData 为 null，若用 v-if="statsData" 会在接口返回后才插入整块区域，
           把下方内容往下顶出跳动；改为加载期即占位（0 值同高渲染），仅错误态隐藏 -->
      <div v-if="!error" class="summary-section">
        <div class="summary-grid">
          <div class="summary-item">
            <el-statistic title="参与教师" :value="filteredSummary.totalTeachers" suffix="人" />
          </div>
          <div class="summary-item">
            <el-statistic
              title="总周课时"
              :value="filteredSummary.totalWeeklyHours"
              suffix="课时"
            />
          </div>
          <div class="summary-item">
            <el-statistic title="总安排班级数" :value="filteredSummary.totalClasses" suffix="个" />
          </div>
        </div>
        <el-divider />
      </div>

      <!-- 筛选器 -->
      <FilterBar :active-count="activeFilterCount" @reset="resetFilters">
        <template #primary>
          <el-input v-model="filterName" placeholder="姓名" clearable class="filter-md" />
        </template>
        <el-select
          v-model="filterAffiliatedCollege"
          placeholder="归属学院"
          clearable
          filterable
          class="filter-lg"
        >
          <el-option v-for="v in affiliatedCollegeOptions" :key="v" :label="v" :value="v" />
        </el-select>
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
        <template #actions>
          <el-button :loading="exporting" :disabled="!statsData" @click="handleExport"
            ><el-icon><Download /></el-icon> 导出Excel</el-button
          >
        </template>
      </FilterBar>

      <!-- 错误状态 -->
      <ListErrorState v-if="error" :message="error" @retry="loadStats" />
      <!-- 首屏加载：loading 且无数据时先上骨架屏，消除无反馈的空白窗口（与 Dashboard 加载风格一致） -->
      <el-skeleton v-else-if="loading && !statsData" :rows="4" animated />
      <!-- 空状态 -->
      <EmptyState v-else-if="!loading && !statsData" type="generic" description="暂无数据" />
      <EmptyState
        v-else-if="!loading && statsData && filteredTeachers.length === 0"
        type="generic"
        description="暂无数据"
      />

      <!-- 教师课时统计表：外层横向滚动容器兼容窄屏，移动端隐藏次要列 -->
      <div v-if="filteredTeachers.length > 0">
        <div class="table-scroll-wrap">
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
                    <!-- 列宽策略与主表一致：数字/短标签列固定 width，文本列按权重瓜分剩余宽度；
                       班级列权重最大以容纳合班长名，教材列次之；移动端隐藏次要列 -->
                    <div class="nested-scroll">
                      <el-table
                        :data="detail.classes"
                        size="small"
                        border
                        class="nested-table"
                        row-key="unitKey"
                      >
                        <el-table-column label="班级" min-width="16" cell-class-name="wrap-cell">
                          <template #default="{ row: cls }">
                            <span>{{ cls.className }}</span>
                            <el-tag
                              v-if="cls.isCombined"
                              size="small"
                              effect="plain"
                              class="tag-item"
                              disable-transitions
                              >合班</el-tag
                            >
                          </template>
                        </el-table-column>
                        <el-table-column v-if="!isMobile" label="学院" min-width="7">
                          <template #default="{ row: cls }">
                            <el-tag
                              v-if="cls.collegeName"
                              size="small"
                              type="info"
                              effect="plain"
                              disable-transitions
                              >{{ cls.collegeName }}</el-tag
                            >
                            <span v-else class="text-muted">-</span>
                          </template>
                        </el-table-column>
                        <el-table-column v-if="!isMobile" label="层次" min-width="5">
                          <template #default="{ row: cls }">
                            <el-tag
                              v-if="cls.trainingLevelName"
                              size="small"
                              class="tag-indigo"
                              disable-transitions
                              >{{ cls.trainingLevelName }}</el-tag
                            >
                            <span v-else class="text-muted">-</span>
                          </template>
                        </el-table-column>
                        <el-table-column
                          prop="weeklyHours"
                          label="周课时"
                          width="84"
                          align="center"
                        />
                        <el-table-column
                          v-if="!isMobile"
                          label="安排方式"
                          width="96"
                          align="center"
                        >
                          <template #default="{ row: cls }">
                            <el-tag
                              :type="cls.isAuto ? 'info' : 'primary'"
                              size="small"
                              effect="plain"
                              disable-transitions
                            >
                              {{ cls.isAuto ? '自动' : '手动' }}
                            </el-tag>
                          </template>
                        </el-table-column>
                        <el-table-column
                          label="当前教材"
                          min-width="14"
                          cell-class-name="wrap-cell"
                        >
                          <template #default="{ row: cls }">
                            <span v-if="cls.textbookName">{{ cls.textbookName }}</span>
                            <span v-else class="text-muted">-</span>
                          </template>
                        </el-table-column>
                      </el-table>
                    </div>
                  </div>
                </div>
              </template>
            </el-table-column>
            <!-- 列宽策略：序号/数字类短内容列用固定 width 防被拉宽；
               文本/标签列用带权重的 min-width，按权重瓜分剩余宽度，内容多的列获得更多空间 -->
            <el-table-column type="index" label="#" width="48" />
            <el-table-column prop="teacherName" label="姓名" width="76" />
            <el-table-column v-if="!isMobile" label="归属学院" min-width="9">
              <template #default="{ row }">
                <span>{{ row.affiliatedCollege?.name || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="人员类别" width="82" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="personnelTagType(row.personnelType)"
                  size="small"
                  disable-transitions
                >
                  {{ personnelLabel(row.personnelType) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column
              v-if="!isMobile"
              label="任教科目"
              min-width="10"
              cell-class-name="wrap-cell"
            >
              <template #default="{ row }">
                <el-tag
                  v-for="d in row.details"
                  :key="d.course.id"
                  size="small"
                  effect="plain"
                  class="tag-item"
                  disable-transitions
                  >{{ d.course.name }}</el-tag
                >
              </template>
            </el-table-column>
            <el-table-column
              v-if="!isMobile"
              label="任课层次"
              min-width="9"
              cell-class-name="wrap-cell"
            >
              <template #default="{ row }">
                <el-tag
                  v-for="l in row.trainingLevelList"
                  :key="l.id"
                  size="small"
                  class="tag-item tag-indigo"
                  disable-transitions
                  >{{ l.name }}</el-tag
                >
                <span v-if="!row.trainingLevelList?.length" class="text-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column
              v-if="!isMobile"
              label="任课学院"
              min-width="15"
              cell-class-name="wrap-cell"
            >
              <template #default="{ row }">
                <el-tag
                  v-for="c in row.collegeList"
                  :key="c.id"
                  size="small"
                  type="info"
                  effect="plain"
                  class="tag-item"
                  disable-transitions
                  >{{ c.name }}</el-tag
                >
                <span v-if="!row.collegeList?.length" class="text-muted">-</span>
              </template>
            </el-table-column>
            <!-- 备注最长显示 6 个字符，超出截断（列权重收窄后按 6 字 + 省略号适配）；悬停 tooltip 查看全文 -->
            <el-table-column v-if="!isMobile" label="备注" min-width="8">
              <template #default="{ row }">
                <el-tooltip
                  v-if="row.remark && Array.from(row.remark).length > 6"
                  :content="row.remark"
                  placement="top"
                >
                  <span>{{ truncateText(row.remark, 6) }}</span>
                </el-tooltip>
                <span v-else>{{ row.remark || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="!isMobile" label="教材数" width="70" align="center">
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
            <el-table-column v-if="!isMobile" label="班级数" width="88" align="center">
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
              width="96"
              align="center"
              sortable
              :sort-method="(a, b) => a.totalWeeklyHours - b.totalWeeklyHours"
            >
              <template #default="{ row }">
                <span class="hours-value">{{ row.totalWeeklyHours }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="pagination-container">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :total="filteredTeachers.length"
            :page-sizes="[20, 50, 100]"
            :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next'"
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
import { truncateText } from '../../utils/string';
import { useDebounceFn } from '../../composables/useDebounce';
import { useResponsive } from '../../composables/useResponsive';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import SemesterSelect from '../../components/SemesterSelect.vue';
import FilterBar from '@/components/filter/FilterBar.vue';

defineOptions({ name: 'TeachingStatistics' });

/* 响应式断点：复用全局共享实例，移动端隐藏次要列避免表格被极限压缩 */
const { isMobile } = useResponsive();

const settingsStore = useSettingsStore();
const semester = ref('');
const statsData = ref(null);
// 初始即为加载态：挂载后到 loadStats 置 true 之间隔着异步的 loadSemester，
// 若初始 false，这几帧内 !loading && !statsData 成立，空状态会闪现一下
const loading = ref(true);
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

// 生效筛选条件数（移动端“更多筛选”按钮角标）
const activeFilterCount = computed(
  () =>
    [
      filterName.value,
      filterType.value,
      filterSubject.value,
      filterCollege.value,
      filterLevel.value,
      filterAffiliatedCollege.value,
    ].filter((v) => v !== '' && v !== null && v !== undefined).length
);

// 移动端抽屉“重置”：清空全部筛选条件（姓名需同步清除防抖镜像）
function resetFilters() {
  filterName.value = '';
  debouncedFilterName.value = '';
  filterType.value = '';
  filterSubject.value = '';
  filterCollege.value = '';
  filterLevel.value = '';
  filterAffiliatedCollege.value = '';
}

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
  // 无可用学期时退出加载态，否则初始 loading=true 会永久挂住
  if (!semester.value) {
    loading.value = false;
    return;
  }
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
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
.summary-item {
  position: relative;
  display: flex;
  justify-content: center;
  padding: var(--space-1) var(--space-4);
}
/* 指标间的竖线分隔符 */
.summary-item + .summary-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 25%;
  bottom: 25%;
  width: 1px;
  background: var(--border-light);
}
/* 窄屏保持三列等分（避免纵向堆叠占满整屏），仅压缩内边距；
   竖线分隔保留，与 Dashboard 指标条移动端视觉一致 */
@media (max-width: 576px) {
  .summary-item {
    padding: var(--space-1) 2px;
  }
}
.expand-content {
  padding: var(--space-2) var(--space-4);
}
.course-detail h4 {
  margin: 6px 0 2px;
  font-size: var(--font-size-body-sm);
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
/* 表格横滚容器与内嵌表最小宽度已提升为全局工具类（见 styles/global.css） */
</style>
