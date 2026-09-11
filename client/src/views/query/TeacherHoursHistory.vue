<template>
  <div class="teacher-hours-history">
    <PageHeader
      title="课时查询"
      subtitle="历史排课记录"
      description="查看教师历年各学期的课时安排和总课时汇总"
    ></PageHeader>

    <el-card>
      <!-- 筛选器 -->
      <FilterBar :active-count="0" @reset="resetFilters">
        <template #primary>
          <el-select
            v-model="selectedTeacherId"
            placeholder="选择教师"
            clearable
            filterable
            class="filter-xl"
            style="width: 280px"
            @change="loadHistoricalData"
          >
            <el-option
              v-for="t in teacherOptions"
              :key="t.id"
              :label="`${t.name} (${t.affiliatedCollege?.name || '-'})`"
              :value="t.id"
            />
          </el-select>
        </template>
        <template #actions>
          <el-button v-if="authStore.isAdmin" :loading="exporting" @click="handleExport">
            <el-icon><Download /></el-icon> 导出Excel
          </el-button>
        </template>
      </FilterBar>

      <!-- 错误状态 -->
      <ListErrorState v-if="error" :message="error" @retry="loadHistoricalData" />

      <!-- 加载骨架屏 -->
      <el-skeleton v-else-if="loading && !historyData" :rows="4" animated />

      <!-- 空状态 -->
      <EmptyState
        v-else-if="!loading && !historyData"
        type="generic"
        description="请选择教师查看历年课时记录"
      />
      <EmptyState
        v-else-if="!loading && historyData && historyData.semesters.length === 0"
        type="generic"
        description="该教师暂无排课记录"
      />

      <!-- 概览卡：教师身份 + 统计汇总（合并原 descriptions 与汇总卡片，减少视觉层级） -->
      <div v-if="historyData" class="overview-card">
        <div class="overview-head">
          <span class="teacher-name">{{ historyData.teacherInfo.name }}</span>
          <el-tag
            :type="personnelTagType(historyData.teacherInfo.personnelType)"
            size="small"
            disable-transitions
          >
            {{ personnelLabel(historyData.teacherInfo.personnelType) }}
          </el-tag>
          <span class="overview-college">{{
            historyData.teacherInfo.affiliatedCollege || '-'
          }}</span>
          <div class="overview-subjects">
            <el-tag
              v-for="sub in historyData.teacherInfo.subjectList.slice(0, 5)"
              :key="sub"
              size="small"
              effect="plain"
              class="tag-item"
              disable-transitions
            >
              {{ sub }}
            </el-tag>
            <el-tooltip
              v-if="historyData.teacherInfo.subjectList.length > 5"
              :content="historyData.teacherInfo.subjectList.join('、')"
              placement="top"
            >
              <el-tag size="small" effect="plain" class="tag-item" disable-transitions
                >+{{ historyData.teacherInfo.subjectList.length - 5 }}</el-tag
              >
            </el-tooltip>
          </div>
        </div>
        <div v-if="filteredSemesters.length > 0" class="summary-grid">
          <div class="summary-item">
            <el-statistic title="涉及学期数" :value="summary.totalSemesters" suffix="学期" />
          </div>
          <div class="summary-item">
            <el-statistic title="历年总周课时" :value="summary.totalWeeklyHours" suffix="课时" />
          </div>
          <div class="summary-item">
            <el-statistic title="总安排班级数" :value="summary.totalClasses" suffix="个" />
          </div>
        </div>
      </div>

      <!-- 学期课时汇总 -->
      <div v-if="historyData && filteredSemesters.length > 0" class="history-section">
        <h3 class="section-title">学期课时汇总</h3>

        <div class="table-scroll-wrap">
          <el-table
            v-loading="loading"
            :data="filteredSemesters"
            stripe
            row-key="semester"
            class="history-table"
            :default-expand-all="false"
          >
            <!-- 只使用展开图标，移除操作列 -->
            <el-table-column type="expand" width="60">
              <template #default="{ row }">
                <!-- 空状态提示 -->
                <div v-if="!row.courses || row.courses.length === 0" class="empty-expand">
                  该学期暂无排课记录
                </div>

                <div v-else class="expand-content">
                  <div
                    v-for="course in row.courses"
                    :key="course.courseId"
                    class="course-container"
                  >
                    <div class="course-header">
                      <div class="course-name">{{ course.courseName }}</div>
                      <el-tag size="small" effect="plain" disable-transitions
                        >周课时：{{ course.weeklyHours }}</el-tag
                      >
                    </div>
                    <div class="nested-scroll">
                      <el-table
                        :data="course.classes"
                        size="small"
                        stripe
                        class="nested-table"
                        row-key="unitKey"
                      >
                        <el-table-column
                          prop="className"
                          label="班级"
                          min-width="180"
                          show-overflow-tooltip
                        >
                          <template #default="{ row: cls }">
                            {{ cls.className }}
                            <el-tag
                              v-if="cls.isCombined"
                              size="small"
                              effect="plain"
                              class="tag-item combined-tag"
                              disable-transitions
                            >
                              合班<span v-if="cls.combinationNo" class="combined-group-no">{{
                                cls.combinationNo
                              }}</span>
                            </el-tag>
                          </template>
                        </el-table-column>
                        <el-table-column
                          v-if="!isMobile"
                          prop="collegeName"
                          label="学院"
                          min-width="120"
                          show-overflow-tooltip
                        />
                        <el-table-column
                          v-if="!isMobile"
                          prop="trainingLevelName"
                          label="层次"
                          width="80"
                        />
                        <el-table-column prop="classStatus" label="状态" width="80" align="center">
                          <template #default="{ row: cls }">
                            <el-tag
                              :type="cls.classStatus === '在籍' ? 'success' : 'warning'"
                              size="small"
                              effect="plain"
                              disable-transitions
                            >
                              {{ cls.classStatus }}
                            </el-tag>
                          </template>
                        </el-table-column>
                        <el-table-column
                          prop="weeklyHours"
                          label="周课时"
                          width="80"
                          align="center"
                        />
                        <el-table-column
                          v-if="!isMobile"
                          label="当前教材"
                          min-width="200"
                          show-overflow-tooltip
                        >
                          <template #default="{ row: cls }">
                            <span
                              v-if="cls.textbookNames?.length"
                              style="display: block; white-space: normal"
                            >
                              {{ cls.textbookNames.join('、') }}
                            </span>
                            <span v-else class="text-muted">-</span>
                          </template>
                        </el-table-column>
                      </el-table>
                    </div>
                  </div>
                </div>
              </template>
            </el-table-column>

            <!-- 学期概览列：用 min-width 让 Element Plus 把剩余宽度分配给这些列，表格才能撑满容器 -->
            <el-table-column prop="semester" label="学期" min-width="120" />
            <el-table-column prop="totalWeeklyHours" label="周课时" min-width="80" align="center">
              <template #default="{ row }">
                <span class="semester-total">{{ row.totalWeeklyHours }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="!isMobile" label="课时占比" min-width="130" align="center">
              <template #default="{ row }">
                <div
                  class="ratio-cell"
                  :title="`${row.totalWeeklyHours} / ${summary.totalWeeklyHours} 周课时`"
                >
                  <span class="ratio-track">
                    <span class="ratio-fill" :style="{ width: `${hoursRatio(row)}%` }" />
                  </span>
                  <span class="ratio-text">{{ hoursRatio(row) }}%</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="classCount" label="班级数" min-width="80" align="center" />
            <el-table-column label="合班数" min-width="80" align="center">
              <template #default="{ row }">
                <span v-if="combinedCount(row) > 0" class="combined-count">{{
                  combinedCount(row)
                }}</span>
                <span v-else class="text-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column label="教材覆盖" min-width="90" align="center">
              <template #default="{ row }">
                <span :class="{ 'text-muted': textbookWithCount(row) === 0 }">
                  {{ textbookWithCount(row) }}/{{ row.classCount }}
                </span>
              </template>
            </el-table-column>
            <el-table-column
              v-if="!isMobile"
              label="科目明细"
              min-width="220"
              show-overflow-tooltip
            >
              <template #default="{ row }">{{ courseNames(row) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Download } from '@element-plus/icons-vue';
import { getTeachers } from '../../api/teacher';
import { getHistoricalHoursStatistics } from '../../api/teachingArrange';
import { exportHistoricalHours } from '../../api/export';
import { downloadBlob } from '../../utils/download';
import { personnelLabel, personnelTagType } from '../../utils/personnel';
import { useResponsive } from '../../composables/useResponsive';
import { useAuthStore } from '@/stores/auth';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import FilterBar from '@/components/filter/FilterBar.vue';

defineOptions({ name: 'TeacherHoursHistory' });

const { isMobile } = useResponsive();
const authStore = useAuthStore();

// 数据
const loading = ref(false);
const error = ref(null);
const exporting = ref(false);
const historyData = ref(null);

// 筛选器
const selectedTeacherId = ref('');

// 教师选项
const teacherOptions = ref([]);

// 加载教师列表（不分页，获取所有教师）
async function loadTeachers() {
  try {
    const res = await getTeachers({ page_size: 1000 });
    teacherOptions.value = res.data?.items || [];
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('加载教师列表失败:', e);
    }
  }
}

