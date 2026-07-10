<template>
  <div class="unified-semester-query">
    <PageHeader
      title="开课查询"
      subtitle="查询中心"
      description="按学期查看各班级开课情况和教师安排"
    />
    <el-card>
      <!-- 未选学期时显示空状态 -->
      <EmptyState
        v-if="!selectedSemester"
        type="generic"
        description="请先选择学期，然后查看开课情况"
      />

      <!-- 已选学期时显示筛选、统计、表格 -->
      <template v-else>
        <div class="page-toolbar">
          <el-button @click="goToCurrentSemester">
            <el-icon><Calendar /></el-icon> 当前学期
          </el-button>
          <el-select
            v-model="selectedSemester"
            placeholder="选择学期"
            class="filter-2xl"
            @change="handleSemesterChange"
          >
            <el-option
              v-for="sem in availableSemesters"
              :key="sem.value"
              :label="sem.label"
              :value="sem.value"
            />
          </el-select>
          <el-select
            v-model="filterCollege"
            clearable
            placeholder="按学院筛选"
            class="filter-xl"
            @change="handleCollegeChange"
          >
            <el-option v-for="c in filteredColleges" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-select
            v-model="filterMajor"
            clearable
            placeholder="按专业筛选"
            class="filter-xl"
            @change="handleMajorChange"
          >
            <el-option v-for="m in filteredMajors" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
          <el-select
            v-model="filterLevel"
            clearable
            placeholder="按层次筛选"
            class="filter-lg"
            @change="resetPaginationAndLoad"
          >
            <el-option v-for="l in filteredLevels" :key="l.id" :label="l.name" :value="l.id" />
          </el-select>
          <el-select
            v-model="filterEnrollmentYear"
            clearable
            placeholder="按入学年份筛选"
            class="filter-lg"
            @change="resetPaginationAndLoad"
          >
            <el-option
              v-for="year in enrollmentYears"
              :key="year"
              :label="year + '年'"
              :value="year"
            />
          </el-select>
          <el-select
            v-model="filterGrade"
            clearable
            placeholder="按年级筛选"
            class="filter-md"
            @change="resetPaginationAndLoad"
          >
            <el-option v-for="g in grades" :key="g" :label="g + '年级'" :value="g" />
          </el-select>
          <div class="action-buttons">
            <el-button
              :disabled="
                !selectedSemester &&
                !filterCollege &&
                !filterMajor &&
                !filterLevel &&
                !filterEnrollmentYear &&
                !filterGrade
              "
              @click="resetFilters"
            >
              <el-icon><Refresh /></el-icon> 重置
            </el-button>
            <el-button v-if="authStore.isAdmin" type="success" @click="exportExcel">
              <el-icon><Download /></el-icon> 导出Excel
            </el-button>
          </div>
        </div>
        <el-alert
          :title="`查询学期：${semesterLabel} | 共 ${totalClasses} 个班级`"
          type="success"
          :closable="false"
          class="alert-success"
        />
        <el-alert
          v-if="unmatchedClasses.length > 0"
          type="warning"
          :closable="false"
          class="alert-warning"
        >
          <template #title>
            以下
            {{ unmatchedClasses.length }}
            个班级未匹配到培养方案，已排除在开课查询之外，请前往班级管理重新关联：
            {{ unmatchedClasses.map((c) => c.className).join('、') }}
          </template>
        </el-alert>

        <el-table v-loading="loading" :data="data" stripe row-key="classId">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="expand-content">
                <el-table
                  :data="row.courses"
                  size="small"
                  border
                  row-key="courseName"
                  style="margin: 4px 0"
                >
                  <el-table-column
                    prop="courseName"
                    label="课程"
                    min-width="150"
                    show-overflow-tooltip
                  />
                  <el-table-column label="类型" min-width="100">
                    <template #default="{ row: c }">
                      <el-tag
                        size="small"
                        :type="c.courseType === 'public' ? 'success' : 'warning'"
                      >
                        {{ c.courseType === 'public' ? '公共基础课' : '专业课' }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="weeklyHours" label="周课时" min-width="80" />
                  <el-table-column
                    prop="totalHoursThisSemester"
                    label="学期总课时"
                    min-width="100"
                  />
                  <el-table-column label="使用教材" min-width="250">
                    <template #default="{ row: c }">
                      <div v-if="c.textbooks?.length">
                        <div v-for="tb in c.textbooks" :key="tb.id">
                          {{ tb.title }}
                          <el-tag v-if="tb.isConsecutive" type="warning" size="small">选定</el-tag>
                          <el-tag v-else-if="tb.isRequired" size="small">必订</el-tag>
                        </div>
                      </div>
                      <span v-else class="no-textbook">未指定</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="className" label="班级" min-width="160" show-overflow-tooltip />
          <el-table-column
            prop="collegeName"
            label="二级学院"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column prop="majorName" label="专业" min-width="140" show-overflow-tooltip />
          <el-table-column
            prop="trainingLevelName"
            label="培养层次"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column label="入学年份" min-width="90" align="center" show-overflow-tooltip>
            <template #default="{ row }">{{ row.enrollmentYear }}年</template>
          </el-table-column>
          <el-table-column label="年级" min-width="60" align="center">
            <template #default="{ row }">{{ row.grade }}</template>
          </el-table-column>
          <el-table-column label="在读学期" min-width="80" align="center">
            <template #default="{ row }">第{{ row.currentSemester }}学期</template>
          </el-table-column>
          <el-table-column prop="studentCount" label="人数" min-width="60" align="center" />
          <el-table-column label="开课数" min-width="70" align="center">
            <template #default="{ row }">{{ row.courses?.length || 0 }}</template>
          </el-table-column>
          <el-table-column label="周课时合计" min-width="100" align="center">
            <template #default="{ row }">{{
              (row.courses || []).reduce((s, c) => s + c.weeklyHours, 0)
            }}</template>
          </el-table-column>
          <el-table-column prop="planName" label="培养方案" min-width="160" show-overflow-tooltip />
        </el-table>

        <!-- 分页 -->
        <div class="pagination-container">
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="pagination.total"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handleSizeChange"
            @current-change="handlePageChange"
          />
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getSemesterQuery } from '../../api/query';
import { getMajors } from '../../api/major';
import { getTrainingLevels } from '../../api/trainingLevel';
import { getColleges } from '../../api/college';
import { exportSemester } from '../../api/export';
import { useSemesters, downloadBlob } from '../../composables/useSemesters';
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';
import { useAuthStore } from '@/stores/auth';
import { getWithCache } from '../../utils/cache';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';

