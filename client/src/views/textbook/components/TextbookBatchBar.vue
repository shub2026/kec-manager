<template>
  <div>
    <!-- 批量操作栏 -->
    <div v-if="selectedTextbooks.length > 0" class="batch-operations">
      <span class="selected-count">已选择 {{ selectedTextbooks.length }} 个教材</span>
      <el-button size="small" @click="openBatchSetDialog('publisher')">
        <el-icon><Edit /></el-icon> 批量设置出版社
      </el-button>
      <el-button size="small" @click="openBatchSetDialog('author')">
        <el-icon><Edit /></el-icon> 批量设置作者
      </el-button>
      <el-button size="small" @click="openBatchSetDialog('category')">
        <el-icon><Edit /></el-icon> 批量设置类别
      </el-button>
      <el-button size="small" type="danger" @click="handleBatchDelete">
        <el-icon><Delete /></el-icon> 批量删除
      </el-button>
    </div>

    <!-- 批量设置对话框 -->
    <el-dialog
      v-model="batchDialogVisible"
      :title="batchDialogTitle"
      width="var(--dialog-width-lg)"
      :fullscreen="isMobile"
      destroy-on-close
    >
      <el-form label-width="100px">
        <el-form-item v-if="batchFormType === 'publisher'" label="出版社">
          <el-input v-model="batchForm.publisher" placeholder="请输入出版社名称" />
        </el-form-item>
        <el-form-item v-else-if="batchFormType === 'author'" label="作者">
          <el-input v-model="batchForm.author" placeholder="请输入作者姓名" />
        </el-form-item>
        <el-form-item v-else-if="batchFormType === 'category'" label="类别">
          <el-select v-model="batchForm.category" placeholder="请选择类别" style="width: 100%">
            <el-option label="技工" value="技工" />
            <el-option label="非技工" value="非技工" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchSaving" @click="handleBatchSet">确定</el-button>
      </template>
    </el-dialog>

    <!-- 批量删除确认弹窗 -->
    <el-dialog
      v-model="batchDeleteConfirmVisible"
      title="批量删除"
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody icon-color="var(--brand-danger)">{{
        batchDeleteConfirmMessage
      }}</BaseConfirmBody>
      <template #footer>
        <el-button @click="batchDeleteConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="batchDeleting" @click="confirmBatchDelete"
          >确定删除</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Edit, Delete } from '@element-plus/icons-vue';
import { ElMessage, ElNotification } from 'element-plus';
// 按需导入项目中 service 函数（ElNotification）的 CSS 不会自动注入，需手动导入样式
// 否则通知 DOM 渲染但不可见（无背景/定位/动画）
import 'element-plus/es/components/notification/style/css';
import { batchUpdateTextbooks, batchDeleteTextbooks } from '@/api/textbook';
import { useResponsive } from '@/composables/useResponsive';
import BaseConfirmBody from '@/components/BaseConfirmBody.vue';

const props = defineProps({
  selectedTextbooks: {
    type: Array,
    default: () => [],
  },
});

// completed: 批量设置/删除完成后通知父页面清空选择并静默刷新列表
const emit = defineEmits(['completed']);

const { isMobile } = useResponsive();

// 批量设置相关状态
const batchDialogVisible = ref(false);
const batchSaving = ref(false);
const batchFormType = ref(''); // publisher, author, category
const batchDialogTitle = ref('');
const batchForm = ref({
  publisher: '',
  author: '',
  category: '',
});

// 打开批量设置对话框
function openBatchSetDialog(type) {
  batchFormType.value = type;
  batchDialogTitle.value = {
    publisher: '批量设置出版社',
    author: '批量设置作者',
    category: '批量设置类别',
  }[type];

  // 重置表单
  batchForm.value = {
    publisher: '',
    author: '',
    category: '',
  };

  batchDialogVisible.value = true;
}

