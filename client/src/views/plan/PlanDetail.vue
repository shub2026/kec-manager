<template>
  <div>
    <el-page-header class="plan-detail-header" @back="$router.push('/plans')">
      <template #breadcrumb>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
          <el-breadcrumb-item :to="{ path: '/plans' }">培养方案</el-breadcrumb-item>
          <el-breadcrumb-item>{{ plan?.name || '方案明细' }}</el-breadcrumb-item>
        </el-breadcrumb>
      </template>
      <template #content>
        <span>{{ plan?.name || '方案明细' }}</span>
        <el-tag v-if="plan?.major" class="plan-tag">{{ plan.major.name }}</el-tag>
        <el-tag v-if="plan?.trainingLevel" type="warning" class="plan-tag">{{
          plan.trainingLevel.name
        }}</el-tag>
      </template>
    </el-page-header>

    <!-- 矩阵视图 -->
    <CourseMatrix
      ref="courseMatrixRef"
      :plan-id="planId"
      :all-courses="allCourses"
      :all-textbooks="allTextbooks"
      @add-course="showSemesterDialog = true"
      @delete-course="handleDeleteCourse"
    />

    <!-- 开课学期设置对话框 -->
    <el-dialog v-model="showSemesterDialog" title="设置开课学期" width="min(450px, 90vw)">
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
        <el-row :gutter="16">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="起始学期" required>
              <el-input-number
                v-model="semesterForm.startSemester"
                :min="1"
                :max="12"
                class="full-width"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="结束学期" required>
              <el-input-number
                v-model="semesterForm.endSemester"
                :min="1"
                :max="12"
                class="full-width"
              />
            </el-form-item>
          </el-col>
        </el-row>
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
      width="min(450px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-danger)" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <div style="flex: 1; line-height: 1.6; color: var(--text-regular)">
          <p style="margin: 0">{{ deleteCourseConfirmMessage }}</p>
          <p style="margin: 8px 0 0; color: var(--text-secondary); font-size: 13px">
            此操作不可撤销。
          </p>
        </div>
      </div>
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
import { getPlanById, addPlanCourse, deletePlanCourse } from '../../api/plan';
import { getCourses } from '../../api/course';
import { getTextbooks } from '../../api/textbook';
import CourseMatrix from '../../components/CourseMatrix.vue';

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
      weeksPerSemester: semesterForm.value.weeksPerSemester || 18,
    };
    await addPlanCourse(planId.value, courseData);
    ElMessage.success('添加成功');
    showSemesterDialog.value = false;
    semesterForm.value = {
      courseId: null,
      startSemester: 1,
      endSemester: 2,
      weeklyHours: 4,
      weeksPerSemester: 18,
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
  const [coursesRes, textbooksRes] = await Promise.all([getCourses(), getTextbooks()]);
  allCourses.value = coursesRes.data || [];
  // 只显示启用的教材
  allTextbooks.value = (textbooksRes.data || []).filter((t) => t.isActive);
  await loadPlan();
});
</script>

<style scoped>
.plan-detail-header {
  margin-bottom: 16px;
}

.plan-tag {
  margin-left: 12px;
}

.full-width {
  width: 100%;
}
</style>
