<template>
  <div class="teaching-arrange">
    <!-- 设置区 -->
    <el-card class="settings-card">
      <template #header>
        <div class="card-header">
          <span
            ><el-icon><Setting /></el-icon> 教学安排设置</span
          >
          <div class="card-header-actions">
            <el-tag type="info">{{ currentSemesterLabel }}</el-tag>
            <el-select
              v-model="selectedCourseId"
              placeholder="请选择课程"
              filterable
              clearable
              style="width: 220px"
              @change="onCourseChange"
            >
              <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id">
                <span>{{ c.name }}</span>
                <span style="color: #999; font-size: 12px; margin-left: 8px">{{ c.code }}</span>
              </el-option>
            </el-select>
          </div>
        </div>
      </template>

      <!-- 课时设置 -->
      <div v-if="selectedCourseId" class="hour-settings">
        <span class="hour-settings-title">课时要求</span>
        <div v-for="type in personnelTypes" :key="type.key" class="hour-setting-item">
          <span class="type-label">{{ type.label }}</span>
          <span class="setting-field">
            <span class="field-label">标准</span>
            <el-input-number
              v-model="hourSettings[type.key].standard"
              :min="0"
              :max="40"
              :step="1"
              controls-position="right"
              size="small"
              style="width: 80px"
            />
          </span>
          <span class="setting-field">
            <span class="field-label">最大</span>
            <el-input-number
              v-model="hourSettings[type.key].max"
              :min="0"
              :max="40"
              :step="1"
              controls-position="right"
              size="small"
              style="width: 80px"
            />
          </span>
        </div>
        <el-button
          type="primary"
          size="small"
          :loading="savingSettings"
          @click="handleSaveHourSettings"
        >
          <el-icon><Check /></el-icon> 确定
        </el-button>
      </div>
      <el-empty v-else description="请选择课程查看教学安排" />
    </el-card>

    <!-- 预览区（合并课程信息 + 统计报告） -->
    <el-card v-if="selectedCourseId && courseInfo" class="preview-card">
      <template #header>
        <div class="card-header">
          <div class="preview-title">
            <span class="course-name">{{ courseInfo.name }}</span>
            <el-tag size="small">{{ courseTypeLabel(courseInfo.type) }}</el-tag>
          </div>
          <el-button v-if="classList.length" :loading="exporting" @click="handleExportArrange"
            >数据导出</el-button
          >
        </div>
      </template>
      <div class="preview-stats">
        <div class="preview-stat-item">
          <span class="stat-label">教师</span>
          <span class="stat-value">{{ teacherList.length }}<small>人</small></span>
        </div>
        <div class="preview-stat-item">
          <span class="stat-label">班级</span>
          <span class="stat-value">{{ summary.totalClasses }}<small>个</small></span>
        </div>
        <div class="preview-stat-item">
          <span class="stat-label">已安排</span>
          <span class="stat-value">{{ summary.assignedCount }}<small>个</small></span>
        </div>
        <div class="preview-stat-item">
          <span class="stat-label">总课时</span>
          <span class="stat-value">{{ summary.totalCourseHours }}<small>课时</small></span>
        </div>
        <div class="preview-stat-item">
          <span class="stat-label">剩余课时</span>
          <span
            class="stat-value"
            :class="summary.remainingHours >= 0 ? 'text-success' : 'text-danger'"
          >
            {{ summary.remainingHours }}<small>课时</small>
          </span>
        </div>
      </div>
    </el-card>

    <!-- 内容区：矩阵表 -->
    <el-card v-if="selectedCourseId" class="matrix-card">
      <template #header>
        <div class="card-header">
          <span>教学安排</span>
          <div class="card-header-actions">
            <el-select
              v-model="filterCollege"
              placeholder="学院"
              clearable
              filterable
              style="width: 130px"
              @change="
                filterMajor = '';
                filterTextbook = '';
              "
            >
              <el-option v-for="v in collegeOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select
              v-model="filterMajor"
              placeholder="专业"
              clearable
              filterable
              style="width: 130px"
              @change="filterTextbook = ''"
            >
              <el-option v-for="v in majorOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select
              v-model="filterTrainingLevel"
              placeholder="层次"
              clearable
              style="width: 100px"
            >
              <el-option v-for="v in trainingLevelOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-select v-model="filterGrade" placeholder="年级" clearable style="width: 90px">
              <el-option v-for="v in gradeOptions" :key="v" :label="v + '年级'" :value="v" />
            </el-select>
            <el-select
              v-model="filterTextbook"
              placeholder="教材"
              clearable
              filterable
              style="width: 140px"
            >
              <el-option v-for="v in textbookOptions" :key="v" :label="v" :value="v" />
            </el-select>
            <el-checkbox v-model="previewMode" style="margin-left: 8px">预览模式</el-checkbox>
            <el-button type="success" :loading="arranging" @click="handleAutoArrange('full')">
              <el-icon><MagicStick /></el-icon> 全量模式
            </el-button>
            <el-button type="warning" :loading="arranging" @click="handleAutoArrange('standard')">
              <el-icon><SetUp /></el-icon> 标准模式
            </el-button>
            <el-dropdown
              :disabled="batchArranging"
              style="margin-left: 4px"
              @command="handleBatchAutoArrange"
            >
              <el-button type="primary" :loading="batchArranging">
                批量排课<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="full">全量模式（所有课程）</el-dropdown-item>
                  <el-dropdown-item command="standard">标准模式（所有课程）</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-popconfirm title="确定重置所有自动安排？" @confirm="handleReset">
              <template #reference>
                <el-button type="danger">
                  <el-icon><RefreshRight /></el-icon> 重置
                </el-button>
              </template>
            </el-popconfirm>
          </div>
        </div>
      </template>

      <el-table
        :key="filterCollege + filterMajor + filterGrade + filterTrainingLevel + filterTextbook"
        v-loading="tableLoading"
        :data="filteredClassList"
        stripe
        row-key="classId"
        :row-class-name="tableRowClassName"
        class="adaptive-table"
      >
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="className" label="班级名称" min-width="140" show-overflow-tooltip />
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
        <el-table-column label="教材" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <template v-if="row.textbooks?.length">
              <el-tag
                v-for="tb in row.textbooks"
                :key="tb.id"
                size="small"
                type="info"
                class="tag-item"
                >{{ tb.title }}</el-tag
              >
            </template>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="任课教师" min-width="140">
          <template #default="{ row }">
            <div
              class="teacher-cell"
              :class="{ 'has-teacher': row.assignment, 'no-teacher': !row.assignment }"
              @click="openTeacherSelect(row)"
            >
              <template v-if="row.assignment">
                <el-tag
                  :type="row.assignment.isAuto ? 'info' : 'primary'"
                  size="small"
                  closable
                  @close.stop="handleRemoveAssignment(row)"
                >
                  {{ row.assignment.teacherName }}
                </el-tag>
              </template>
              <span v-else class="text-placeholder">点击安排</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 教师选择弹窗 -->
    <el-dialog
      v-model="teacherDialogVisible"
      title="选择任课教师"
      width="80%"
      destroy-on-close
      class="teacher-dialog"
    >
      <el-table
        :data="teacherList"
        stripe
        highlight-current-row
        size="small"
        @current-change="onTeacherSelect"
      >
        <el-table-column prop="name" label="姓名" width="55" />
        <el-table-column label="人员类别" width="80" align="center">
          <template #default="{ row }">{{ personnelLabel(row.personnelType) }}</template>
        </el-table-column>
        <el-table-column label="当前总课时" width="90" align="center">
          <template #default="{ row }">
            <span
              :class="{
                'text-warning':
                  row.totalWeeklyHours >
                  (row.defaultWeeklyHours ??
                    hourSettings[row.personnelType || 'full_time']?.standard ??
                    16),
              }"
            >
              {{ row.totalWeeklyHours }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="班级数" width="70" align="center">
          <template #default="{ row }">{{ row.totalClassCount }}</template>
        </el-table-column>
        <el-table-column label="学科" min-width="100">
          <template #default="{ row }">
            <el-tag v-for="c in row.courseList" :key="c.id" size="small" class="tag-item">{{
              c.name
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="任课学院" min-width="120">
          <template #default="{ row }">
            <el-tag
              v-for="c in row.collegeList"
              :key="c.id"
              size="small"
              type="info"
              class="tag-item"
              >{{ c.name }}</el-tag
            >
          </template>
        </el-table-column>
        <el-table-column label="任课层次" min-width="120">
          <template #default="{ row }">
            <el-tag
              v-for="l in row.trainingLevelList"
              :key="l.id"
              size="small"
              type="warning"
              class="tag-item"
              >{{ l.name }}</el-tag
            >
          </template>
        </el-table-column>
        <el-table-column label="已用教材" min-width="220">
          <template #default="{ row }">
            <template v-if="row.assignedTextbooks?.length">
              <el-tag
                v-for="tb in row.assignedTextbooks"
                :key="tb.id"
                size="small"
                type="info"
                class="tag-item"
                >{{ tb.title }}</el-tag
              >
            </template>
            <span v-else class="text-placeholder">-</span>
          </template>
        </el-table-column>
        <el-table-column label="特定周课时" min-width="90" align="center">
          <template #default="{ row }">{{ row.defaultWeeklyHours ?? '-' }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="teacherDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!selectedTeacher"
          :loading="assigning"
          @click="confirmTeacherSelect"
          >确定</el-button
        >
      </template>
    </el-dialog>

    <!-- 批量排课结果弹窗 -->
    <el-dialog
      v-model="batchResultVisible"
      title="批量排课结果"
      width="900px"
      destroy-on-close
      class="batch-result-dialog"
      top="6vh"
    >
      <!-- 汇总统计 -->
      <div class="batch-summary">
        <div class="batch-stat-card" :class="{ 'is-success': true }">
          <div class="batch-stat-num">{{ batchResult.summary?.totalCourses || 0 }}</div>
          <div class="batch-stat-label">课程总数</div>
        </div>
        <div class="batch-stat-card is-success">
          <div class="batch-stat-num text-success">
            {{ batchResult.summary?.totalAssigned || 0 }}
          </div>
          <div class="batch-stat-label">已安排班级</div>
        </div>
        <div
          class="batch-stat-card"
          :class="{ 'is-warning': (batchResult.summary?.totalUnassigned || 0) > 0 }"
        >
          <div
            class="batch-stat-num"
            :class="(batchResult.summary?.totalUnassigned || 0) > 0 ? 'text-warning' : ''"
          >
            {{ batchResult.summary?.totalUnassigned || 0 }}
          </div>
          <div class="batch-stat-label">未分配班级</div>
        </div>
        <div
          class="batch-stat-card"
          :class="{ 'is-danger': (batchResult.summary?.errorCount || 0) > 0 }"
        >
          <div
            class="batch-stat-num"
            :class="(batchResult.summary?.errorCount || 0) > 0 ? 'text-danger' : ''"
          >
            {{ batchResult.summary?.errorCount || 0 }}
          </div>
          <div class="batch-stat-label">出错课程</div>
        </div>
      </div>

      <!-- 筛选标签 -->
      <div class="batch-filter-tabs">
        <el-radio-group v-model="batchResultFilter" size="small">
          <el-radio-button value="all"
            >全部 ({{ (batchResult.courseResults || []).length }})</el-radio-button
          >
          <el-radio-button value="issue">有问题 ({{ batchIssueCount }})</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 课程结果列表 -->
      <div class="batch-course-list">
        <div
          v-for="r in filteredBatchResults"
          :key="r.courseId"
          class="batch-course-item"
          :class="{ 'has-error': r.error, 'has-unassigned': r.unassignedCount > 0 }"
        >
          <div class="course-item-header" @click="toggleCourseDetail(r.courseId)">
            <div class="course-item-left">
              <el-icon class="expand-icon" :class="{ expanded: expandedCourses.has(r.courseId) }"
                ><ArrowRight
              /></el-icon>
              <span class="course-item-name">{{ r.courseName }}</span>
            </div>
            <div class="course-item-right">
              <el-tag v-if="r.error" type="danger" size="small">出错</el-tag>
              <el-tag v-if="r.unassignedCount > 0" type="warning" size="small"
                >{{ r.unassignedCount }} 未分配</el-tag
              >
              <el-tag v-if="!r.error && r.unassignedCount === 0" type="success" size="small"
                >完成</el-tag
              >
              <span class="course-item-stat">{{ r.autoCount || 0 }}/{{ r.totalClasses || 0 }}</span>
            </div>
          </div>
          <div v-if="expandedCourses.has(r.courseId)" class="course-item-detail">
            <div v-if="r.error" class="detail-error">
              <el-icon><WarningFilled /></el-icon> {{ r.error }}
            </div>
            <div v-if="r.warnings?.length" class="detail-warnings">
              <div v-for="(w, i) in r.warnings" :key="i" class="detail-warning-item">
                <el-icon><Warning /></el-icon> {{ w }}
              </div>
            </div>
            <div v-if="r.unassigned?.length" class="detail-unassigned">
              <div class="detail-section-title">未分配班级</div>
              <div v-for="u in r.unassigned" :key="u.classId" class="detail-unassigned-item">
                <span class="unassigned-class-name">{{ u.className }}</span>
                <span class="unassigned-hours">{{ u.weeklyHours }} 课时</span>
                <span v-if="u.reason" class="unassigned-reason">{{ u.reason }}</span>
              </div>
            </div>
            <div v-if="!r.error && !r.unassigned?.length && !r.warnings?.length" class="detail-ok">
              所有 {{ r.autoCount || 0 }} 个班级均已安排
            </div>
          </div>
        </div>
        <el-empty
          v-if="filteredBatchResults.length === 0"
          description="没有匹配的课程"
          :image-size="60"
        />
      </div>

      <template #footer>
        <el-button type="primary" @click="batchResultVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 单课程排课结果弹窗 -->
    <el-dialog
      v-model="arrangeResultVisible"
      :title="`${arrangeResultMode}排课结果`"
      width="640px"
      destroy-on-close
      class="arrange-result-dialog"
      top="10vh"
    >
      <!-- 汇总统计 -->
      <div class="arrange-summary">
        <div class="arrange-stat-card is-success">
          <div class="arrange-stat-num text-success">{{ arrangeResult.autoCount || 0 }}</div>
          <div class="arrange-stat-label">自动安排</div>
        </div>
        <div class="arrange-stat-card">
          <div class="arrange-stat-num">{{ arrangeResult.manualCount || 0 }}</div>
          <div class="arrange-stat-label">手动安排</div>
        </div>
        <div
          class="arrange-stat-card"
          :class="{ 'is-warning': (arrangeResult.unassignedCount || 0) > 0 }"
        >
          <div
            class="arrange-stat-num"
            :class="(arrangeResult.unassignedCount || 0) > 0 ? 'text-warning' : ''"
          >
            {{ arrangeResult.unassignedCount || 0 }}
          </div>
          <div class="arrange-stat-label">未分配</div>
        </div>
        <div class="arrange-stat-card">
          <div class="arrange-stat-num">{{ arrangeResult.totalClasses || 0 }}</div>
          <div class="arrange-stat-label">班级总数</div>
        </div>
      </div>

      <!-- 教材内聚度指标（预览模式下后端透出 statistics） -->
      <div v-if="arrangeResult.statistics" class="arrange-cohesion">
        <div class="cohesion-title">教材内聚度</div>
        <div class="cohesion-metrics">
          <div class="cohesion-metric">
            <span class="cohesion-num" :class="cohesionRateClass"
              >{{ arrangeResult.statistics.textbookCohesionRate ?? '-' }}%</span
            >
            <span class="cohesion-label">内聚率</span>
          </div>
          <div class="cohesion-metric">
            <span class="cohesion-num">{{
              arrangeResult.statistics.avgTextbookPerTeacher ?? '-'
            }}</span>
            <span class="cohesion-label">人均教材数</span>
          </div>
          <div class="cohesion-metric">
            <span
              class="cohesion-num"
              :class="{ 'text-warning': (arrangeResult.statistics.scatteredTeacherCount || 0) > 0 }"
              >{{ arrangeResult.statistics.scatteredTeacherCount ?? 0 }}</span
            >
            <span class="cohesion-label">分散教师数</span>
          </div>
        </div>
        <div class="cohesion-hint">内聚率越高表示教师教材越集中；分散教师数指教材数≥3 的教师</div>
      </div>

      <!-- 警告信息 -->
      <div v-if="arrangeResult.warnings?.length" class="arrange-warnings">
        <div v-for="(w, i) in arrangeResult.warnings" :key="i" class="arrange-warning-item">
          <el-icon><Warning /></el-icon> {{ w }}
        </div>
      </div>

      <!-- 未分配班级详情 -->
      <div v-if="arrangeResult.unassigned?.length" class="arrange-unassigned">
        <div class="arrange-section-title">未分配班级</div>
        <div v-for="u in arrangeResult.unassigned" :key="u.classId" class="arrange-unassigned-item">
          <span class="unassigned-class-name">{{ u.className }}</span>
          <span class="unassigned-hours">{{ u.weeklyHours }} 课时</span>
          <span v-if="u.reason" class="unassigned-reason">{{ u.reason }}</span>
        </div>
      </div>

      <!-- 全部完成 -->
      <div
        v-if="!arrangeResult.unassigned?.length && !arrangeResult.warnings?.length"
        class="arrange-all-done"
      >
        <el-icon :size="24" color="#67C23A"><CircleCheckFilled /></el-icon>
        <span>所有班级均已安排</span>
      </div>

      <template #footer>
        <el-button @click="arrangeResultVisible = false">关闭</el-button>
        <el-button
          v-if="previewMode"
          type="primary"
          :loading="arranging"
          @click="handleExecutePreview"
        >
          <el-icon><Check /></el-icon> 执行排课
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue';
import {
  MagicStick,
  SetUp,
  RefreshRight,
  Check,
  ArrowDown,
  ArrowRight,
  WarningFilled,
  Warning,
  CircleCheckFilled,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getCourses } from '../../api/course';
import request from '../../utils/request';
import { downloadBlob } from '../../utils/download';
import { personnelLabel } from '../../utils/personnel';
import {
  getCourseClasses,
  getCourseTeachers,
  assignTeacher,
  deleteAssignment,
  runAutoArrange,
  runBatchAutoArrange,
  resetAutoAssignments,
  getHourSettings,
  saveHourSettings,
} from '../../api/teachingArrange';

// 学期相关
const currentSemesterLabel = ref('');
const selectedCourseId = ref(null);
const allCourses = ref([]);
const courseInfo = ref(null);

// 课时设置
const personnelTypes = [
  { key: 'full_time', label: '专职' },
  { key: 'part_time', label: '兼职' },
  { key: 'external', label: '外聘' },
];
const defaultHourSettings = {
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
};
const hourSettings = reactive({
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
});

// 数据
const classList = ref([]);
const teacherList = ref([]);
const tableLoading = ref(false);
const summary = ref({
  totalClasses: 0,
  assignedCount: 0,
  unassignedCount: 0,
  totalCourseHours: 0,
  assignedHours: 0,
  remainingHours: 0,
});

// 筛选器
const filterCollege = ref('');
const filterMajor = ref('');
const filterGrade = ref('');
const filterTrainingLevel = ref('');
const filterTextbook = ref('');
const previewMode = ref(false);

const collegeOptions = computed(() => {
  const set = new Set(classList.value.map((c) => c.collegeName).filter(Boolean));
  return [...set].sort();
});

const majorOptions = computed(() => {
  let list = classList.value;
  if (filterCollege.value) list = list.filter((c) => c.collegeName === filterCollege.value);
  const set = new Set(list.map((c) => c.majorName).filter(Boolean));
  return [...set].sort();
});

const gradeOptions = computed(() => {
  const set = new Set(classList.value.map((c) => c.grade).filter(Boolean));
  return [...set].sort((a, b) => a - b);
});

const trainingLevelOptions = computed(() => {
  const set = new Set(classList.value.map((c) => c.trainingLevelName).filter(Boolean));
  return [...set].sort();
});

const textbookOptions = computed(() => {
  const set = new Set();
  classList.value.forEach((c) => {
    (c.textbooks || []).forEach((tb) => {
      if (tb.title) set.add(tb.title);
    });
  });
  return [...set].sort();
});

const filteredClassList = computed(() => {
  return classList.value.filter((c) => {
    if (filterCollege.value && c.collegeName !== filterCollege.value) return false;
    if (filterMajor.value && c.majorName !== filterMajor.value) return false;
    if (filterGrade.value && c.grade !== filterGrade.value) return false;
    if (filterTrainingLevel.value && c.trainingLevelName !== filterTrainingLevel.value)
      return false;
    if (filterTextbook.value) {
      const titles = (c.textbooks || []).map((tb) => tb.title);
      if (!titles.includes(filterTextbook.value)) return false;
    }
    return true;
  });
});

// 自动排课状态
const arranging = ref(false);
const batchArranging = ref(false);

// 教师选择弹窗
const teacherDialogVisible = ref(false);
const currentClass = ref(null);
const selectedTeacher = ref(null);
const assigning = ref(false);
const savingSettings = ref(false);
const exporting = ref(false);

// 批量排课结果弹窗
const batchResultVisible = ref(false);
const batchResult = ref({});
const batchResultFilter = ref('all');
const expandedCourses = ref(new Set());

const batchIssueCount = computed(() => {
  const results = batchResult.value.courseResults || [];
  return results.filter((r) => r.error || r.unassignedCount > 0).length;
});

const filteredBatchResults = computed(() => {
  const results = batchResult.value.courseResults || [];
  if (batchResultFilter.value === 'issue') {
    return results.filter((r) => r.error || r.unassignedCount > 0);
  }
  return results;
});

function toggleCourseDetail(courseId) {
  const s = new Set(expandedCourses.value);
  if (s.has(courseId)) s.delete(courseId);
  else s.add(courseId);
  expandedCourses.value = s;
}

// 单课程排课结果弹窗
const arrangeResultVisible = ref(false);
const arrangeResult = ref({});
const arrangeResultMode = ref('');

// 教材内聚率颜色分级
const cohesionRateClass = computed(() => {
  const rate = arrangeResult.value?.statistics?.textbookCohesionRate;
  if (rate == null) return '';
  if (rate >= 70) return 'text-success';
  if (rate >= 40) return 'text-warning';
  return 'text-danger';
});

function courseTypeLabel(type) {
  return { public: '公共课', professional: '专业课', elective: '选修课' }[type] || type;
}

function tableRowClassName({ row }) {
  return row.assignment ? '' : 'unassigned-row';
}

async function loadHourSettings(courseId) {
  // 先重置为默认值
  Object.assign(hourSettings, JSON.parse(JSON.stringify(defaultHourSettings)));
  if (!courseId) return;
  try {
    const res = await getHourSettings({ course_id: courseId });
    if (res.data) {
      // 后端响应会被命名中间件转成 camelCase（fullTime/partTime），
      // 这里映射回前端使用的 snake_case key
      const d = res.data;
      if (d.fullTime) hourSettings.full_time = { ...d.fullTime };
      if (d.partTime) hourSettings.part_time = { ...d.partTime };
      if (d.external) hourSettings.external = { ...d.external };
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('加载课时设置失败:', e);
    }
  }
}

async function handleSaveHourSettings() {
  savingSettings.value = true;
  try {
    await saveHourSettings({
      course_id: selectedCourseId.value,
      hour_settings: hourSettings,
    });
    ElMessage.success('课时要求已保存');
  } catch (e) {
    ElMessage.error('保存失败');
    if (import.meta.env.DEV) {
      console.error('保存课时设置失败:', e);
    }
  } finally {
    savingSettings.value = false;
  }
}

async function loadSemester() {
  try {
    const res = await request.get('/settings');
    const settings = res.data || {};
    if (settings.currentSemester) {
      currentSemesterLabel.value = settings.currentSemester.value;
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('获取学期失败:', e);
    }
  }
}

async function loadCourses() {
  try {
    const res = await getCourses();
    allCourses.value = res.data || [];
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('加载课程列表失败:', e);
    }
  }
}

async function onCourseChange(courseId) {
  // 重置筛选器
  filterCollege.value = '';
  filterMajor.value = '';
  filterGrade.value = '';
  filterTrainingLevel.value = '';
  filterTextbook.value = '';
  if (!courseId) {
    classList.value = [];
    teacherList.value = [];
    courseInfo.value = null;
    loadHourSettings(null);
    return;
  }
  courseInfo.value = allCourses.value.find((c) => c.id === courseId) || null;
  loadHourSettings(courseId);
  await loadData();
}

async function loadData() {
  if (!selectedCourseId.value || !currentSemesterLabel.value) return;
  tableLoading.value = true;
  try {
    const [classesRes, teachersRes] = await Promise.all([
      getCourseClasses({ course_id: selectedCourseId.value, semester: currentSemesterLabel.value }),
      getCourseTeachers({
        course_id: selectedCourseId.value,
        semester: currentSemesterLabel.value,
      }),
    ]);
    const classData = classesRes.data || {};
    classList.value = classData.classes || [];
    summary.value = classData.summary || {
      totalClasses: 0,
      assignedCount: 0,
      unassignedCount: 0,
      totalCourseHours: 0,
      assignedHours: 0,
      remainingHours: 0,
    };
    teacherList.value = teachersRes.data || [];
  } catch (e) {
    ElMessage.error('加载数据失败');
    if (import.meta.env.DEV) {
      console.error('加载数据失败:', e);
    }
  } finally {
    tableLoading.value = false;
  }
}

function openTeacherSelect(row) {
  currentClass.value = row;
  selectedTeacher.value = null;
  teacherDialogVisible.value = true;
}

function onTeacherSelect(teacher) {
  selectedTeacher.value = teacher;
}

async function confirmTeacherSelect() {
  if (!selectedTeacher.value || !currentClass.value) return;
  assigning.value = true;
  try {
    await assignTeacher({
      classId: currentClass.value.classId,
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
      teacherId: selectedTeacher.value.id,
      weeklyHours: currentClass.value.weeklyHours,
    });
    ElMessage.success('安排成功');
    teacherDialogVisible.value = false;
    await loadData();
  } catch (e) {
    ElMessage.error('安排失败');
  } finally {
    assigning.value = false;
  }
}

async function handleRemoveAssignment(row) {
  if (!row.assignment?.id) return;
  try {
    await deleteAssignment(row.assignment.id);
    ElMessage.success('已移除安排');
    await loadData();
  } catch (e) {
    ElMessage.error('操作失败');
  }
}

async function handleAutoArrange(mode) {
  const modeLabel = mode === 'full' ? '全量模式' : '标准模式';
  
  // 根据是否预览模式显示不同的提示
  let confirmMessage;
  if (previewMode.value) {
    confirmMessage = `将以「${modeLabel}」预览自动排课结果（不会写入数据库）。预览满意后可在结果弹窗中点击“执行排课”按钮应用结果。确定继续？`;
  } else {
    confirmMessage = `将以「${modeLabel}」自动安排当前课程的所有班级（已有手动安排不会被覆盖）。确定继续？`;
  }
  
  try {
    await ElMessageBox.confirm(
      confirmMessage,
      previewMode.value ? `预览排课 - ${modeLabel}` : `自动排课 - ${modeLabel}`,
      { 
        confirmButtonText: previewMode.value ? '开始预览' : '确定排课', 
        cancelButtonText: '取消', 
        type: 'warning' 
      }
    );
  } catch {
    return;
  }

  arranging.value = true;
  try {
    const res = await runAutoArrange({
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
      mode,
      hourSettings,
      preview: previewMode.value, // 传递预览模式参数
    });
    const data = res.data || {};
    arrangeResult.value = data;
    arrangeResultMode.value = modeLabel;
    arrangeResultVisible.value = true;

    // 如果不是预览模式，才刷新数据
    if (!previewMode.value) {
      await loadData();
    }
  } catch (e) {
    ElMessage.error('自动排课失败');
    if (import.meta.env.DEV) {
      console.error('自动排课失败:', e);
    }
  } finally {
    arranging.value = false;
  }
}

// 执行预览结果（关闭预览弹窗，以非预览模式重新排课）
async function handleExecutePreview() {
  // 临时关闭预览模式
  const wasPreview = previewMode.value;
  previewMode.value = false;
  
  // 提取当前模式
  const mode = arrangeResultMode.value === '全量模式' ? 'full' : 'standard';
  
  // 直接执行排课（不再显示确认对话框，因为用户已经在预览时看过了）
  arranging.value = true;
  try {
    await runAutoArrange({
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
      mode,
      hourSettings,
      preview: false, // 非预览模式，实际写入数据库
    });
    
    // 刷新页面数据
    await loadData();
    
    ElMessage.success('排课已执行');
    
    // 关闭预览弹窗
    arrangeResultVisible.value = false;
  } catch (e) {
    ElMessage.error('执行排课失败');
    if (import.meta.env.DEV) {
      console.error('执行排课失败:', e);
    }
  } finally {
    arranging.value = false;
    // 恢复预览模式状态
    previewMode.value = wasPreview;
  }
}

async function handleBatchAutoArrange(mode) {
  const modeLabel = mode === 'full' ? '全量模式' : '标准模式';
  try {
    await ElMessageBox.confirm(
      `将以「${modeLabel}」自动安排当前学期下所有课程的班级。这会覆盖所有课程的自动安排（手动安排不受影响）。确定继续？`,
      `批量排课 - ${modeLabel}`,
      { confirmButtonText: '确定批量排课', cancelButtonText: '取消', type: 'warning' }
    );
  } catch {
    return;
  }

  batchArranging.value = true;
  try {
    const res = await runBatchAutoArrange({
      semester: currentSemesterLabel.value,
      mode,
      hourSettings,
    });
    const data = res.data || {};
    const s = data.summary || {};

    // 设置批量结果数据并打开弹窗
    batchResult.value = data;
    batchResultFilter.value = s.totalUnassigned > 0 || s.errorCount > 0 ? 'issue' : 'all';
    const issueIds = new Set(
      (data.courseResults || [])
        .filter((r) => r.error || r.unassignedCount > 0)
        .map((r) => r.courseId)
    );
    expandedCourses.value = issueIds;
    batchResultVisible.value = true;

    await loadData();
  } catch (e) {
    ElMessage.error('批量排课失败');
    if (import.meta.env.DEV) {
      console.error('批量排课失败:', e);
    }
  } finally {
    batchArranging.value = false;
  }
}

async function handleReset() {
  try {
    const res = await resetAutoAssignments({
      courseId: selectedCourseId.value,
      semester: currentSemesterLabel.value,
    });
    ElMessage.success(res.message || '已重置');
    await loadData();
  } catch (e) {
    ElMessage.error('重置失败');
  }
}

async function handleExportArrange() {
  if (!selectedCourseId.value || !currentSemesterLabel.value) return;
  exporting.value = true;
  try {
    const response = await request.get('/export/teaching-arrange', {
      params: { course_id: selectedCourseId.value, semester: currentSemesterLabel.value },
      responseType: 'blob',
    });
    downloadBlob(
      response,
      `教学安排_${courseInfo.value?.name || ''}_${currentSemesterLabel.value}.xlsx`
    );
    ElMessage.success('导出成功');
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('导出失败:', e);
    }
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
}

onMounted(() => {
  loadSemester();
  loadCourses();
});
</script>

<style scoped>
.settings-card {
  margin-bottom: 16px;
}
.hour-settings {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}
.hour-settings-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
}
.hour-setting-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: #f5f7fa;
  border-radius: 4px;
}
.type-label {
  font-weight: bold;
  font-size: 13px;
  color: #303133;
}
.setting-field {
  display: flex;
  align-items: center;
  gap: 4px;
}
.field-label {
  font-size: 12px;
  color: #606266;
}