// 获取历史课时数据
async function loadHistoricalData() {
  if (!selectedTeacherId.value) {
    historyData.value = null;
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    const res = await getHistoricalHoursStatistics({
      teacher_id: Number(selectedTeacherId.value),
    });
    historyData.value = res.data || null;
  } catch (e) {
    error.value = e?.response?.data?.message || '数据加载失败，请稍后重试';
    if (import.meta.env.DEV) {
      console.error('加载历史课时数据失败:', e);
    }
  } finally {
    loading.value = false;
  }
}

// 筛选后的学期列表（始终显示全部）
const filteredSemesters = computed(() => {
  if (!historyData.value) return [];
  return historyData.value.semesters;
});

// 重置筛选器
function resetFilters() {
  selectedTeacherId.value = '';
  historyData.value = null;
}

// 统计汇总
const summary = computed(() => ({
  totalSemesters: filteredSemesters.value.length,
  totalWeeklyHours: filteredSemesters.value.reduce((sum, s) => sum + s.totalWeeklyHours, 0),
  totalClasses: filteredSemesters.value.reduce((sum, s) => sum + s.classCount, 0),
}));

// 主表汇总列辅助统计（基于学期行内的教学单元明细）
function unitClasses(row) {
  return row.courses.flatMap((c) => c.classes);
}

