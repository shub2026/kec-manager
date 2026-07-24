<template>
  <div class="plan-detail">
    <PageHeader :title="plan?.name || '方案明细'" subtitle="培养方案" back-route="/plans">
      <template #tags>
        <el-tag v-if="plan?.majors?.name" size="small">{{ plan.majors.name }}</el-tag>
        <el-tag v-if="plan?.trainingLevels?.name" type="warning" size="small">{{
          plan.trainingLevels.name
        }}</el-tag>
      </template>
    </PageHeader>

    <!-- 方案概览条 -->
    <section class="plan-overview" aria-label="方案概览">
      <div class="ov-item">
        <span class="ov-label">学院</span>
        <span class="ov-value">{{ plan?.colleges?.name || '—' }}</span>
      </div>
      <div class="ov-divider"></div>
      <div class="ov-item">
        <span class="ov-label">公共/专业</span>
        <span class="ov-value">{{ publicCount }} / {{ professionalCount }}</span>
      </div>
      <div class="ov-item">
        <span class="ov-label">课程数</span>
        <span class="ov-value">{{ courseCount }}</span>
      </div>
      <div class="ov-item">
        <span class="ov-label">总课时</span>
        <span class="ov-value ov-accent">{{ totalHours }}</span>
      </div>
      <div class="ov-item">
        <span class="ov-label">学期周数</span>
        <span class="ov-value">{{ currentGlobalWeeks }}<small> 周</small></span>
      </div>
      <el-button type="primary" class="ov-add-btn" @click="openSemesterDialog">
        <el-icon><Plus /></el-icon> 添加课程
      </el-button>
    </section>

    <!-- 矩阵视图 -->
    <CourseMatrix
      ref="courseMatrixRef"
      :plan-id="planId"
      :all-courses="allCourses"
      :all-textbooks="allTextbooks"
      @delete-course="handleDeleteCourse"
    />

    <!-- 颜色语义图例（置于矩阵表下方） -->
    <MatrixLegend class="plan-legend" />

    <!-- 开课学期设置对话框 -->
    <el-dialog v-model="showSemesterDialog" title="设置开课学期" width="var(--dialog-width)">
      <el-form :model="semesterForm" label-width="100px">
        <el-form-item label="选择课程" required>
          <el-select
            v-model="semesterForm.courseId"
            filterable
            placeholder="请选择课程"
            class="full-width"
          >
            <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="起始学期" required>
          <el-input-number
            v-model="semesterForm.startSemester"
            :min="1"
            :max="12"
            class="full-width"
          />
        </el-form-item>
        <el-form-item label="结束学期" required>
          <el-input-number
            v-model="semesterForm.endSemester"
            :min="1"
            :max="12"
            class="full-width"
          />
        </el-form-item>
        <el-form-item label="默认周课时" required>
          <el-input-number
            v-model="semesterForm.weeklyHours"
            :min="1"
            :max="20"
            class="full-width"
          />
        </el-form-item>
        <el-alert title="提示：学期周数请在底部统一设置" type="info" :closable="false" show-icon />
      </el-form>
      <template #footer>
        <el-button @click="showSemesterDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveSemester">保存</el-button>
      </template>
    </el-dialog>

    <!-- 课程删除确认弹窗 -->
    <el-dialog
      v-model="deleteCourseConfirmVisible"
      title="确认删除"
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody icon-color="var(--brand-danger)">
        <p class="confirm-text">{{ deleteCourseConfirmMessage }}</p>
        <p class="confirm-hint">此操作不可撤销。</p>
      </BaseConfirmBody>
      <template #footer>
        <el-button @click="deleteCourseConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="courseDeleting" @click="confirmDeleteCourse"
          >确定删除</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { getPlanById, addPlanCourse, deletePlanCourse } from '../../api/plan';
import { getCourses } from '../../api/course';
import { getTextbooks } from '../../api/textbook';
import CourseMatrix from '../../components/CourseMatrix.vue';
import MatrixLegend from '../../components/MatrixLegend.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';

defineOptions({ name: 'PlanDetail' });

const route = useRoute();
// M-3 修复：使用 computed 使 planId 响应式，支持路由参数变化时自动更新
const planId = computed(() => Number(route.params.id));
const courseMatrixRef = ref(null);
const plan = ref(null);
const allCourses = ref([]);
const allTextbooks = ref([]);
const saving = ref(false);

// 课程删除确认弹窗
const deleteCourseConfirmVisible = ref(false);
const deleteCourseConfirmMessage = ref('');
const courseDeleting = ref(false);
const pendingDeleteCourse = ref(null);

const showSemesterDialog = ref(false);

// 从矩阵组件读取当前全局学期周数，未就绪时回退 18
const currentGlobalWeeks = computed(() => courseMatrixRef.value?.globalWeeks ?? 18);
// 概览条：课程数 / 总课时（矩阵数据就绪前回退 0）
const courseCount = computed(() => courseMatrixRef.value?.rawCourses?.length ?? 0);
const totalHours = computed(() => courseMatrixRef.value?.totalAllHours ?? 0);
// 公共课 / 专业课数量（按 courses.type 拆分）
const publicCount = computed(
  () =>
    courseMatrixRef.value?.rawCourses?.filter((c) => (c.courses?.type || 'public') === 'public')
      .length ?? 0
);
const professionalCount = computed(
  () =>
    courseMatrixRef.value?.rawCourses?.filter((c) => c.courses?.type === 'professional').length ?? 0
);

