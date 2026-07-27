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
      <div class="page-toolbar">
        <el-input v-model="filterName" placeholder="搜索姓名" clearable class="filter-2xl" />
        <el-select v-model="filterPersonnelType" placeholder="人员类别" clearable class="filter-sm">
          <el-option label="专职" value="full_time" />
          <el-option label="兼职" value="part_time" />
          <el-option label="外聘" value="external" />
        </el-select>
        <el-select
          v-model="filterCourseId"
          placeholder="学科"
          clearable
          filterable
          class="filter-xl"
        >
          <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select
          v-model="filterCollegeId"
          placeholder="意向学院"
          clearable
          filterable
          class="filter-xl"
          @change="handleCollegeFilterChange"
        >
          <el-option v-for="c in filteredColleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select
          v-model="filterTrainingLevelId"
          placeholder="意向层次"
          clearable
          filterable
          class="filter-md"
          @change="handleTrainingLevelFilterChange"
        >
          <el-option
            v-for="l in filteredTrainingLevels"
            :key="l.id"
            :label="l.name"
            :value="l.id"
          />
        </el-select>
        <el-select
          v-model="filterAffiliatedCollegeId"
          placeholder="归属学院"
          clearable
          filterable
          class="filter-xl"
        >
          <el-option v-for="c in allColleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="状态" clearable class="filter-sm">
          <el-option label="启用" value="active" />
          <el-option label="禁用" value="disabled" />
        </el-select>
        <div class="action-buttons">
          <el-button @click="exportData">数据导出</el-button>
          <el-button @click="downloadTemplate">下载模板</el-button>
          <el-upload
            :show-file-list="false"
            accept=".xlsx,.xls"
            action="/api/import/teachers"
            name="file"
            :headers="uploadHeaders"
            :on-success="onImportSuccess"
            :on-error="onImportError"
            :before-upload="beforeImport"
          >
            <el-button>导入Excel</el-button>
          </el-upload>
        </div>
      </div>

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
              type="warning"
              class="tag-item"
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
            <el-button size="small" :icon="Edit" circle @click="openDialog(row)" />
            <el-button
              size="small"
              type="danger"
              :icon="Delete"
              circle
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

    <!-- 新增/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑教师' : '新增教师'"
      width="var(--dialog-width-lg)"
      :fullscreen="isMobile"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="教师姓名" prop="name" required>
          <el-input v-model="form.name" placeholder="请输入教师姓名" maxlength="50" />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="性别">
              <el-select v-model="form.gender" placeholder="请选择" clearable style="width: 100%">
                <el-option label="男" value="male" />
                <el-option label="女" value="female" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="出生年月">
              <el-date-picker
                v-model="form.birthDate"
                type="month"
                placeholder="选择年月"
                value-format="YYYY-MM"
                :clearable="true"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="归属学院">
              <el-select
                v-model="form.affiliatedCollegeId"
                placeholder="选择归属学院"
                clearable
                filterable
                style="width: 100%"
              >
                <el-option v-for="c in allColleges" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8" :xs="24" :sm="12">
            <el-form-item label="人员类别">
              <el-select v-model="form.personnelType" placeholder="请选择" style="width: 100%">
                <el-option label="专职" value="full_time" />
                <el-option label="兼职" value="part_time" />
                <el-option label="外聘" value="external" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8" :xs="24" :sm="12">
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width: 100%">
                <el-option label="启用" value="active" />
                <el-option label="禁用" value="disabled" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="教师资格类型">
          <el-input v-model="form.qualificationType" placeholder="如：高中语文" clearable />
        </el-form-item>
        <el-form-item label="学科（课程）">
          <el-select
            v-model="form.courseIds"
            multiple
            filterable
            placeholder="选择可教授的课程"
            style="width: 100%"
          >
            <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="意向学院">
          <el-select
            v-model="form.collegeIds"
            multiple
            filterable
            placeholder="选择优先指定学院"
            style="width: 100%"
          >
            <el-option v-for="c in availableColleges" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="意向层次">
          <el-select
            v-model="form.trainingLevelIds"
            multiple
            filterable
            placeholder="选择优先指定层次"
            style="width: 100%"
          >
            <el-option
              v-for="l in availableTrainingLevels"
              :key="l.id"
              :label="l.name"
              :value="l.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="自定义课时">
          <el-input-number
            v-model="form.defaultWeeklyHours"
            :min="0"
            :max="40"
            :step="1"
            placeholder="不填使用课时要求"
            controls-position="right"
            class="filter-xl"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 删除确认弹窗 -->
    <el-dialog
      v-model="deleteConfirmVisible"
      title="确认删除"
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody icon-color="var(--brand-danger)"
        >确定要删除此教师吗？此操作不可撤销。</BaseConfirmBody
      >
      <template #footer>
        <el-button @click="deleteConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="confirmDelete">确定删除</el-button>
      </template>
    </el-dialog>

    <!-- 导入确认弹窗 -->
    <el-dialog
      v-model="importConfirmVisible"
      title="导入确认"
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody>{{ confirmMessage }}</BaseConfirmBody>
      <template #footer>
        <el-button @click="cancelImport">取消</el-button>
        <el-button type="warning" :loading="importing" @click="confirmImport">确定导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, onActivated, watch } from 'vue';
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
import { useFilterLinkage } from '@/components/filter/composables/useFilterLinkage';
import { useResponsive } from '../../composables/useResponsive';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';
import ListErrorState from '../../components/ListErrorState.vue';

