<template>
  <div class="plan-list">
    <PageHeader
      title="培养方案"
      subtitle="教学管理"
      description="管理各专业的培养方案，包含课程设置和学期安排"
    >
      <template #extra>
        <el-button type="primary" @click="openDialog()">
          <el-icon><Plus /></el-icon> 新增方案
        </el-button>
      </template>
    </PageHeader>
    <el-card>
      <div class="page-toolbar">
        <el-select
          v-model="filterCollegeId"
          placeholder="选择使用部门"
          clearable
          class="filter-xl"
          @change="handleFilterChange"
        >
          <el-option label="全部部门" value="" />
          <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </div>
      <el-table v-loading="loading" :data="pagedList" stripe row-key="id">
        <template #empty>
          <EmptyState type="plan" description="暂无培养方案" />
        </template>
        <el-table-column
          type="index"
          label="序号"
          width="55"
          :index="(i) => (currentPage - 1) * pageSize + i + 1"
        />
        <el-table-column prop="name" label="方案名称" min-width="200" />
        <el-table-column label="使用部门" min-width="120">
          <template #default="{ row }">{{ row.colleges?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="关联类型" min-width="90">
          <template #default="{ row }">
            <el-tag v-if="row.majorId" type="success" size="small">按专业</el-tag>
            <el-tag v-else-if="row.trainingLevelId" type="primary" size="small">按层次</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="专业" min-width="120">
          <template #default="{ row }">{{ row.majors?.name || '-' }}</template>
        </el-table-column>
        <el-table-column label="培养层次" min-width="100">
          <template #default="{ row }">{{ row.trainingLevels?.name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="version" label="版本" min-width="70" align="center" />
        <el-table-column label="课程数" min-width="75" align="center">
          <template #default="{ row }">{{ row.courseCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="使用班级" min-width="85" align="center">
          <template #default="{ row }">{{ row.classCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="排序" min-width="105" align="center">
          <template #default="{ row }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="realIndex(row) === 0"
                circle
                title="上移"
                @click="handleMoveUp(row, realIndex(row))"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="realIndex(row) === filteredList.length - 1"
                circle
                title="下移"
                @click="handleMoveDown(row, realIndex(row))"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              type="primary"
              title="编辑明细"
              @click="$router.push(`/plans/${row.id}`)"
            >
              <el-icon><Edit /></el-icon>编辑明细
            </el-button>
            <el-button size="small" title="编辑信息" @click="openDialog(row)">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-button size="small" type="danger" title="删除" @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="filteredList.length > pageSize"
        v-model:current-page="currentPage"
        class="pagination-container"
        layout="total, prev, pager, next, jumper"
        :total="filteredList.length"
        :page-size="pageSize"
        background
      />
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑方案' : '新增方案'"
      width="min(500px, 90vw)"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="方案名称" prop="name" required>
          <el-input v-model="form.name" placeholder="如：2024级学前教育培养方案" maxlength="200" />
        </el-form-item>

        <el-form-item label="使用部门">
          <el-select
            v-model="form.collegeId"
            placeholder="请选择使用部门（可选）"
            class="full-width"
            clearable
          >
            <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="关联方式" required>
          <el-radio-group
            v-model="relationMode"
            class="relation-mode-group"
            @change="handleModeChange"
          >
            <el-radio value="major">按专业</el-radio>
            <el-radio value="trainingLevel">按层次</el-radio>
          </el-radio-group>
          <div class="form-hint">
            <span v-if="relationMode === 'major'"
              >该方案关联特定专业，适用于同一专业的培养方案</span
            >
            <span v-else-if="relationMode === 'trainingLevel'"
              >该方案关联特定培养层次，适用于跨专业的统一方案</span
            >
          </div>
        </el-form-item>

        <el-form-item label="关联数据" required>
          <el-select
            v-if="relationMode === 'major'"
            v-model="form.majorId"
            placeholder="请选择专业类别"
            class="full-width"
          >
            <el-option v-for="m in majors" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
          <el-select
            v-else
            v-model="form.trainingLevelId"
            placeholder="请选择培养层次"
            class="full-width"
          >
            <el-option
              v-for="level in trainingLevels"
              :key="level.id"
              :label="level.name"
              :value="level.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="版本">
          <el-input v-model="form.version" placeholder="如：v1.0" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" />
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
      width="min(450px, 90vw)"
      align-center
    >
      <BaseConfirmBody icon-color="var(--brand-danger)" :warning="deleteWarning">
        确定要删除此培养方案吗？此操作不可撤销。
      </BaseConfirmBody>
      <template #footer>
        <el-button @click="cancelDelete">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="confirmDelete">确定删除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onActivated } from 'vue';