// 执行批量设置
async function handleBatchSet() {
  const type = batchFormType.value;

  // 验证
  if (type === 'publisher' && !batchForm.value.publisher) {
    return ElMessage.warning('请输入出版社名称');
  }
  if (type === 'author' && !batchForm.value.author) {
    return ElMessage.warning('请输入作者姓名');
  }
  if (type === 'category' && !batchForm.value.category) {
    return ElMessage.warning('请选择类别');
  }

  batchSaving.value = true;
  try {
    const ids = props.selectedTextbooks.map((t) => t.id);
    const updates = {};

    switch (type) {
      case 'publisher':
        updates.publisher = batchForm.value.publisher;
        break;
      case 'author':
        updates.author = batchForm.value.author;
        break;
      case 'category':
        updates.category = batchForm.value.category;
        break;
    }

    const { data } = await batchUpdateTextbooks(ids, updates);
    const { succeeded = [], failed = [] } = data || {};

    if (failed.length === 0) {
      ElMessage.success(`已成功更新 ${succeeded.length} 个教材`);
    } else if (succeeded.length === 0) {
      ElMessage.error(`批量更新失败：${failed[0]?.reason || '未知错误'}`);
    } else {
      ElMessage.warning(`批量更新部分成功：成功 ${succeeded.length} 个，失败 ${failed.length} 个`);
    }

    batchDialogVisible.value = false;
    emit('completed');
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('批量更新失败:', e);
    }
    // request.js 拦截器已显示后端返回的错误消息，此处不再重复弹窗
  } finally {
    batchSaving.value = false;
  }
}

// 批量删除
const batchDeleteConfirmVisible = ref(false);
const batchDeleteConfirmMessage = ref('');
const batchDeleting = ref(false);

function handleBatchDelete() {
  if (props.selectedTextbooks.length === 0) return;
  batchDeleteConfirmMessage.value = `确定要删除选中的 ${props.selectedTextbooks.length} 个教材吗？被培养方案引用的教材将无法删除。`;
  batchDeleteConfirmVisible.value = true;
}

async function confirmBatchDelete() {
  batchDeleteConfirmVisible.value = false;
  batchDeleting.value = true;
  try {
    await doBatchDelete();
  } finally {
    batchDeleting.value = false;
  }
}

async function doBatchDelete() {
  const ids = props.selectedTextbooks.map((t) => t.id);

  try {
    const { data } = await batchDeleteTextbooks(ids);
    const { succeeded = [], failed = [] } = data || {};

    if (failed.length === 0) {
      ElNotification({
        title: '批量删除完成',
        message: `已成功删除 ${succeeded.length} 个教材`,
        type: 'success',
        duration: 4000,
      });
    } else if (succeeded.length === 0) {
      const refCount = failed.filter((f) => f.reason?.includes('培养方案')).length;
      if (refCount === failed.length) {
        ElNotification({
          title: '批量删除失败',
          message: `${refCount} 个教材已被培养方案引用，无法删除`,
          type: 'warning',
          duration: 6000,
        });
      } else {
        ElNotification({
          title: '批量删除失败',
          message: `删除失败：${failed[0]?.reason || '未知错误'}`,
          type: 'error',
          duration: 6000,
        });
      }
    } else {
      const refCount = failed.filter((f) => f.reason?.includes('培养方案')).length;
      const otherCount = failed.length - refCount;
      let msg = `成功删除 ${succeeded.length} 个`;
      if (refCount > 0) msg += `，${refCount} 个被培养方案引用无法删除`;
      if (otherCount > 0) msg += `，${otherCount} 个删除失败`;
      ElNotification({
        title: '批量删除部分成功',
        message: msg,
        type: 'warning',
        duration: 6000,
      });
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('[BatchDelete] 批量删除请求失败:', e);
    const reason = e?.response?.data?.message || e?.message || '未知错误';
    ElNotification({
      title: '批量删除失败',
      message: reason,
      type: 'error',
      duration: 6000,
    });
  }

  emit('completed');
}
</script>
