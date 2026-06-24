<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <span
            ><el-icon><Reading /></el-icon> 课程管理</span
          >
          <div class="card-header-actions">
            <el-input
              v-model="filterName"
              clearable
              placeholder="搜索课程名称"
              class="filter-input"
            />
            <el-button @click="exportData">数据导出</el-button>
            <el-button @click="downloadTemplate">下载模板</el-button>
            <el-upload
              :show-file-list="false"
              accept=".xlsx,.xls"
              action="/api/import/courses"
              name="file"
              :headers="uploadHeaders"
              :on-success="onImportSuccess"
              :on-error="onImportError"
              :before-upload="beforeImport"
            >
              <el-button>导入Excel</el-button>
            </el-upload>
            <el-button type="primary" @click="openDialog()">
              <el-icon><Plus /></el-icon> 新增课程
            </el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="loading" :data="filteredList" stripe row-key="id">
        <template #empty>
          <el-empty description="暂无课程数据，请点击右上角新增" />
        </template>
        <el-table-column type="index" label="序号" width="60" />
        <el-table-column prop="name" label="课程名称" min-width="150" />
        <el-table-column prop="code" label="编码" width="120" />
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-tag :type="row.type === 'public' ? 'success' : 'warning'">
              {{ row.type === 'public' ? '公共基础课' : '专业课' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="排序" width="120" align="center">
          <template #default="{ row, $index }">
            <div class="sort-buttons">
              <el-button
                size="small"
                :icon="ArrowUp"
                :disabled="$index === 0"
                circle
                title="上移"
                @click="handleMoveUp(row, $index)"
              />
              <el-button
                size="small"
                :icon="ArrowDown"
                :disabled="$index === filteredList.length - 1"
                circle
                title="下移"
                @click="handleMoveDown(row, $index)"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDialog(row)">编辑</el-button>
            <el-popconfirm title="确定删除？" @confirm="handleDelete(row.id)">
              <template #reference>
                <el-button size="small" type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑课程' : '新增课程'" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="课程名称" required>
          <el-input v-model="form.name" placeholder="请输入课程名称" />
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model="form.code" placeholder="请输入编码（可选）" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="public">公共基础课</el-radio>
            <el-radio value="professional">专业课</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            placeholder="请输入描述信息（可选）"
          />
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
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowUp, ArrowDown } from '@element-plus/icons-vue';
import { getCookie } from '@/utils/cookies';
import request from '../../utils/request';
import { getCourses, createCourse, updateCourse, deleteCourse } from '../../api/course';
import { useExport } from '../../composables/useExport';
import { useSortable } from '../../composables/useSortable';

const list = ref([]);
const filterName = ref('');
const uploadHeaders = computed(() => {
  const token = getCookie('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
});
const loading = ref(false);
const dialogVisible = ref(false);
const saving = ref(false);
const form = ref({ id: null, name: '', code: '', type: 'public', description: '' });

// 导入相关状态
const pendingFile = ref(null);

// 使用导出 composable
const { exportData, downloadTemplate } = useExport('courses', '课程数据');

// 筛选后的列表
const filteredList = computed(() => {
  if (!filterName.value) return list.value;
  const keyword = filterName.value.toLowerCase();
  return list.value.filter((item) => item.name && item.name.toLowerCase().includes(keyword));
});

// 使用排序 composable（注意：CourseList 使用 filteredList 而非 list）
const { handleMoveUp, handleMoveDown } = useSortable(filteredList, updateCourse, silentReload, {
  indexFinder: (item) => filteredList.value.findIndex((i) => i.id === item.id),
});

async function load() {
  loading.value = true;
  try {
    const res = await getCourses();
    list.value = res.data || [];
  } finally {
    loading.value = false;
  }
}

async function silentReload() {
  try {
    const res = await getCourses();
    list.value = res.data || [];
  } catch (e) {
    // silently ignore
  }
}

function openDialog(row) {
  form.value = row ? { ...row } : { id: null, name: '', code: '', type: 'public', description: '' };
  dialogVisible.value = true;
}

async function handleSave() {
  if (!form.value.name) return ElMessage.warning('请输入课程名称');
  saving.value = true;
  try {
    if (form.value.id) {
      await updateCourse(form.value.id, form.value);
    } else {
      await createCourse(form.value);
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
    await deleteCourse(id);
    ElMessage.success('删除成功');
    await silentReload();
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('删除课程失败:', e);
    }
    ElMessage.error('删除失败，请重试');
  }
}

// 导入前拦截，显示确认提示
async function beforeImport(file) {
  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  if (!isExcel) {
    ElMessage.error('请上传Excel文件');
    return false;
  }

  pendingFile.value = file;

  try {
    await ElMessageBox.confirm(
      '导入将以数据第一列（课程名称）进行匹配，已存在的课程将被覆盖更新，确定继续导入吗？',
      '导入确认',
      {
        confirmButtonText: '确定导入',
        cancelButtonText: '取消',
        type: 'warning',
      }
    );
    confirmImport();
  } catch {
    // 用户取消
    pendingFile.value = null;
  }

  return false; // 阻止自动上传
}

// 确认导入
async function confirmImport() {
  try {
    const formData = new FormData();
    formData.append('file', pendingFile.value);

    const response = await request.post('/import/courses', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    onImportSuccess(response);
  } catch (err) {
    onImportError(err);
  } finally {
    pendingFile.value = null;
  }
}

function onImportSuccess(res) {
  const data = res.data || {};
  const message = res.message || '导入完成';

  let detailMsg = message;

  if (data.errors && data.errors.length > 0) {
    detailMsg += '\n\n❌ 失败详情：';
    data.errors.forEach((error, index) => {
      detailMsg += `\n${index + 1}. ${error}`;
    });
  }

  if (data.failed && data.failed > 0) {
    ElMessage({
      message: detailMsg,
      type: 'warning',
      duration: 10000,
      showClose: true,
    });
  } else if (data.imported > 0 || data.overwritten > 0) {
    ElMessage({
      message: detailMsg,
      type: 'success',
      duration: 8000,
      showClose: true,
    });
  } else {
    ElMessage({
      message: detailMsg,
      type: 'info',
      duration: 6000,
      showClose: true,
    });
  }
  silentReload();
}

function onImportError(err) {
  if (import.meta.env.DEV) {
    console.error('导入错误:', err);
  }
  ElMessage.error('导入失败，请检查文件格式或联系管理员');
}

onMounted(() => {
  load();
});
</script>

<style scoped>
.filter-input {
  width: 180px;
}
.sort-buttons {
  display: flex;
  gap: 4px;
  justify-content: center;
}
</style>
