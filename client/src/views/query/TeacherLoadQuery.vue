<template>
  <div class="teacher-load-query">
    <PageHeader
      title="任课查询"
      subtitle="查询中心"
      description="按学期查看教师任课情况与教材使用分布"
    />
    <el-card>
      <el-tabs v-model="activeTab" class="load-tabs">
        <el-tab-pane label="按教师查询" name="teacher" />
        <el-tab-pane label="按教材查询" name="textbook" />
      </el-tabs>

      <FilterBar :active-count="activeFilterCount" @reset="resetFilters">
        <template #primary>
          <el-button :disabled="isCurrentSemester" @click="goToCurrentSemester">
            <el-icon><Calendar /></el-icon> 当前学期
          </el-button>
          <el-select
            v-model="semester"
            placeholder="选择学期"
            class="filter-2xl"
            :teleported="false"
            @change="handleSemesterChange"
          >
            <el-option
              v-for="sem in availableSemesters"
              :key="sem.value"
              :label="sem.label"
              :value="sem.value"
            />
          </el-select>
        </template>

        <!-- 按教师查询筛选器 -->
        <template v-if="activeTab === 'teacher'">
          <el-input
            v-model="teacherFilters.name"
            placeholder="教师姓名"
            clearable
            class="filter-md"
          />
          <el-select
            v-model="teacherFilters.personnelType"
            placeholder="类别"
            clearable
            class="filter-sm"
            :teleported="false"
          >
            <el-option label="专职" value="full_time" />
            <el-option label="兼职" value="part_time" />
            <el-option label="外聘" value="external" />
          </el-select>
          <el-select
            v-model="teacherFilters.course"
            placeholder="学科"
            clearable
            filterable
            class="filter-xl"
            :teleported="false"
          >
            <el-option v-for="v in teacherCourseOptions" :key="v" :label="v" :value="v" />
          </el-select>
          <el-select
            v-model="teacherFilters.affiliatedCollege"
            placeholder="归属学院"
            clearable
            filterable
            class="filter-lg"
            :teleported="false"
          >
            <el-option v-for="v in affiliatedCollegeOptions" :key="v" :label="v" :value="v" />
          </el-select>
          <el-select
            v-model="teacherFilters.college"
            placeholder="任课学院"
            clearable
            filterable
            class="filter-md"
            :teleported="false"
          >
            <el-option v-for="v in teacherCollegeOptions" :key="v" :label="v" :value="v" />
          </el-select>
          <el-select
            v-model="teacherFilters.level"
            placeholder="层次"
            clearable
            filterable
            class="filter-md"
            :teleported="false"
          >
            <el-option v-for="v in teacherLevelOptions" :key="v" :label="v" :value="v" />
          </el-select>
        </template>

        <!-- 按教材查询筛选器 -->
        <template v-else>
          <el-input
            v-model="textbookFilters.title"
            placeholder="教材名称"
            clearable
            class="filter-2xl"
          />
          <el-select
            v-model="textbookFilters.course"
            placeholder="学科"
            clearable
            filterable
            class="filter-xl"
            :teleported="false"
          >
            <el-option v-for="v in textbookCourseOptions" :key="v" :label="v" :value="v" />
          </el-select>
          <el-select
            v-model="textbookFilters.level"
            placeholder="层次"
            clearable
            filterable
            class="filter-md"
            :teleported="false"
          >
            <el-option v-for="v in textbookLevelOptions" :key="v" :label="v" :value="v" />
          </el-select>
          <el-select
            v-model="textbookFilters.major"
            placeholder="专业"
            clearable
            filterable
            class="filter-xl"
            :teleported="false"
          >
            <el-option v-for="v in textbookMajorOptions" :key="v" :label="v" :value="v" />
          </el-select>
        </template>

        <el-button :disabled="!activeFilterCount" @click="resetFilters">
          <el-icon><Refresh /></el-icon> 重置
        </el-button>

        <template #actions>
          <el-button
            v-if="authStore.isAdmin"
            :loading="exporting"
            :disabled="!data"
            @click="handleExport"
          >
            <el-icon><Download /></el-icon> 导出Excel
          </el-button>
        </template>
      </FilterBar>

      <!-- 实排口径说明：与「教材查询」页的培养方案应排口径区分，避免使用者误判数值不一致 -->
      <el-alert
        v-if="activeTab === 'textbook' && !error"
        title="本页统计已排课班级的教材使用情况，与「教材查询」页按培养方案推算的结果可能存在差异"
        type="info"
        :closable="false"
        class="alert-note"
      />
      <el-alert
        v-if="!error && data"
        :title="summaryText"
        type="success"
        :closable="false"
        class="alert-summary"
      />

      <ListErrorState v-if="error" :message="error" @retry="loadData" />
      <el-skeleton v-else-if="loading && !data" :rows="4" animated />
      <EmptyState v-else-if="!semester" type="teacher" description="请先选择要查询的学期" />
      <EmptyState
        v-else-if="!loading && activeTab === 'teacher' && !filteredTeachers.length"
        type="teacher"
        description="暂无教师任课数据"
      />
      <EmptyState
        v-else-if="!loading && activeTab === 'textbook' && !filteredTextbooks.length"
        type="textbook"
        description="暂无教材使用数据"
      />

      <!-- 按教师查询 -->
      <div v-else-if="activeTab === 'teacher'">
        <div class="table-scroll-wrap">
          <el-table
            v-loading="loading"
            :data="pagedTeachers"
            stripe
            row-key="teacherId"
            class="load-table"
          >
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="expand-content">
                  <div class="nested-scroll">
                    <el-table
                      :data="row.details"
                      size="small"
                      border
                      class="nested-table"
                      row-key="unitKey"
                    >
                      <el-table-column
                        prop="courseName"
                        label="课程"
                        min-width="12"
                        cell-class-name="wrap-cell"
                      />
                      <el-table-column label="任课班级" min-width="18" cell-class-name="wrap-cell">
                        <template #default="{ row: d }">
                          <span>{{ d.className }}</span>
                          <el-tag
                            v-if="d.isCombined"
                            size="small"
                            effect="plain"
                            class="tag-item combined-tag"
                            disable-transitions
                            >合班<span v-if="d.combinationNo" class="combined-group-no">{{
                              d.combinationNo
                            }}</span></el-tag
                          >
                        </template>
                      </el-table-column>
                      <el-table-column v-if="!isMobile" label="学院" min-width="8">
                        <template #default="{ row: d }">
                          <el-tag
                            v-if="d.collegeName"
                            size="small"
                            type="info"
                            effect="plain"
                            disable-transitions
                            >{{ d.collegeName }}</el-tag
                          >
                          <span v-else class="text-muted">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column v-if="!isMobile" label="层次" min-width="6">
                        <template #default="{ row: d }">
                          <el-tag
                            v-if="d.trainingLevelName"
                            size="small"
                            class="tag-indigo"
                            disable-transitions
                            >{{ d.trainingLevelName }}</el-tag
                          >
                          <span v-else class="text-muted">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column label="教材名称" min-width="16" cell-class-name="wrap-cell">
                        <template #default="{ row: d }">
                          <span v-if="d.textbookName">{{ d.textbookName }}</span>
                          <span v-else class="text-muted">未指定</span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column type="index" label="#" width="48" />
            <el-table-column
              prop="teacherName"
              label="教师姓名"
              :min-width="isMobile ? 96 : 10"
            />
            <el-table-column label="类别" width="88" align="center">
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
              label="学科"
              :min-width="isMobile ? 132 : 18"
              cell-class-name="wrap-cell"
            >
              <template #default="{ row }">
                <el-tag
                  v-for="c in row.courseList"
                  :key="c.id"
                  size="small"
                  effect="plain"
                  class="tag-item"
                  disable-transitions
                  >{{ c.name }}</el-tag
                >
                <span v-if="!row.courseList?.length" class="text-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column v-if="!isMobile" label="归属学院" min-width="12">
              <template #default="{ row }">
                <span>{{ row.affiliatedCollege?.name || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column
              v-if="!isMobile"
              label="任课学院"
              min-width="14"
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
            <el-table-column
              v-if="!isMobile"
              label="层次"
              min-width="10"
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
              label="教材数量"
              width="92"
              align="center"
              sortable
              :sort-method="(a, b) => a.textbookCount - b.textbookCount"
            >
              <template #default="{ row }">
                <el-tooltip
                  v-if="row.textbookNames?.length"
                  :content="row.textbookNames.join('、')"
                  placement="top"
                >
                  <span class="count-value">{{ row.textbookCount }}</span>
                </el-tooltip>
                <span v-else>{{ row.textbookCount || 0 }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="pagination-container">
          <el-pagination
            v-model:current-page="teacherPage"
            v-model:page-size="teacherPageSize"
            :total="filteredTeachers.length"
            :page-sizes="[20, 50, 100]"
            :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next'"
            background
            @size-change="teacherPage = 1"
          />
        </div>
      </div>

      <!-- 按教材查询 -->
      <div v-else>
        <div class="table-scroll-wrap">
          <el-table
            v-loading="loading"
            :data="pagedTextbooks"
            stripe
            row-key="textbookId"
            class="load-table"
          >
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="expand-content">
                  <div class="nested-scroll">
                    <el-table
                      :data="row.groups"
                      size="small"
                      border
                      class="nested-table"
                      :row-key="groupRowKey"
                    >
                      <el-table-column label="层次" min-width="8">
                        <template #default="{ row: g }">
                          <el-tag
                            v-if="g.levelName"
                            size="small"
                            class="tag-indigo"
                            disable-transitions
                            >{{ g.levelName }}</el-tag
                          >
                          <span v-else class="text-muted">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column
                        v-if="!isMobile"
                        label="专业"
                        min-width="12"
                        cell-class-name="wrap-cell"
                      >
                        <template #default="{ row: g }">
                          <span v-if="g.majorName">{{ g.majorName }}</span>
                          <span v-else class="text-muted">-</span>
                        </template>
                      </el-table-column>
                      <el-table-column
                        prop="classCount"
                        label="班级数"
                        width="80"
                        align="center"
                      />
                      <el-table-column
                        prop="studentCount"
                        label="学生人数"
                        width="92"
                        align="center"
                      />
                      <el-table-column label="任课教师" min-width="20" cell-class-name="wrap-cell">
                        <template #default="{ row: g }">
                          <el-tag
                            v-for="t in g.teachers"
                            :key="t.id"
                            size="small"
                            effect="plain"
                            class="tag-item"
                            disable-transitions
                            >{{ t.name }}</el-tag
                          >
                          <span v-if="!g.teachers?.length" class="text-muted">-</span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column type="index" label="#" width="48" />
            <el-table-column
              label="学科"
              :min-width="isMobile ? 72 : 12"
              cell-class-name="wrap-cell"
            >
              <template #default="{ row }">
                <el-tag v-if="row.primaryCourse" size="small" class="tag-item" disable-transitions>{{
                  row.primaryCourse.name
                }}</el-tag>
                <el-tag
                  v-for="c in row.extraCourses"
                  :key="c.id"
                  size="small"
                  type="info"
                  effect="plain"
                  class="tag-item"
                  disable-transitions
                  >{{ c.name }}</el-tag
                >
                <span v-if="!row.primaryCourse" class="text-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column
              prop="title"
              label="教材名称"
              :min-width="isMobile ? 150 : 22"
              show-overflow-tooltip
            />
            <el-table-column
              v-if="!isMobile"
              prop="publisher"
              label="出版社"
              min-width="12"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                <span>{{ row.publisher || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column
              prop="classCount"
              label="班级数"
              width="84"
              align="center"
              sortable
              :sort-method="(a, b) => a.classCount - b.classCount"
            />
            <el-table-column
              prop="studentCount"
              label="学生人数"
              width="92"
              align="center"
              sortable
              :sort-method="(a, b) => a.studentCount - b.studentCount"
            />
            <el-table-column v-if="!isMobile" label="教师数" width="84" align="center">
              <template #default="{ row }">
                <el-tooltip
                  v-if="row.teachers?.length"
                  :content="row.teachers.map((t) => t.name).join('、')"
                  placement="top"
                >
                  <span class="count-value">{{ row.teacherCount }}</span>
                </el-tooltip>
                <span v-else>{{ row.teacherCount || 0 }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="pagination-container">
          <el-pagination
            v-model:current-page="textbookPage"
            v-model:page-size="textbookPageSize"
            :total="filteredTextbooks.length"
            :page-sizes="[20, 50, 100]"
            :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next'"
            background
            @size-change="textbookPage = 1"
          />
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { Calendar, Refresh, Download } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { personnelLabel, personnelTagType } from '@/utils/personnel';
import { useResponsive } from '@/composables/useResponsive';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import ListErrorState from '@/components/ListErrorState.vue';
import FilterBar from '@/components/filter/FilterBar.vue';
import { useTeacherLoadQuery } from './composables/useTeacherLoadQuery';

defineOptions({ name: 'TeacherLoadQuery' });

const authStore = useAuthStore();
/* 响应式断点：复用全局共享实例，移动端隐藏次要列避免表格被极限压缩 */
const { isMobile } = useResponsive();

const {
  availableSemesters,
  semester,
  isCurrentSemester,
  initSemester,
  handleSemesterChange,
  goToCurrentSemester,
  activeTab,
  data,
  loading,
  error,
  exporting,
  summary,
  teacherFilters,
  teacherCourseOptions,
  teacherCollegeOptions,
  teacherLevelOptions,
  affiliatedCollegeOptions,
  filteredTeachers,
  pagedTeachers,
  teacherPage,
  teacherPageSize,
  textbookFilters,
  textbookCourseOptions,
  textbookLevelOptions,
  textbookMajorOptions,
  filteredTextbooks,
  pagedTextbooks,
  textbookPage,
  textbookPageSize,
  activeFilterCount,
  resetFilters,
  loadData,
  handleExport,
} = useTeacherLoadQuery();

const summaryText = computed(() => {
  if (!summary.value) return '';
  const subject =
    activeTab.value === 'teacher'
      ? `${summary.value.totalTeachers} 位教师任课`
      : `${summary.value.totalTextbooks} 本教材在用`;
  return `本学期共 ${subject}，覆盖 ${summary.value.totalClasses} 个班级、${summary.value.totalStudents} 名学生`;
});

/* 教材视图内嵌行可能缺层次或专业，用占位符构造稳定 row-key */
function groupRowKey(group) {
  return `${group.levelId ?? 'na'}-${group.majorId ?? 'na'}`;
}

onMounted(initSemester);
</script>

<style scoped>
.load-tabs {
  margin-bottom: var(--space-2);
}
.alert-note {
  margin-bottom: var(--space-2);
}
.alert-summary {
  margin-bottom: var(--space-3);
}
.expand-content {
  padding: var(--space-2) var(--space-4);
}
.load-table {
  width: 100%;
}
.nested-table {
  margin: 4px 0;
}
.tag-item {
  margin: 2px;
}
.text-muted {
  color: var(--text-secondary);
}
.count-value {
  font-weight: var(--fw-bold);
  cursor: default;
}
.combined-tag {
  margin-left: var(--space-1);
  vertical-align: middle;
  cursor: default;
}
/* 合班组号角标 — 实心紫色小圆标，同组班级编号一致，便于识别谁和谁合班 */
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
/* 标签密集列允许换行，避免学院/学科名称被单元格 nowrap 裁切 */
.teacher-load-query :deep(.wrap-cell .cell) {
  white-space: normal;
  line-height: 1.5;
}
/* 表头强制单行不换行（与单元格换行互不干扰） */
.teacher-load-query :deep(.el-table__header .cell) {
  white-space: nowrap;
}
</style>