defineOptions({ name: 'UnifiedSemesterQuery' });

const authStore = useAuthStore();

const data = ref([]);
const loading = ref(false);
const majors = ref([]);
const levels = ref([]);
const colleges = ref([]);
const filterCollege = ref(null);
const filterMajor = ref(null);
const filterLevel = ref(null);
const filterEnrollmentYear = ref(null);
const filterGrade = ref(null);
const selectedSemester = ref('');
const semesterLabel = ref('');
const totalClasses = ref(0);
// 修复C：无匹配方案的班级列表（如自定义方案已失效），用于前端提示
const unmatchedClasses = ref([]);

// 关联关系数据
const collegeMajorRelation = ref({});
const collegeLevelRelation = ref({});
const majorLevelRelation = ref({});

// 当前学期实际开课的ID列表
const availableCollegeIds = ref([]);
const availableMajorIds = ref([]);
const availableLevelIds = ref([]);

// 分页状态
const pagination = ref({
  page: 1,
  pageSize: 50,
  total: 0,
});

// 学期相关逻辑
const { availableSemesters, fetchCurrentSemester } = useSemesters();

// 计算可用的入学年份列表（从API全量数据读取）
const enrollmentYears = ref([]);

// 计算可用的年级列表（从API全量数据读取）
const grades = ref([]);

