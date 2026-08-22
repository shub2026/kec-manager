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
      <ListErrorState v-if="error" :message="error" @retry="load" />
      <el-table v-else v-loading="loading" :data="pagedList" stripe row-key="id">
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
        <el-table-column v-if="!isMobile" label="使用部门" min-width="120">
          <template #default="{ row }">{{ row.colleges?.name || '-' }}</template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="关联类型" min-width="90">
          <template #default="{ row }">
            <el-tag v-if="row.majorId" type="success" size="small" disable-transitions
              >按专业</el-tag
            >
            <el-tag
              v-else-if="row.trainingLevelId"
              size="small"
              class="tag-indigo"
              disable-transitions
              >按层次</el-tag
            >
          </template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="专业" min-width="120">
          <template #default="{ row }">{{ row.majors?.name || '-' }}</template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="培养层次" min-width="100">
          <template #default="{ row }">{{ row.trainingLevels?.name || '-' }}</template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="状态" min-width="100" align="center">
          <template #default="{ row }">
            <el-dropdown trigger="click" @command="(cmd) => handleStatusCommand(cmd, row)">
              <el-tag
                :type="statusTagType(row.status)"
                size="small"
                class="status-tag-clickable"
                disable-transitions
                title="点击切换状态"
              >
                {{ statusLabel(row.status) }}
              </el-tag>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="active" :disabled="row.status === 'active'">
                    生效
                  </el-dropdown-item>
                  <el-dropdown-item command="draft" :disabled="row.status === 'draft'">
                    草稿
                  </el-dropdown-item>
                  <el-dropdown-item command="archived" :disabled="row.status === 'archived'">
                    归档
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
        <el-table-column
          v-if="!isMobile"
          prop="version"
          label="版本"
          min-width="70"
          align="center"
        />
        <el-table-column v-if="!isMobile" label="适用年级" min-width="110" align="center">
          <template #default="{ row }">{{ formatApplyYears(row) }}</template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="课程数" min-width="75" align="center">
          <template #default="{ row }">{{ row.courseCount || 0 }}</template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="使用班级" min-width="85" align="center">
          <template #default="{ row }">{{ row.classCount || 0 }}</template>
        </el-table-column>
        <el-table-column v-if="!isMobile" label="排序" min-width="105" align="center">
          <template #default="{ row }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="realIndex(row) === 0"
                circle
                title="上移"
                aria-label="上移"
                @click="handleMoveUp(row, realIndex(row))"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="realIndex(row) === filteredList.length - 1"
                circle
                title="下移"
                aria-label="下移"
                @click="handleMoveDown(row, realIndex(row))"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              type="primary"
              title="编辑明细"
              @click="$router.push(`/plans/${row.id}`)"
            >
              <el-icon><Edit /></el-icon>编辑明细
            </el-button>
            <el-button
              size="small"
              :icon="Edit"
              circle
              title="编辑信息"
              aria-label="编辑信息"
              @click="openDialog(row)"
            />
            <el-button
              size="small"
              :icon="CopyDocument"
              circle
              title="派生新版本（修订培养方案时，新年级使用新版本）"
              aria-label="派生新版本"
              @click="openNewVersionDialog(row)"
            />
            <el-button
              size="small"
              type="danger"
              :icon="Delete"
              circle
              title="删除"
              aria-label="删除"
              @click="handleDelete(row)"
            />
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filteredList.length"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="currentPage = 1"
        />
      </div>
    </el-card>

    <!-- 新增/编辑方案弹窗 -->
    <PlanFormDialog
      v-model:visible="dialogVisible"
      :plan="editingPlan"
      :colleges="colleges"
      :majors="majors"
      :training-levels="trainingLevels"
      :saving="saving"
      @save="handleSave"
    />

    <!-- 删除确认弹窗 -->
    <DeleteConfirmDialog
      v-model="deleteConfirmVisible"
      :loading="deleting"
      :warning="deleteWarning"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    >
      确定要删除此培养方案吗？此操作不可撤销。
    </DeleteConfirmDialog>

    <!-- 派生新版本弹窗：修订培养方案时，新年级使用新版本（复制课程/学期/教材） -->
    <PlanNewVersionDialog
      v-model:visible="newVersionVisible"
      :source="newVersionSource"
      :saving="newVersionSaving"
      @save="handleNewVersionSave"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onActivated } from 'vue';