defineOptions({ name: 'TeacherList' });

const list = ref([]);
const loading = ref(false);
// P0 修复：列表加载错误状态，供 ListErrorState 占位
const error = ref(null);
const dialogVisible = ref(false);
const saving = ref(false);
const allCourses = ref([]);
const allColleges = ref([]);
const allTrainingLevels = ref([]);
const collegeLevelMapping = ref({ collegeToLevels: {}, levelToColleges: {} });

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

// 筛选器状态
const filterName = ref('');
const filterCourseId = ref('');
const filterPersonnelType = ref('');
const filterCollegeId = ref('');
const filterTrainingLevelId = ref('');
const filterAffiliatedCollegeId = ref('');
const filterStatus = ref('');

// 使用通用联动Hook(意向学院 ↔ 意向层次)
const filters = computed(() => ({
  collegeId: filterCollegeId.value,
  trainingLevelId: filterTrainingLevelId.value,
}));

// 转换collegeLevelMapping为Hook需要的格式
const collegeLevelRelation = computed(() => {
  const relation = {};
  for (const [collegeId, levelIds] of Object.entries(collegeLevelMapping.value.collegeToLevels)) {
    relation[collegeId] = levelIds;
  }
  return relation;
});

const levelCollegeRelation = computed(() => {
  const relation = {};
  for (const [levelId, collegeIds] of Object.entries(collegeLevelMapping.value.levelToColleges)) {
    relation[levelId] = collegeIds;
  }
  return relation;
});

const { getFilteredOptions, handleParentChange } = useFilterLinkage({
  filters,
  relations: {
    // key名必须匹配Hook动态拼接规则: {parentField}{FieldName}Relation
    trainingLevelIdCollegeIdRelation: levelCollegeRelation, // 按层次过滤学院
    collegeIdTrainingLevelIdRelation: collegeLevelRelation, // 按学院过滤层次
  },
});

// 意向学院根据意向层次过滤
const filteredColleges = computed(() =>
  getFilteredOptions.value('collegeId', allColleges.value, ['trainingLevelId'])
);

// 意向层次根据意向学院过滤
const filteredTrainingLevels = computed(() =>
  getFilteredOptions.value('trainingLevelId', allTrainingLevels.value, ['collegeId'])
);

// 处理意向学院变化
function handleCollegeFilterChange() {
  handleParentChange('collegeId', ['trainingLevelId'], () => {});
}

// 处理意向层次变化
function handleTrainingLevelFilterChange() {
  handleParentChange('trainingLevelId', ['collegeId'], () => {});
}

const formRef = ref(null);
const rules = {
  name: [
    { required: true, message: '请输入教师姓名', trigger: 'blur' },
    { min: 2, max: 50, message: '姓名长度应在 2-50 个字符之间', trigger: 'blur' },
  ],
};

// 小屏弹窗全屏：复用共享响应式断点
const { isMobile } = useResponsive();

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
watch(
  [
    filterName,
    filterCourseId,
    filterPersonnelType,
    filterCollegeId,
    filterTrainingLevelId,
    filterAffiliatedCollegeId,
    filterStatus,
  ],
  () => reload()
);