import { ArrowUp, ArrowDown, Document, Edit, Delete } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getPlans, createPlan, updatePlan, deletePlan } from '../../api/plan';
import { getMajors } from '../../api/major';
import { getTrainingLevels } from '../../api/trainingLevel';
import { getColleges } from '../../api/college';
import { useSortable } from '../../composables/useSortable';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';

defineOptions({ name: 'PlanList' });

const list = ref([]);
const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(20);
const majors = ref([]);
const trainingLevels = ref([]);
const colleges = ref([]);
const filterCollegeId = ref('');
const filteredList = computed(() => {
  if (!filterCollegeId.value || filterCollegeId.value === '') return list.value;
  return list.value.filter((item) => item.collegeId === Number(filterCollegeId.value));
});

// 前端切片分页：避免数据增长后一次性渲染全部 DOM 行
const pagedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredList.value.slice(start, start + pageSize.value);
});

// 计算行在 filteredList 中的真实索引（分页后视觉 $index 不再等于真实序）
const realIndex = (row) => filteredList.value.findIndex((i) => i.id === row.id);

// 筛选变化或数据缩减后重置/收敛页码，避免停留在空页
watch(filterCollegeId, () => {
  currentPage.value = 1;
});
watch(filteredList, (l) => {
  const maxPage = Math.max(1, Math.ceil(l.length / pageSize.value));
  if (currentPage.value > maxPage) currentPage.value = maxPage;
});
const dialogVisible = ref(false);
const saving = ref(false);
const relationMode = ref('major'); // 'major' 或 'trainingLevel'
const form = ref({
  id: null,
  name: '',
  collegeId: null,
  majorId: null,
  trainingLevelId: null,
  version: '',
  description: '',
});

// 表单引用与校验规则
const formRef = ref(null);
const rules = {
  name: [
    { required: true, message: '请输入方案名称', trigger: 'blur' },
    { min: 2, max: 200, message: '名称长度应在 2-200 个字符之间', trigger: 'blur' },
  ],
};

// 使用排序 composable（针对 filteredList）
const { handleMoveUp, handleMoveDown } = useSortable(filteredList, updatePlan, silentReload, {
  indexFinder: (item) => filteredList.value.findIndex((i) => i.id === item.id),
});

async function load() {
  loading.value = true;
  try {
    const res = await getPlans();
    list.value = res.data || [];
  } finally {
    loading.value = false;
  }
}

// 静默刷新：不显示 loading 遮罩，避免表格跳动
async function silentReload() {
  try {
    const res = await getPlans();
    list.value = res.data || [];
  } catch {
    // 静默刷新失败时回退到带 loading 的 load
    await load();
  }
}

async function loadMeta() {
  const [majorsRes, levelsRes, collegesRes] = await Promise.all([
    getMajors(),
    getTrainingLevels(),
    getColleges(),
  ]);
  majors.value = majorsRes.data || [];
  trainingLevels.value = levelsRes.data || [];
  colleges.value = collegesRes.data || [];
}

function handleFilterChange() {
  // filteredList 是 computed，自动响应 filterCollegeId 变化
}

function handleModeChange(mode) {
  if (mode === 'major') {
    // 按专业模式：清空层次
    form.value.trainingLevelId = null;
  } else {
    // 按层次模式：清空专业
    form.value.majorId = null;
  }
}

function openDialog(row) {
  if (row) {
    form.value = {
      ...row,
      collegeId: row.collegeId || null,
      trainingLevelId: row.trainingLevelId || null,
    };

    // 根据已有数据确定关联模式（优先判断层次）
    if (row.trainingLevelId) {
      relationMode.value = 'trainingLevel';
    } else {
      relationMode.value = 'major';
    }
  } else {
    form.value = {
      id: null,
      name: '',
      collegeId: null,
      majorId: null,
      trainingLevelId: null,
      version: '',
      description: '',
    };
    relationMode.value = 'major';
  }
  dialogVisible.value = true;
}