import { ArrowUp, ArrowDown, Edit, Delete, CopyDocument } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getPlans, createPlan, updatePlan, deletePlan, createPlanNewVersion } from '../../api/plan';
import { getMajors } from '../../api/major';
import { getTrainingLevels } from '../../api/trainingLevel';
import { getColleges } from '../../api/college';
import { useSortable } from '../../composables/useSortable';
import { useResponsive } from '../../composables/useResponsive';
import EmptyState from '../../components/EmptyState.vue';
import PageHeader from '../../components/PageHeader.vue';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import PlanFormDialog from './components/PlanFormDialog.vue';
import PlanNewVersionDialog from './components/PlanNewVersionDialog.vue';

defineOptions({ name: 'PlanList' });

const { isMobile } = useResponsive();

const list = ref([]);
const loading = ref(false);
// P0 修复：列表加载错误状态，供 ListErrorState 占位
const error = ref(null);
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

// 前端切片分页（客户端分页）
// 适用条件：后端不提供分页接口，且数据量有限（<500行），
// 前端需要全量数据支持拖拽排序（useSortable），故一次加载全量后客户端切片渲染。
// 数据量增长后应改为服务端分页 + 后端排序接口。
const pagedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredList.value.slice(start, start + pageSize.value);
});

// 计算行在 filteredList 中的真实索引（分页后视觉 $index 不再等于真实序）
// 性能优化：预计算 id→index Map，行内取值 O(1)，避免每行 findIndex O(n)
const realIndexMap = computed(() => new Map(filteredList.value.map((i, idx) => [i.id, idx])));
const realIndex = (row) => realIndexMap.value.get(row.id) ?? -1;

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
// 编辑时传入方案行，新增时为 null（表单初始化由 PlanFormDialog 内部完成）
const editingPlan = ref(null);

// 使用排序 composable（针对 filteredList）
const { handleMoveUp, handleMoveDown } = useSortable(filteredList, updatePlan, silentReload, {
  indexFinder: (item) => filteredList.value.findIndex((i) => i.id === item.id),
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await getPlans();
    list.value = res.data || [];
  } catch (e) {
    error.value = e?.response?.data?.message || '培养方案加载失败，请稍后重试';
    if (import.meta.env.DEV) console.error('加载失败:', e);
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

function openDialog(row) {
  editingPlan.value = row || null;
  dialogVisible.value = true;
}

// PlanFormDialog 校验通过后回调，此处只负责接口调用与刷新
async function handleSave(data) {
  saving.value = true;
  try {
    if (editingPlan.value?.id) {
      await updatePlan(editingPlan.value.id, data);
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

// 适用年级列展示：两端皆空为"全部"，单端空分别显示"不限"/"至今"
function formatApplyYears(row) {
  const from = row?.applyFromYear;
  const to = row?.applyToYear;
  if (from == null && to == null) return '全部';
  return `${from ?? '不限'}~${to ?? '至今'}`;
}

// ── 方案状态管理（draft/active/archived）──
// 与课程查询页同款映射：生效绿 / 草稿橙 / 归档灰
function statusLabel(status) {
  const map = { active: '生效', draft: '草稿', archived: '归档' };
  return map[status] || status || '—';
}

function statusTagType(status) {
  const map = { active: 'success', draft: 'warning', archived: 'info' };
  return map[status] || 'info';
}

// 状态快捷切换：仅传 status，走 updatePlan（后端 status !== undefined 分支）
async function handleStatusCommand(command, row) {
  if (command === row.status) return;
  try {
    await updatePlan(row.id, { status: command });
    ElMessage.success(`已切换为「${statusLabel(command)}」`);
    await silentReload();
  } catch {
    // request.js 拦截器已显示后端错误消息，此处静默回滚（silentReload 恢复真实状态）
  }
}

// ── 派生新版本 ──
const newVersionVisible = ref(false);
const newVersionSaving = ref(false);
const newVersionSource = ref(null);

function openNewVersionDialog(row) {
  newVersionSource.value = row;
  newVersionVisible.value = true;
}

// PlanNewVersionDialog 校验通过后回调，此处只负责接口调用与刷新
async function handleNewVersionSave(payload) {
  newVersionSaving.value = true;
  try {
    await createPlanNewVersion(newVersionSource.value.id, payload);
    ElMessage.success('新版本创建成功，请前往新方案确认课程差异');
    newVersionVisible.value = false;
    await silentReload();
  } catch {
    // request.js 拦截器已显示后端错误消息（含重叠校验提示）
  } finally {
    newVersionSaving.value = false;
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
/* 状态标签可点击切换（配合 el-dropdown） */
.status-tag-clickable {
  cursor: pointer;
}
</style>
