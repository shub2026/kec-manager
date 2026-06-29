<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span
            ><el-icon><Document /></el-icon> 培养方案管理</span
          >
          <el-button type="primary" @click="openDialog()">
            <el-icon><Plus /></el-icon> 新增方案
          </el-button>
        </div>
      </template>
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
      <el-table v-loading="loading" :data="filteredlist" stripe row-key="id">
        <template #empty>
          <el-empty description="暂无培养方案，请点击右上角新增" />
        </template>
        <el-table-column type="index" label="序号" width="55" />
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
          <template #default="{ row, $index }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="$index === 0"
                circle
                title="上移"
                @click="handleMoveUp(row)"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="$index === filteredlist.length - 1"
                circle
                title="下移"
                @click="handleMoveDown(row)"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right" align="center">
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
            <el-popconfirm title="确定删除？" @confirm="handleDelete(row.id)">
              <template #reference>
                <el-button size="small" type="danger" title="删除">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="form.id ? '编辑方案' : '新增方案'"
      width="min(500px, 90vw)"
      destroy-on-close
    >
      <el-form :model="form" label-width="90px">
        <el-form-item label="方案名称" required>
          <el-input v-model="form.name" placeholder="如：2024级学前教育培养方案" />
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ArrowUp, ArrowDown, Document } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getPlans, createPlan, updatePlan, deletePlan } from '../../api/plan';
import { getMajors } from '../../api/major';
import { getTrainingLevels } from '../../api/trainingLevel';
import { getColleges } from '../../api/college';
import { useSortable } from '../../composables/useSortable';

const list = ref([]);
const loading = ref(false);
const majors = ref([]);
const trainingLevels = ref([]);
const colleges = ref([]);
const filterCollegeId = ref('');
const filteredlist = computed(() => {
  if (!filterCollegeId.value || filterCollegeId.value === '') return list.value;
  return list.value.filter((item) => item.collegeId === Number(filterCollegeId.value));
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

// 使用排序 composable（针对 filteredlist）
const { handleMoveUp, handleMoveDown } = useSortable(filteredlist, updatePlan, silentReload, {
  indexFinder: (item) => filteredlist.value.findIndex((i) => i.id === item.id),
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
  } catch (e) {
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
  // filteredlist 是 computed，自动响应 filterCollegeId 变化
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
  if (!form.value.name) return ElMessage.warning('请填写方案名称');

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
      college_id: form.value.collegeId || null,
      major_id: form.value.majorId || null,
      training_level_id: form.value.trainingLevelId || null,
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

async function handleDelete(id) {
  try {
    await deletePlan(id);
    ElMessage.success('删除成功');
    await silentReload();
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('删除培养方案失败:', e);
    }
    ElMessage.error('删除失败，请重试');
  }
}

onMounted(async () => {
  await loadMeta();
  load();
});
</script>

<style scoped>
.relation-mode-group {
  display: flex;
  gap: 16px;
}
</style>
