<template>
  <div class="teacher-list">
    <PageHeader
      title="教师信息"
      subtitle="教学安排"
      description="管理参与排课的教师信息，包括归属学院、授课课程和排课偏好"
    >
      <template #extra>
        <el-button type="primary" @click="openDialog()">
          <el-icon><Plus /></el-icon> 新增教师
        </el-button>
      </template>
    </PageHeader>
    <el-card>
      <!-- 筛选器组件：意向学院/层次联动逻辑内聚在 TeacherFilterBar -->
      <TeacherFilterBar
        v-model:filters="filters"
        :all-courses="allCourses"
        :all-colleges="allColleges"
        :all-training-levels="allTrainingLevels"
        :college-level-mapping="collegeLevelMapping"
        :upload-headers="uploadHeaders"
        :before-upload="beforeImport"
        @export="exportData"
        @download-template="downloadTemplate"
        @import-success="onImportSuccess"
        @import-error="onImportError"
      />

      <ListErrorState v-if="error" :message="error" @retry="load" />
      <el-table v-else v-loading="loading" :data="list" stripe row-key="id">
        <template #empty>
          <EmptyState type="teacher" description="暂无教师数据" />
        </template>
        <el-table-column label="序号" min-width="60" align="center">
          <template #default="{ $index }">{{ (currentPage - 1) * pageSize + $index + 1 }}</template>
        </el-table-column>
        <el-table-column prop="name" label="姓名" min-width="100">
          <template #default="{ row }">
            <span
              :style="
                row.status === 'disabled'
                  ? 'color: var(--text-secondary); text-decoration: line-through'
                  : ''
              "
              >{{ row.name }}</span
            >
          </template>
        </el-table-column>
        <el-table-column label="性别" min-width="70" align="center">
          <template #default="{ row }">{{
            row.gender === 'male' ? '男' : row.gender === 'female' ? '女' : '-'
          }}</template>
        </el-table-column>
        <el-table-column label="出生年月" min-width="100" align="center">
          <template #default="{ row }">{{ formatBirthDate(row.birthDate) }}</template>
        </el-table-column>
        <el-table-column label="年龄" min-width="70" align="center">
          <template #default="{ row }">{{ calcAge(row.birthDate) }}</template>
        </el-table-column>
        <el-table-column prop="qualificationType" label="教师资格类型" min-width="120">
          <template #default="{ row }">{{ row.qualificationType || '-' }}</template>
        </el-table-column>
        <el-table-column label="归属学院" min-width="120">
          <template #default="{ row }">
            <span>{{ row.affiliatedCollege?.name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="人员类别" min-width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="personnelTagType(row.personnelType)" size="small" disable-transitions>
              {{ personnelLabel(row.personnelType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="学科" min-width="160">
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
        <el-table-column label="意向学院" min-width="140">
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
        <el-table-column label="意向层次" min-width="120">
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
        <el-table-column label="自定义课时" min-width="100" align="center">
          <template #default="{ row }">
            <span>{{ row.defaultWeeklyHours != null ? row.defaultWeeklyHours : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="80" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.status !== 'disabled'"
              inline-prompt
              active-text="启"
              inactive-text="禁"
              size="small"
              @change="(val) => handleToggleStatus(row, val)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              :icon="Edit"
              circle
              title="编辑"
              aria-label="编辑"
              @click="openDialog(row)"
            />
            <el-button
              size="small"
              type="danger"
              :icon="Delete"
              circle
              title="删除"
              aria-label="删除"
              @click="handleDelete(row.id)"
            />
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="load"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <!-- 新增/编辑弹窗组件 -->
    <TeacherFormDialog
      ref="formDialogRef"
      :all-courses="allCourses"
      :all-colleges="allColleges"
      :all-training-levels="allTrainingLevels"
      :college-level-mapping="collegeLevelMapping"
      :saving="saving"
      @save="handleSave"
    />

    <!-- 删除确认弹窗 -->
    <DeleteConfirmDialog
      v-model="deleteConfirmVisible"
      :loading="deleting"
      @confirm="confirmDelete"
    >
      确定要删除此教师吗？此操作不可撤销。
    </DeleteConfirmDialog>

    <!-- 导入确认弹窗：复用全局 BaseConfirmDialog，避免手写 el-dialog + footer -->
    <BaseConfirmDialog
      v-model="importConfirmVisible"
      title="导入确认"
      :message="confirmMessage"
      confirm-text="确定导入"
      :loading="importing"
      @confirm="confirmImport"
      @cancel="cancelImport"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated, watch } from 'vue';
import { Edit, Delete } from '@element-plus/icons-vue';
import { ElMessage, ElNotification } from 'element-plus';
import {
  getTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  toggleTeacherStatus,
} from '../../api/teacher';
import { getColleges, getCollegeLevelMapping } from '../../api/college';
import { getTrainingLevels } from '../../api/trainingLevel';
import { getCourses } from '../../api/course';
import { useExport } from '../../composables/useExport';
import { useImport } from '../../composables/useImport';
import { useDebounceFn } from '../../composables/useDebounce';
import { personnelLabel, personnelTagType } from '../../utils/personnel';
import { formatBirthDate, calcAge } from '../../utils/date';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmDialog from '../../components/BaseConfirmDialog.vue';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import TeacherFilterBar from './components/TeacherFilterBar.vue';
import TeacherFormDialog from './components/TeacherFormDialog.vue';

defineOptions({ name: 'TeacherList' });

const list = ref([]);
const loading = ref(false);
// P0 修复：列表加载错误状态，供 ListErrorState 占位
const error = ref(null);
const saving = ref(false);
const allCourses = ref([]);
const allColleges = ref([]);
const allTrainingLevels = ref([]);
const collegeLevelMapping = ref({ collegeToLevels: {}, levelToColleges: {} });

// 表单弹窗组件引用
const formDialogRef = ref(null);

// 使用导入 composable
const {
  uploadHeaders,
  beforeImport,
  onImportSuccess,
  onImportError,
  importConfirmVisible,
  confirmMessage,
  importing,
  confirmImport,
  cancelImport,
} = useImport(
  '/import/teachers',
  '导入将以教师姓名进行匹配，已存在的教师将被覆盖更新，确定继续导入吗？',
  load
);

const { exportData, downloadTemplate } = useExport('teachers', '教师数据');

// 筛选器状态（对象形式，与 TeacherFilterBar v-model:filters 通信）
const filters = ref({
  name: '',
  courseId: '',
  personnelType: '',
  collegeId: '',
  trainingLevelId: '',
  affiliatedCollegeId: '',
  status: '',
});

// 列表总数（来自服务端分页）
const total = ref(0);

// 前端分页：数据已由服务端按筛选条件过滤并分页返回，这里仅做页码切片渲染
const currentPage = ref(1);
const pageSize = ref(20);
// 筛选条件变化后回到第一页并重新拉取（防抖，避免逐字符触发请求）
const reload = useDebounceFn(() => {
  currentPage.value = 1;
  load();
}, 300);
watch(filters, () => reload(), { deep: true });

// 每页大小变化：回到第一页重新拉取
function handleSizeChange() {
  currentPage.value = 1;
  load();
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    // 审计修复：查询参数统一 camelCase，由请求中间件自动转 snake_case
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
      name: filters.value.name || undefined,
      courseId: filters.value.courseId || undefined,
      personnelType: filters.value.personnelType || undefined,
      collegeId: filters.value.collegeId || undefined,
      trainingLevelId: filters.value.trainingLevelId || undefined,
      affiliatedCollegeId: filters.value.affiliatedCollegeId || undefined,
      status: filters.value.status || undefined,
    };
    const res = await getTeachers(params);
    list.value = res.data?.items || [];
    total.value = res.data?.total || 0;
  } catch (e) {
    error.value = e?.response?.data?.message || '教师数据加载失败，请稍后重试';
    if (import.meta.env.DEV) console.error('加载失败:', e);
  } finally {
    loading.value = false;
  }
}

async function loadOptions() {
  try {
    const [coursesRes, collegesRes, levelsRes, mappingRes] = await Promise.all([
      getCourses(),
      getColleges(),
      getTrainingLevels(),
      getCollegeLevelMapping(),
    ]);
    allCourses.value = coursesRes.data || [];
    allColleges.value = collegesRes.data || [];
    allTrainingLevels.value = levelsRes.data || [];
    collegeLevelMapping.value = mappingRes.data || { collegeToLevels: {}, levelToColleges: {} };
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('加载选项失败:', e);
    }
  }
}

function openDialog(row) {
  formDialogRef.value?.open(row);
}

async function handleSave({ id, data }) {
  saving.value = true;
  try {
    if (id) {
      await updateTeacher(id, data);
    } else {
      await createTeacher(data);
    }
    ElMessage.success('保存成功');
    formDialogRef.value?.close();
    await load();
  } finally {
    saving.value = false;
  }
}

const deleteConfirmVisible = ref(false);
const deleting = ref(false);
let pendingDeleteId = null;

function handleDelete(id) {
  pendingDeleteId = id;
  deleteConfirmVisible.value = true;
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  deleting.value = true;
  const target = list.value.find((t) => t.id === pendingDeleteId);
  const targetName = target?.name || '该教师';
  try {
    // silent:true 抑制拦截器 ElMessage，由本函数统一用 ElNotification 展示原因与结果
    await deleteTeacher(pendingDeleteId, { silent: true });
    ElNotification({
      title: '删除成功',
      message: `已删除教师：${targetName}`,
      type: 'success',
      duration: 4000,
    });
    await load();
    deleteConfirmVisible.value = false;
  } catch (e) {
    const reason = e?.response?.data?.message || e?.message || '未知错误';
    ElNotification({
      title: '删除失败',
      message: `${targetName}：${reason}`,
      type: 'error',
      duration: 6000,
    });
    deleteConfirmVisible.value = false;
  } finally {
    pendingDeleteId = null;
    deleting.value = false;
  }
}

async function handleToggleStatus(row, val) {
  const newStatus = val ? 'active' : 'disabled';
  try {
    await toggleTeacherStatus(row.id, newStatus);
    ElMessage.success(val ? '已启用' : '已禁用');
    await load();
  } catch (e) {
    if (import.meta.env.DEV) console.error('状态切换失败:', e);
  }
}

onMounted(() => {
  load();
  loadOptions();
});

// keep-alive 缓存页被激活时重新加载选项数据
// 避免在基础数据页新增课程/学院/层次后，本页下拉选项仍为旧数据
onActivated(() => {
  loadOptions();
});
</script>

<style scoped>
.tag-item {
  margin: 2px;
}
</style>