function combinedCount(row) {
  return unitClasses(row).filter((c) => c.isCombined).length;
}

function textbookWithCount(row) {
  return unitClasses(row).filter((c) => c.textbookNames?.length).length;
}

// 课时占比：该学期周课时占历年总周课时的份额（份额之和为 100%，可横向比较各学期负荷）
function hoursRatio(row) {
  const total = summary.value.totalWeeklyHours;
  return total ? Math.round((row.totalWeeklyHours / total) * 100) : 0;
}

function courseNames(row) {
  return row.courses.map((c) => c.courseName).join('、');
}

// 导出 Excel（与页面同口径：导出该教师全部历年学期）
async function handleExport() {
  if (!historyData.value) return ElMessage.warning('暂无数据可导出');
  exporting.value = true;
  try {
    const response = await exportHistoricalHours({
      teacher_id: Number(selectedTeacherId.value),
    });
    const teacherName = historyData.value.teacherInfo?.name || '课时查询';
    downloadBlob(response, `课时查询_${teacherName}_${new Date().getFullYear()}.xlsx`);
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
  await loadTeachers();
});
</script>

<style scoped>
.tag-item {
  margin: 2px;
}
.text-muted {
  color: var(--text-secondary);
}
.section-title {
  margin: 16px 0 12px;
  font-size: var(--font-size-body);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}
.history-section {
  margin-top: var(--space-3);
}

/* 概览卡：教师身份行 + 统计网格，单一浅色表面减少视觉层级 */
.overview-card {
  padding: var(--space-3) var(--space-4);
  background: var(--bg-subtle);
  border-radius: var(--radius-lg);
}
.overview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.teacher-name {
  font-size: var(--font-size-subtitle);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}
.overview-college {
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
}
.overview-subjects {
  display: flex;
  flex-wrap: wrap;
  margin-left: auto;
}

/* 外层滚动容器 - 与 CourseQuery 一致 */
.table-scroll-wrap {
  overflow-x: auto;
}

/* expand 单元格去除默认 padding，让内容填满整个宽度（需 :deep 穿透 el-table 内部节点） */
.history-table :deep(.el-table__expanded-cell) {
  padding: 0 !important;
}

/* expand 内容区域 - 提供适当 padding */
.expand-content {
  padding: var(--space-2) var(--space-4);
}

.empty-expand {
  padding: 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.course-container {
  margin-bottom: 16px;
}

.course-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border-light);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}

.course-name {
  font-size: var(--font-size-body-sm);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

/* 内层滚动容器 */
.nested-scroll {
  overflow-x: auto;
}

/* 内嵌表格 - 移除最小宽度限制，让其自然填充可用空间 */
.nested-table {
  width: 100%;
}

/* 学期 total 标识 */
.semester-total {
  font-weight: var(--fw-bold);
  color: var(--brand-primary);
  font-size: 14px;
}

/* 合班数高亮 */
.combined-count {
  font-weight: var(--fw-medium);
  color: var(--brand-indigo);
}

/* 课时占比：条形按份额渲染，右侧数字兜底精确值 */
.ratio-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ratio-track {
  flex: 1;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-subtle);
}
.ratio-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--brand-indigo);
}
.ratio-text {
  min-width: 34px;
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  text-align: right;
}

/* 统计网格（概览卡内，分隔线代替独立底色） */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-light);
}
.summary-item {
  position: relative;
  display: flex;
  justify-content: center;
  padding: var(--space-2);
}
.summary-item + .summary-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 15%;
  bottom: 15%;
  width: 1px;
  background: var(--border-light);
}
.summary-item .el-statistic__value {
  font-size: 20px;
  font-weight: var(--fw-bold);
  color: var(--brand-primary);
}
.summary-item .el-statistic__title {
  font-size: 13px;
  color: var(--text-secondary);
}
.combined-tag {
  margin-left: var(--space-1);
  vertical-align: middle;
  cursor: default;
}
.combined-group-no {
  display: inline-block;
  min-width: 14px;
  height: 14px;
  margin-left: 3px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--brand-indigo);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
  vertical-align: middle;
}
@media (max-width: 480px) {
  .summary-grid {
    grid-template-columns: repeat(1, 1fr);
  }
  .overview-subjects {
    margin-left: 0;
    width: 100%;
  }
}
</style>