// 每页大小变化：回到第一页重新拉取
function handleSizeChange() {
  currentPage.value = 1;
  load();
}

const defaultForm = {
  id: null,
  name: '',
  gender: null,
  birthDate: null,
  personnelType: 'full_time',
  qualificationType: null,
  affiliatedCollegeId: null,
  defaultWeeklyHours: null,
  status: 'active',
  courseIds: [],
  collegeIds: [],
  trainingLevelIds: [],
};
const form = ref({ ...defaultForm });

// 意向学院/意向层次双向联动筛选
const availableColleges = computed(() => {
  const selectedLevelIds = form.value.trainingLevelIds || [];
  if (!selectedLevelIds.length) return allColleges.value;
  const mapping = collegeLevelMapping.value.levelToColleges;
  const allowedIds = new Set();
  for (const lid of selectedLevelIds) {
    const cids = mapping[lid] || [];
    cids.forEach((id) => allowedIds.add(id));
  }
  return allColleges.value.filter((c) => allowedIds.has(c.id));
});

const availableTrainingLevels = computed(() => {
  const selectedCollegeIds = form.value.collegeIds || [];
  if (!selectedCollegeIds.length) return allTrainingLevels.value;
  const mapping = collegeLevelMapping.value.collegeToLevels;
  const allowedIds = new Set();
  for (const cid of selectedCollegeIds) {
    const lids = mapping[cid] || [];
    lids.forEach((id) => allowedIds.add(id));
  }
  return allTrainingLevels.value.filter((l) => allowedIds.has(l.id));
});

function formatBirthDate(birthDate) {
  if (!birthDate) return '-';
  // 只显示到月份: "YYYY-MM" 或截取前7位
  const str = String(birthDate);
  if (str.length >= 7) return str.substring(0, 7);
  return str;
}

function calcAge(birthDate) {
  if (!birthDate) return '-';
  const str = String(birthDate);
  // 支持 "YYYY-MM" 或 "YYYY-MM-DD"
  const parts = str.split('-');
  if (parts.length < 2) return '-';
  const birthYear = parseInt(parts[0], 10);
  const birthMonth = parseInt(parts[1], 10) - 1; // 0-indexed
  if (isNaN(birthYear) || isNaN(birthMonth)) return '-';
  const now = new Date();
  let age = now.getFullYear() - birthYear;
  const m = now.getMonth() - birthMonth;
  if (m < 0) age--;
  return age > 0 ? age : '-';
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const params = {
      page: currentPage.value,
      page_size: pageSize.value,
      name: filterName.value || undefined,
      course_id: filterCourseId.value || undefined,
      personnel_type: filterPersonnelType.value || undefined,
      college_id: filterCollegeId.value || undefined,
      training_level_id: filterTrainingLevelId.value || undefined,
      affiliated_college_id: filterAffiliatedCollegeId.value || undefined,
      status: filterStatus.value || undefined,
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
  if (row) {
    form.value = {
      ...row,
      birthDate: row.birthDate ? String(row.birthDate).substring(0, 7) : null,
      affiliatedCollegeId: row.affiliatedCollege?.id || null,
      courseIds: row.courseList?.map((c) => c.id) || [],
      collegeIds: row.collegeList?.map((c) => c.id) || [],
      trainingLevelIds: row.trainingLevelList?.map((l) => l.id) || [],
    };
  } else {
    form.value = { ...defaultForm };
  }
  dialogVisible.value = true;
}

async function handleSave() {
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  saving.value = true;
  try {
    const data = {
      name: form.value.name,
      gender: form.value.gender,
      birthDate: form.value.birthDate,
      personnelType: form.value.personnelType,
      qualificationType: form.value.qualificationType,
      affiliatedCollegeId: form.value.affiliatedCollegeId,
      defaultWeeklyHours: form.value.defaultWeeklyHours,
      status: form.value.status || 'active',
      courseIds: form.value.courseIds,
      collegeIds: form.value.collegeIds,
      trainingLevelIds: form.value.trainingLevelIds,
    };
    if (form.value.id) {
      await updateTeacher(form.value.id, data);
    } else {
      await createTeacher(data);
    }
    ElMessage.success('保存成功');
    dialogVisible.value = false;
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