async function load() {
  if (!selectedSemester.value) {
    data.value = [];
    semesterLabel.value = '';
    totalClasses.value = 0;
    unmatchedClasses.value = [];
    pagination.value.total = 0;
    return;
  }

  loading.value = true;
  try {
    const params = {
      semester: selectedSemester.value,
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
    };
    if (filterCollege.value) params.collegeId = filterCollege.value;
    if (filterMajor.value) params.majorId = filterMajor.value;
    if (filterLevel.value) params.trainingLevelId = filterLevel.value;
    if (filterEnrollmentYear.value) params.enrollmentYear = filterEnrollmentYear.value;
    if (filterGrade.value) params.grade = filterGrade.value;
    const res = await getWithCache(
      () => getSemesterQuery(params),
      `semester-query:${JSON.stringify(params)}`,
      30 * 1000 // 修复D：缩短缓存至30秒，避免后端数据修复后前端长时间展示旧数据
    );
    data.value = res.data?.data || [];
    semesterLabel.value = res.data?.semesterInfo?.label || '';
    totalClasses.value = res.data?.totalClasses || 0;
    unmatchedClasses.value = res.data?.unmatchedClasses || [];
    pagination.value.total = res.data?.total || 0;
    if (res.data?.enrollmentYears) enrollmentYears.value = res.data.enrollmentYears;
    if (res.data?.grades) grades.value = res.data.grades;

    // 接收当前学期实际开课的ID列表
    if (res.data?.collegeIds) availableCollegeIds.value = res.data.collegeIds;
    if (res.data?.majorIds) availableMajorIds.value = res.data.majorIds;
    if (res.data?.levelIds) availableLevelIds.value = res.data.levelIds;

    // 接收关联关系数据
    if (res.data?.collegeMajorRelation) collegeMajorRelation.value = res.data.collegeMajorRelation;
    if (res.data?.collegeLevelRelation) collegeLevelRelation.value = res.data.collegeLevelRelation;
    if (res.data?.majorLevelRelation) majorLevelRelation.value = res.data.majorLevelRelation;
  } catch (e) {
    if (import.meta.env.DEV) console.error(e);
    ElMessage.error('查询失败');
  } finally {
    loading.value = false;
  }
}

// 学期变化时处理
function handleSemesterChange() {
  resetPaginationAndLoad();
}

// 分页处理函数
function handlePageChange(page) {
  pagination.value.page = page;
  load();
}

function handleSizeChange(size) {
  pagination.value.pageSize = size;
  pagination.value.page = 1; // 重置到第一页
  load();
}

// 筛选条件变化时重置页码
function resetPaginationAndLoad() {
  pagination.value.page = 1;
  load();
}

// 使用通用联动Hook
const filters = computed(() => ({
  collegeId: filterCollege.value,
  majorId: filterMajor.value,
  trainingLevelId: filterLevel.value,
}));

const { getFilteredOptions, handleParentChange } = useFilterLinkage({
  filters,
  relations: {
    collegeMajorRelation,
    collegeLevelRelation,
    majorLevelRelation,
  },
});

// 学院：只显示当前学期实际开课的学院
const filteredColleges = computed(() => {
  if (availableCollegeIds.value.length === 0) {
    return colleges.value;
  }
  return colleges.value.filter((college) => availableCollegeIds.value.includes(college.id));
});

// 专业：先根据可用ID过滤，再根据学院联动过滤
const filteredMajors = computed(() => {
  let result = majors.value;

  // 先根据当前学期实际开课的专业ID过滤
  if (availableMajorIds.value.length > 0) {
    result = result.filter((major) => availableMajorIds.value.includes(major.id));
  }

  // 再根据选择的学院进行联动过滤
  if (filterCollege.value) {
    const collegeId = String(filterCollege.value);
    const majorIds = collegeMajorRelation.value[collegeId] || [];
    if (majorIds.length > 0) {
      result = result.filter((major) => majorIds.includes(major.id));
    }
  }

  return result;
});