.preview-card {
  margin-bottom: 16px;
}
.preview-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.course-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.preview-stats {
  display: flex;
  flex-wrap: wrap;
}
.preview-stat-item {
  flex: 1 1 0;
  min-width: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}
.stat-label {
  font-size: 12px;
  color: #909399;
}
.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}
.stat-value small {
  font-size: 12px;
  font-weight: normal;
  color: #909399;
  margin-left: 2px;
}
.text-success {
  color: #67c23a;
}
.text-danger {
  color: #f56c6c;
}
.matrix-card {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.card-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.teacher-cell {
  cursor: pointer;
  min-height: 32px;
  display: flex;
  align-items: center;
}
.text-placeholder {
  color: #c0c4cc;
  font-size: 12px;
}
.text-warning {
  color: #e6a23c;
  font-weight: bold;
}
.tag-item {
  margin: 2px;
}
:deep(.unassigned-row) {
  background-color: #fff5f5 !important;
}
.adaptive-table :deep(.el-table__header th .cell) {
  white-space: nowrap;
}
.adaptive-table :deep(.el-table__body td .cell) {
  white-space: nowrap;
}
</style>

<style>
.teacher-dialog .el-dialog__body {
  overflow-x: hidden;
}

/* 批量排课结果弹窗 */
.batch-result-dialog .el-dialog__body {
  padding: 16px 20px;
}
.batch-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.batch-stat-card {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 12px 8px;
  text-align: center;
  border: 1px solid transparent;
  transition: border-color 0.2s;
}
.batch-stat-card.is-warning {
  background: #fdf6ec;
  border-color: #faecd8;
}
.batch-stat-card.is-danger {
  background: #fef0f0;
  border-color: #fde2e2;
}
.batch-stat-num {
  font-size: 24px;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
}
.batch-stat-num.text-success {
  color: #67c23a;
}
.batch-stat-num.text-warning {
  color: #e6a23c;
}
.batch-stat-num.text-danger {
  color: #f56c6c;
}
.batch-stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.batch-filter-tabs {
  margin-bottom: 12px;
  display: flex;
  justify-content: flex-end;
}
.batch-course-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}
.batch-course-item {
  border-bottom: 1px solid #ebeef5;
}
.batch-course-item:last-child {
  border-bottom: none;
}
.batch-course-item.has-error {
  background: #fff5f5;
}
.batch-course-item.has-unassigned {
  background: #fffbf0;
}
.course-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.course-item-header:hover {
  background: rgba(0, 0, 0, 0.03);
}
.course-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.expand-icon {
  transition: transform 0.2s;
  color: #909399;
  flex-shrink: 0;
}
.expand-icon.expanded {
  transform: rotate(90deg);
}
.course-item-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.course-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.course-item-stat {
  font-size: 12px;
  color: #909399;
}
.course-item-detail {
  padding: 8px 14px 12px 34px;
  border-top: 1px dashed #ebeef5;
  font-size: 13px;
}
.detail-error {
  color: #f56c6c;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.detail-warnings {
  margin-bottom: 8px;
}
.detail-warning-item {
  color: #e6a23c;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.detail-unassigned {
  margin-top: 4px;
}
.detail-section-title {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
  font-weight: 600;
}
.detail-unassigned-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid #f5f7fa;
}
.detail-unassigned-item:last-child {
  border-bottom: none;
}
.unassigned-class-name {
  font-weight: 500;
  color: #303133;
}
.unassigned-hours {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}
.unassigned-reason {
  font-size: 12px;
  color: #e6a23c;
  margin-left: auto;
}
.detail-ok {
  color: #67c23a;
  font-size: 13px;
}