async function handleSave() {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  // 根据关联模式验证必填项
  if (relationMode.value === 'major' && !form.value.majorId) {
    return ElMessage.warning('请选择专业类别');
  }
  if (relationMode.value === 'trainingLevel' && !form.value.trainingLevelId) {
    return ElMessage.warning('请选择培养层次');
  }

  saving.value = true;
  try {
    const data = {
      name: form.value.name,
      collegeId: form.value.collegeId || null,
      majorId: form.value.majorId || null,
      trainingLevelId: form.value.trainingLevelId || null,
      version: form.value.version,
      description: form.value.description,
    };
    if (form.value.id) {
      await updatePlan(form.value.id, data);
    } else {
      await createPlan(data);
    }
    ElMessage.success('保存成功');
    dialogVisible.value = false;
    await silentReload();
  } finally {
    saving.value = false;
  }
}

const deleteConfirmVisible = ref(false);
const deleting = ref(false);
const pendingDeleteRow = ref(null);
const deleteWarning = computed(() => {
  // 后端 deletePlan 现在允许删除关联了班级的方案，但需区分两类影响：
  // - customLinkedClassCount：custom_plan_id 直接引用的班级，删除时会被解除关联（置 null），班级回归未关联状态
  // - matchedClassCount：通过专业/层次匹配的班级（含 custom），删除方案后自然不再匹配此方案
  //   （班级自身的 major_id/training_level_id 是班级属性，保持不变，不视为"关联"）
  const row = pendingDeleteRow.value;
  if (!row) return '';
  const customCount = row.customLinkedClassCount || 0;
  const matchedCount = row.matchedClassCount || 0;
  const parts = [];
  if (customCount > 0) {
    parts.push(`该方案当前自定义关联 ${customCount} 个班级，删除后将解除这些班级的关联`);
  }
  if (matchedCount > 0) {
    parts.push(
      `该方案当前匹配 ${matchedCount} 个班级（含专业/层次匹配），删除后这些班级将不再匹配此方案`
    );
  }
  return parts.join('；');
});
let pendingDeleteId = null;

function handleDelete(row) {
  pendingDeleteRow.value = row;
  pendingDeleteId = row?.id ?? null;
  deleteConfirmVisible.value = true;
}

function cancelDelete() {
  deleteConfirmVisible.value = false;
  pendingDeleteRow.value = null;
  pendingDeleteId = null;
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  deleting.value = true;
  try {
    await deletePlan(pendingDeleteId);
    ElMessage.success('删除成功');
    await silentReload();
    deleteConfirmVisible.value = false;
  } catch {
    deleteConfirmVisible.value = false;
    // request.js 拦截器已显示后端返回的错误消息，此处不再重复弹窗
  } finally {
    pendingDeleteId = null;
    pendingDeleteRow.value = null;
    deleting.value = false;
  }
}

// PlanDetail 修改课程后会设置 sessionStorage 标志，返回时据此刷新课程数
// keep-alive 生效时 onMounted 不触发，用 watch route 检查标志
// keep-alive 未生效时 onMounted 触发，load() 会加载最新数据并清除标志
function consumeRefreshFlag() {
  if (sessionStorage.getItem('planListNeedsRefresh') === 'true') {
    sessionStorage.removeItem('planListNeedsRefresh');
    return true;
  }
  return false;
}

onMounted(async () => {
  try {
    await loadMeta();
  } catch (e) {
    if (import.meta.env.DEV) console.error('加载元数据失败:', e);
  }
  // 清除标志（load() 会加载最新数据）
  sessionStorage.removeItem('planListNeedsRefresh');
  load();
});

onActivated(() => {
  // keep-alive 缓存页被激活时重新加载元数据
  // 避免在基础数据页新增专业/层次/学院后，本页下拉选项仍为旧数据
  loadMeta();
  if (consumeRefreshFlag()) {
    silentReload();
  }
});
</script>

<style scoped>
.relation-mode-group {
  display: flex;
  gap: var(--space-4);
}
</style>