// 层次：先根据可用ID过滤，再根据学院/专业联动过滤
const filteredLevels = computed(() => {
  let result = levels.value;

  // 先根据当前学期实际开课的层次ID过滤
  if (availableLevelIds.value.length > 0) {
    result = result.filter((level) => availableLevelIds.value.includes(level.id));
  }

  // 如果选择了专业，优先使用专业-层次关联
  if (filterMajor.value) {
    const majorId = String(filterMajor.value);
    const levelIds = majorLevelRelation.value[majorId] || [];
    if (levelIds.length > 0) {
      result = result.filter((level) => levelIds.includes(level.id));
    }
  }
  // 如果没有选择专业但选择了学院，使用学院-层次关联
  else if (filterCollege.value) {
    const collegeId = String(filterCollege.value);
    const levelIds = collegeLevelRelation.value[collegeId] || [];
    if (levelIds.length > 0) {
      result = result.filter((level) => levelIds.includes(level.id));
    }
  }

  return result;
});

// 处理学院变化
function handleCollegeChange() {
  handleParentChange('collegeId', ['majorId', 'trainingLevelId'], resetPaginationAndLoad);
}

// 处理专业变化
function handleMajorChange() {
  handleParentChange('majorId', ['trainingLevelId'], resetPaginationAndLoad);
}

// 跳转到当前学期
async function goToCurrentSemester() {
  selectedSemester.value = await fetchCurrentSemester();
  // 同时清空其他筛选条件
  filterCollege.value = null;
  filterMajor.value = null;
  filterLevel.value = null;
  filterEnrollmentYear.value = null;
  filterGrade.value = null;
  resetPaginationAndLoad();
}

function resetFilters() {
  filterCollege.value = null;
  filterMajor.value = null;
  filterLevel.value = null;
  filterEnrollmentYear.value = null;
  filterGrade.value = null;
  // 不重置学期选择器，只重置其他筛选条件
  resetPaginationAndLoad();
}

async function exportExcel() {
  if (!selectedSemester.value) {
    ElMessage.warning('请先选择学期');
    return;
  }

  try {
    const params = {
      semester: selectedSemester.value,
      collegeId: filterCollege.value || undefined,
      majorId: filterMajor.value || undefined,
      trainingLevelId: filterLevel.value || undefined,
      enrollmentYear: filterEnrollmentYear.value || undefined,
      grade: filterGrade.value || undefined,
    };

    const response = await exportSemester(params);

    downloadBlob(
      response,
      `开课数据_${semesterLabel.value || selectedSemester.value}_${new Date().getTime()}.xlsx`
    );

    ElMessage.success('导出成功');
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('导出失败:', e);
    }
    ElMessage.error(e.message || '导出失败，请重试');
  }
}

onMounted(async () => {
  // 设置默认学期为系统设置的当前学期
  selectedSemester.value = await fetchCurrentSemester();

  const [levelRes, majorRes, collegeRes] = await Promise.all([
    getTrainingLevels(),
    getMajors(),
    getColleges(),
  ]);
  levels.value = levelRes.data || [];
  majors.value = majorRes.data || [];
  colleges.value = collegeRes.data || [];

  // 加载数据
  load();
});
</script>

<style scoped>
/* 外层表格单元格防换行 */
:deep(.el-table__body td .cell) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 表头单元格防换行 */
:deep(.el-table__header th .cell) {
  white-space: nowrap;
}
/* 展开行内嵌表格紧凑化 */
.expand-content {
  padding: 8px 16px;
}
.expand-content :deep(.el-table .cell) {
  min-height: 26px;
  padding: 2px 8px;
}
.expand-content :deep(.el-table th .cell) {
  min-height: 28px;
  padding: 2px 8px;
}
/* 内嵌表格禁用行hover高亮，避免与外层表格hover效果叠加造成视觉干扰 */
.expand-content :deep(.el-table tbody tr:hover > td) {
  background: inherit !important;
}
.expand-content .no-textbook {
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