/* 单课程排课结果弹窗 */
.arrange-result-dialog .el-dialog__body {
  padding: 16px 20px;
}
.arrange-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.arrange-stat-card {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 10px 6px;
  text-align: center;
  border: 1px solid transparent;
}
.arrange-stat-card.is-warning {
  background: #fdf6ec;
  border-color: #faecd8;
}
.arrange-stat-num {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
}
.arrange-stat-num.text-success {
  color: #67c23a;
}
.arrange-stat-num.text-warning {
  color: #e6a23c;
}
.arrange-stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
/* 教材内聚度指标区块 */
.arrange-cohesion {
  margin: 12px 0;
  padding: 12px 14px;
  background: #f5f7fa;
  border-radius: 8px;
  border-left: 3px solid #409eff;
}
.cohesion-title {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 8px;
}
.cohesion-metrics {
  display: flex;
  gap: 24px;
  margin-bottom: 6px;
}
.cohesion-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.cohesion-num {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  line-height: 1.2;
}
.cohesion-num.text-success {
  color: #67c23a;
}
.cohesion-num.text-warning {
  color: #e6a23c;
}
.cohesion-num.text-danger {
  color: #f56c6c;
}
.cohesion-label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.cohesion-hint {
  font-size: 11px;
  color: #c0c4cc;
  margin-top: 4px;
}
.arrange-warnings {
  margin-bottom: 12px;
}
.arrange-warning-item {
  color: #e6a23c;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #fdf6ec;
  border-radius: 4px;
  margin-bottom: 6px;
  font-size: 13px;
}
.arrange-unassigned {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px 14px;
}
.arrange-unassigned .arrange-section-title {
  font-size: 12px;
  color: #909399;
  font-weight: 600;
  margin-bottom: 8px;
}
.arrange-unassigned-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px solid #f5f7fa;
}
.arrange-unassigned-item:last-child {
  border-bottom: none;
}
.arrange-all-done {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: #67c23a;
  font-size: 14px;
  font-weight: 500;
}
</style>