function openSemesterDialog() {
  semesterForm.value = {
    courseId: null,
    startSemester: 1,
    endSemester: 2,
    weeklyHours: 4,
    weeksPerSemester: currentGlobalWeeks.value,
  };
  showSemesterDialog.value = true;
}

const semesterForm = ref({
  courseId: null,
  startSemester: 1,
  endSemester: 2,
  weeklyHours: 4,
  weeksPerSemester: 18,
});

async function loadPlan() {
  // #20修复：直接获取单个培养方案，而非获取全部再查找
  const res = await getPlanById(planId.value);
  plan.value = res.data;
}

async function refreshMatrix() {
  if (courseMatrixRef.value) {
    await courseMatrixRef.value.refresh();
  }
}

async function saveSemester() {
  if (!semesterForm.value.courseId) return ElMessage.warning('请选择课程');
  if (semesterForm.value.startSemester > semesterForm.value.endSemester) {
    return ElMessage.warning('起始学期不能大于结束学期');
  }
  if (!semesterForm.value.weeklyHours) {
    return ElMessage.warning('请填写周课时');
  }

  saving.value = true;
  try {
    // 前端统一使用 camelCase，由 naming 中间件自动转换为 snake_case 给后端
    const courseData = {
      courseId: semesterForm.value.courseId,
      startSemester: semesterForm.value.startSemester,
      endSemester: semesterForm.value.endSemester,
      weeklyHours: semesterForm.value.weeklyHours,
      weeksPerSemester: currentGlobalWeeks.value,
    };
    await addPlanCourse(planId.value, courseData);
    ElMessage.success('添加成功');
    showSemesterDialog.value = false;
    semesterForm.value = {
      courseId: null,
      startSemester: 1,
      endSemester: 2,
      weeklyHours: 4,
      weeksPerSemester: currentGlobalWeeks.value,
    };
    // 标记 PlanList 需要刷新课程数
    sessionStorage.setItem('planListNeedsRefresh', 'true');
    // 刷新矩阵数据
    await refreshMatrix();
  } catch (e) {
    if (import.meta.env.DEV) console.error(e);
    ElMessage.error('添加失败');
  } finally {
    saving.value = false;
  }
}

async function handleDeleteCourse(course) {
  pendingDeleteCourse.value = course;
  deleteCourseConfirmMessage.value = `确定要删除课程“${course.courseName}”吗？`;
  deleteCourseConfirmVisible.value = true;
}

async function confirmDeleteCourse() {
  const course = pendingDeleteCourse.value;
  if (!course) return;

  deleteCourseConfirmVisible.value = false;
  courseDeleting.value = true;
  try {
    await deletePlanCourse(course.id);
    ElMessage.success('删除成功');
    // 标记 PlanList 需要刷新课程数
    sessionStorage.setItem('planListNeedsRefresh', 'true');
    await refreshMatrix();
  } catch (e) {
    if (import.meta.env.DEV) console.error(e);
    // request.js 拦截器已统一弹错误提示，此处不再重复
  } finally {
    courseDeleting.value = false;
    pendingDeleteCourse.value = null;
  }
}

onMounted(async () => {
  try {
    const [coursesRes, textbooksRes] = await Promise.all([getCourses(), getTextbooks()]);
    allCourses.value = coursesRes.data || [];
    // 只显示启用的教材
    allTextbooks.value = (textbooksRes.data?.items || []).filter((t) => t.isActive);
    await loadPlan();
  } catch (e) {
    if (import.meta.env.DEV) console.error('[PlanDetail] 初始化加载失败:', e);
    ElMessage.error('加载数据失败，请刷新页面重试');
  }
});
</script>

<style scoped>
.plan-detail {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 手机端:放弃固定高度+内部滚动模式,改为自然高度+整页滚动
   否则 PageHeader/概览条换行后占满高度,flex:1 的矩阵区被压缩到 0 而完全不可见 */
@media (max-width: 768px) {
  .plan-detail {
    height: auto;
    min-height: 100%;
  }
}

/* 方案概览条 */
.plan-overview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 20px;
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--el-box-shadow-light, 0 1px 2px rgba(0, 0, 0, 0.04));
}

.ov-item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.ov-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.ov-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.ov-value small {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 1px;
}

.ov-accent {
  color: var(--brand-primary);
}

.ov-divider {
  width: 1px;
  height: 18px;
  background: var(--border-light);
}

/* 添加课程按钮推到概览条右侧 */
.ov-add-btn {
  margin-left: auto;
  flex-shrink: 0;
}

/* 图例与矩阵间距 */
.plan-legend {
  margin-top: var(--space-3);
}

.full-width {
  width: 100%;
}

:deep(.el-input-number.full-width) {
  width: 100%;
}

/* 窄屏（≤768px）：概览条换行后隐藏分隔符，添加课程按钮全宽独占一行 */
@media (max-width: 768px) {
  .ov-divider {
    display: none;
  }

  .plan-overview {
    gap: var(--space-2) var(--space-4);
    padding: var(--space-3);
  }

  .ov-item {
    flex: 0 0 auto;
  }

  /* 按钮:不再 margin-left:auto 挤在行尾,而是独占整行,避免被 ov-item 压扁 */
  .ov-add-btn {
    width: 100%;
    margin-left: 0;
    flex: 1 1 100%;
    margin-top: var(--space-1);
  }
}

/* 小屏手机（≤480px）：概览条更紧凑，ov-item 允许两两并排 */
@media (max-width: 480px) {
  .ov-value {
    font-size: 14px;
  }

  .ov-label {
    font-size: 11px;
  }
}
.confirm-text {
  margin: 0;
}
.confirm-hint {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
