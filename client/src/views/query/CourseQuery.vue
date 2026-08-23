<template>
  <div class="course-query">
    <PageHeader
      title="课程查询"
      subtitle="查询中心"
      description="按课程查看各培养方案的采用情况和各学期课时分布"
    />
    <el-card>
      <!-- 筛选栏：课程名为主筛选器（输入即搜，200ms 防抖），其余为方案维度筛选 -->
      <FilterBar :active-count="activeFilterCount" @reset="resetFilters">
        <template #primary>
          <el-input
            v-model="filterCourseName"
            clearable
            placeholder="搜索课程名称"
            class="filter-2xl"
            :prefix-icon="Search"
            @clear="reload"
          />
        </template>
        <el-select
          v-model="filterCourseType"
          clearable
          placeholder="按科目类型"
          class="filter-lg"
          @change="reload"
        >
          <el-option label="公共课" value="public" />
          <el-option label="专业课" value="professional" />
        </el-select>
        <el-select
          v-model="filterCollege"
          clearable
          placeholder="按学院筛选"
          class="filter-xl"
          @change="reload"
        >
          <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select
          v-model="filterMajor"
          clearable
          filterable
          placeholder="按专业筛选"
          class="filter-xl"
          @change="reload"
        >
          <el-option v-for="m in majors" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
        <el-select
          v-model="filterLevel"
          clearable
          placeholder="按层次筛选"
          class="filter-lg"
          @change="reload"
        >
          <el-option v-for="l in levels" :key="l.id" :label="l.name" :value="l.id" />
        </el-select>
        <el-select
          v-model="filterPlanStatus"
          clearable
          placeholder="按方案状态（默认不含归档）"
          class="filter-lg"
          @change="reload"
        >
          <el-option label="生效" value="active" />
          <el-option label="草稿" value="draft" />
          <el-option label="归档" value="archived" />
        </el-select>
        <!-- 重置按钮：紧跟筛选器，始终可点（与开课查询页一致） -->
        <el-button @click="resetFilters">
          <el-icon><Refresh /></el-icon> 重置
        </el-button>
        <template #actions>
          <el-button v-if="authStore.isAdmin" :loading="exporting" @click="exportExcel">
            <el-icon><Download /></el-icon> 导出Excel
          </el-button>
        </template>
      </FilterBar>

      <el-alert
        :title="`共 ${totalCourses} 门课程，被 ${totalPlans} 条培养方案引用`"
        type="success"
        :closable="false"
        class="alert-success"
      />

      <ListErrorState v-if="error" :message="error" @retry="load" />
      <EmptyState
        v-else-if="!loading && data.length === 0"
        type="course"
        description="没有符合筛选条件的课程"
      />
      <div v-else class="table-scroll-wrap">
        <el-table v-loading="loading" :data="data" stripe row-key="course.id">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="expand-content">
                <div class="nested-scroll">
                  <el-table
                    :data="row.plans"
                    size="small"
                    border
                    row-key="planCourseId"
                    class="nested-table"
                  >
                    <el-table-column label="培养方案" min-width="200" show-overflow-tooltip>
                      <template #default="{ row: p }">
                        <span>{{ p.planName }}</span>
                        <span v-if="p.version" class="plan-version">{{ p.version }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="专业" min-width="120" show-overflow-tooltip>
                      <template #default="{ row: p }">{{ p.majorName || '—' }}</template>
                    </el-table-column>
                    <el-table-column label="层次" min-width="100" show-overflow-tooltip>
                      <template #default="{ row: p }">{{ p.trainingLevelName || '—' }}</template>
                    </el-table-column>
                    <el-table-column label="学院" min-width="130" show-overflow-tooltip>
                      <template #default="{ row: p }">{{ p.collegeName || '—' }}</template>
                    </el-table-column>
                    <el-table-column label="状态" min-width="150">
                      <template #default="{ row: p }">
                        <el-tag
                          size="small"
                          :type="statusTagType(p.planStatus)"
                          disable-transitions
                        >
                          {{ statusLabel(p.planStatus) }}
                        </el-tag>
                        <el-tag
                          v-if="!p.isActive"
                          size="small"
                          type="danger"
                          class="status-tag"
                          disable-transitions
                        >
                          已禁用
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column label="开课学期" min-width="110">
                      <template #default="{ row: p }">
                        第{{ p.startSemester }}-{{ p.endSemester }}学期
                      </template>
                    </el-table-column>
                    <!-- 各学期周课时（动态列，列数取全量数据最大学期数）；悬停显示该学期教材 -->
                    <el-table-column
                      v-for="sem in maxSemester"
                      :key="sem"
                      :label="`第${sem}学期`"
                      class-name="hours-col"
                      min-width="78"
                      align="center"
                    >
                      <template #default="{ row: p }">
                        <template v-if="getSemesterHours(p, sem) !== null">
                          <el-tooltip
                            placement="top"
                            :show-after="300"
                            :hide-after="0"
                            popper-class="textbook-tooltip"
                          >
                            <template #content>
                              <div class="tooltip-hours">
                                {{ getSemesterHours(p, sem).weeklyHours }} 课时/周 ×
                                {{ getSemesterHours(p, sem).weeksCount }} 周
                              </div>
                              <template v-if="getTextbooks(p, sem).length > 0">
                                <div
                                  v-for="tb in getTextbooks(p, sem)"
                                  :key="tb.id"
                                  class="tooltip-textbook"
                                >
                                  <div class="tooltip-title">{{ tb.title }}</div>
                                  <div v-if="tb.isbn" class="tooltip-row">
                                    <span class="tooltip-label">ISBN</span>
                                    <span>{{ tb.isbn }}</span>
                                  </div>
                                  <div v-if="tb.publisher" class="tooltip-row">
                                    <span class="tooltip-label">出版社</span>
                                    <span>{{ tb.publisher }}</span>
                                  </div>
                                  <div class="tooltip-row">
                                    <span class="tooltip-label">状态</span>
                                    <span v-if="!tb.isActive" class="tooltip-status disabled"
                                      >已停用</span
                                    >
                                    <span v-else-if="tb.isRequired" class="tooltip-status required"
                                      >必订</span
                                    >
                                    <span v-else class="tooltip-status elective">选修</span>
                                  </div>
                                </div>
                              </template>
                              <div v-else class="tooltip-no-textbook">未指定教材</div>
                            </template>
                            <span
                              class="hours-cell"
                              :class="{ 'has-textbook': getTextbooks(p, sem).length > 0 }"
                            >
                              {{ getSemesterHours(p, sem).weeklyHours }}
                            </span>
                          </el-tooltip>
                        </template>
                        <span v-else class="hours-empty">—</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="总课时" min-width="80" align="right">
                      <template #default="{ row: p }">
                        <span :class="{ 'hours-disabled': !p.isActive }">{{ p.totalHours }}</span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            label="课程名称"
            prop="course.name"
            min-width="180"
            show-overflow-tooltip
          />
          <el-table-column label="科目类型" min-width="100">
            <template #default="{ row }">
              <el-tag
                size="small"
                :type="row.course.type === 'professional' ? 'success' : 'primary'"
                disable-transitions
              >
                {{ row.course.type === 'public' ? '公共课' : '专业课' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="课程代码" min-width="100">
            <template #default="{ row }">{{ row.course.code || '—' }}</template>
          </el-table-column>
          <el-table-column label="采用方案数" min-width="110" align="center">
            <template #default="{ row }">
              <span>{{ row.planCount }}</span>
              <el-tag
                v-if="row.planCount > row.activePlanCount"
                size="small"
                type="info"
                class="status-tag"
                disable-transitions
              >
                含禁用{{ row.planCount - row.activePlanCount }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="总课时（启用方案）" min-width="140" align="right">
            <template #default="{ row }">{{ row.totalHours }}</template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Search, Refresh, Download } from '@element-plus/icons-vue';
import { getCourseQuery } from '../../api/query';
import { exportCoursePlans } from '../../api/export';
import { getColleges } from '../../api/college';
import { getMajors } from '../../api/major';
import { getTrainingLevels } from '../../api/trainingLevel';
import { useDebounceFn } from '../../composables/useDebounce';
import FilterBar from '@/components/filter/FilterBar.vue';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import { downloadBlob } from '../../utils/download';
import { useAuthStore } from '@/stores/auth';

defineOptions({ name: 'CourseQuery' });

const authStore = useAuthStore();

// ── 筛选状态 ──
const filterCourseName = ref('');
const filterCourseType = ref(null);
const filterCollege = ref(null);
const filterMajor = ref(null);
const filterLevel = ref(null);
const filterPlanStatus = ref(null);

// ── 数据状态 ──
const data = ref([]);
const loading = ref(false);
const error = ref(null);
const totalCourses = ref(0);
const totalPlans = ref(0);

// ── 筛选选项 ──
const colleges = ref([]);
const majors = ref([]);
const levels = ref([]);

const activeFilterCount = computed(
  () =>
    Number(!!filterCourseName.value) +
    Number(!!filterCourseType.value) +
    Number(!!filterCollege.value) +
    Number(!!filterMajor.value) +
    Number(!!filterLevel.value) +
    Number(!!filterPlanStatus.value)
);

// 全量数据中的最大学期数，用于展开表动态生成学期列
const maxSemester = computed(() => {
  let max = 0;
  for (const course of data.value) {
    for (const p of course.plans) {
      for (const s of p.semesters) {
        if (s.semester > max) max = s.semester;
      }
    }
  }
  return max;
});

// 课程名输入即搜：200ms 防抖（与课程管理/教师信息等页面同款交互），
// 输入停顿后自动查询，无需回车
const debouncedLoad = useDebounceFn(() => {
  load();
}, 200);
watch(filterCourseName, () => debouncedLoad());

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const params = buildQueryParams();
    const res = await getCourseQuery(params);
    data.value = res.data?.courses || [];
    totalCourses.value = res.data?.totalCourses || 0;
    totalPlans.value = res.data?.totalPlans || 0;
  } catch (e) {
    error.value = e?.response?.data?.message || '课程查询失败，请稍后重试';
    if (import.meta.env.DEV) console.error(e);
    data.value = [];
  } finally {
    loading.value = false;
  }
}

// 当前筛选条件 → 查询参数（查询与导出共用同一口径）
function buildQueryParams() {
  const params = {};
  if (filterCourseName.value.trim()) params.courseName = filterCourseName.value.trim();
  if (filterCourseType.value) params.courseType = filterCourseType.value;
  if (filterCollege.value) params.collegeId = filterCollege.value;
  if (filterMajor.value) params.majorId = filterMajor.value;
  if (filterLevel.value) params.trainingLevelId = filterLevel.value;
  if (filterPlanStatus.value) params.planStatus = filterPlanStatus.value;
  return params;
}

function reload() {
  load();
}

// 导出Excel：与页面查询同筛选口径，导出当前结果（含展开明细的方案行）
const exporting = ref(false);

async function exportExcel() {
  if (exporting.value) return;
  if (data.value.length === 0) {
    ElMessage.warning('当前没有可导出的数据');
    return;
  }

  exporting.value = true;
  try {
    const response = await exportCoursePlans(buildQueryParams());
    downloadBlob(response, `课程方案查询_${new Date().toISOString().slice(0, 10)}.xlsx`);
    ElMessage.success('导出成功');
  } catch (e) {
    if (import.meta.env.DEV) console.error('导出失败:', e);
    ElMessage.error(e.message || '导出失败，请重试');
  } finally {
    exporting.value = false;
  }
}

function resetFilters() {
  // 取消输入防抖的待发请求：watch(filterCourseName) 会因清空触发，下面 load() 已覆盖
  debouncedLoad.cancel();
  filterCourseName.value = '';
  filterCourseType.value = null;
  filterCollege.value = null;
  filterMajor.value = null;
  filterLevel.value = null;
  filterPlanStatus.value = null;
  load();
}

// 方案状态展示
function statusLabel(status) {
  const map = { active: '生效', draft: '草稿', archived: '归档' };
  return map[status] || status || '—';
}

function statusTagType(status) {
  const map = { active: 'success', draft: 'warning', archived: 'info' };
  return map[status] || 'info';
}

// 取某方案某学期的课时信息（无记录返回 null）
function getSemesterHours(plan, semester) {
  const found = plan.semesters.find((s) => s.semester === semester);
  return found || null;
}

// 取某方案某学期的教材列表（悬停展示用）
function getTextbooks(plan, semester) {
  const found = plan.semesters.find((s) => s.semester === semester);
  return found?.textbooks || [];
}

async function loadFilterOptions() {
  // 三个基础数据请求互不依赖，并行加载；单个失败不阻断页面
  const results = await Promise.allSettled([getColleges(), getMajors(), getTrainingLevels()]);
  if (results[0].status === 'fulfilled') colleges.value = results[0].value.data || [];
  if (results[1].status === 'fulfilled') majors.value = results[1].value.data || [];
  if (results[2].status === 'fulfilled') levels.value = results[2].value.data || [];
}

onMounted(() => {
  loadFilterOptions();
  load();
});
</script>

<style scoped>
.alert-success {
  margin-bottom: var(--space-3, 12px);
}

.table-scroll-wrap {
  overflow-x: auto;
}

.expand-content {
  padding: var(--space-2, 8px) var(--space-4, 16px);
}

.nested-scroll {
  overflow-x: auto;
}

.plan-version {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.status-tag {
  margin-left: 4px;
}

/* 悬停区域扩大：td 设为定位上下文，.cell 绝对定位铺满整个 td（越过其自身 overflow:hidden
   与默认内边距的限制），课时数字再铺满 .cell，tooltip 触发区域即整个单元格 */
.nested-table :deep(td.hours-col) {
  position: relative;
}

.nested-table :deep(td.hours-col .cell) {
  position: absolute;
  inset: 0;
  padding: 0;
}

.hours-cell {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
}

/* 有教材的课时数字显示帮助光标，提示可悬停查看教材 */
.hours-cell.has-textbook {
  cursor: help;
}

.hours-empty {
  /* 空值同样铺满居中，保证与其他单元格垂直对齐 */
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
}

.hours-disabled {
  color: var(--el-text-color-disabled);
}
</style>

<!--
  el-tooltip popper 渲染在 body 层，无法使用 scoped 样式。
  与 CourseMatrixTable 的教材 tooltip 样式保持一致（本页面独立使用，
  不依赖 CourseMatrixTable 组件加载）。
-->
<style>
.el-popper.textbook-tooltip {
  max-width: 280px;
  padding: 10px 14px;
  line-height: 1.6;
}

.textbook-tooltip .tooltip-hours {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 6px;
}

.textbook-tooltip .tooltip-textbook {
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.textbook-tooltip .tooltip-textbook:first-of-type {
  border-top: none;
}

.textbook-tooltip .tooltip-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--bg-card);
  word-break: break-all;
}

.textbook-tooltip .tooltip-row {
  display: flex;
  gap: var(--space-2);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.textbook-tooltip .tooltip-label {
  color: rgba(255, 255, 255, 0.7);
  flex-shrink: 0;
  min-width: 36px;
}

.textbook-tooltip .tooltip-no-textbook {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.textbook-tooltip .tooltip-status {
  font-weight: 600;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-micro);
}

.textbook-tooltip .tooltip-status.required {
  background: color-mix(in srgb, var(--brand-success) 25%, transparent);
  color: var(--brand-success-lighter);
}

.textbook-tooltip .tooltip-status.elective {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

.textbook-tooltip .tooltip-status.disabled {
  background: color-mix(in srgb, var(--brand-danger) 25%, transparent);
  color: var(--brand-danger-lighter);
}
</style>
