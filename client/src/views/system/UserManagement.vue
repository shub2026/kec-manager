<template>
  <div class="user-management">
    <PageHeader title="用户管理" subtitle="系统管理" description="管理系统用户账户和权限设置">
      <template #extra>
        <el-button type="primary" @click="showCreateDialog">
          <el-icon><Plus /></el-icon>
          创建用户
        </el-button>
      </template>
    </PageHeader>
    <el-card>
      <div class="page-toolbar">
        <el-input
          v-model="keyword"
          clearable
          placeholder="搜索用户名 / 姓名 / 邮箱"
          class="filter-2xl"
          :prefix-icon="Search"
        />
      </div>
      <!-- 用户列表 -->
      <ListErrorState v-if="error" :message="error" @retry="loadUsers" />
      <el-table v-else v-loading="loading" :data="displayUsers" stripe row-key="id">
        <template #empty>
          <EmptyState type="generic" description="暂无数据" />
        </template>
        <el-table-column type="index" label="序号" min-width="60" align="center" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="realName" label="姓名" min-width="100" />
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column label="角色" min-width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="getRoleType(row.role)" size="small" disable-transitions>
              {{ getRoleLabel(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'danger'" size="small" disable-transitions>
              {{ row.isActive ? '激活' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" label="最后登录" min-width="160">
          <template #default="{ row }">
            <span :class="{ 'text-muted': !row.lastLoginAt }">
              {{ row.lastLoginAt ? formatTime(row.lastLoginAt) : '从未登录' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" align="center">
          <template #default="{ row }">
            <el-button
              size="small"
              type="primary"
              :disabled="row.role === 'super_admin'"
              aria-label="编辑用户"
              @click="showEditDialog(row)"
            >
              编辑
            </el-button>
            <el-button
              size="small"
              :type="row.isActive ? 'warning' : 'success'"
              :disabled="row.role === 'super_admin'"
              :aria-label="row.isActive ? '禁用用户' : '激活用户'"
              @click="toggleUserStatus(row)"
            >
              {{ row.isActive ? '禁用' : '激活' }}
            </el-button>
            <el-button
              size="small"
              type="success"
              plain
              :disabled="row.id === authStore.userInfo?.id || row.role === 'super_admin'"
              aria-label="重置密码"
              @click="openResetPwdDialog(row)"
            >
              重置密码
            </el-button>
            <el-button
              size="small"
              type="danger"
              :disabled="row.id === authStore.userInfo?.id || row.role === 'super_admin'"
              aria-label="删除用户"
              @click="deleteUser(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[20, 50, 100]"
          :total="paginationTotal"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="loadUsers"
          @current-change="loadUsers"
        />
      </div>
    </el-card>

    <!-- 创建/编辑用户对话框组件 -->
    <UserFormDialog ref="formDialogRef" :submitting="submitting" @save="handleSubmit" />

    <!-- 重置密码对话框组件（自包含 API 调用） -->
    <ResetPasswordDialog ref="resetPwdDialogRef" />

    <!-- 用户状态切换确认弹窗 -->
    <el-dialog
      v-model="statusConfirmVisible"
      title="确认操作"
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody>{{ statusConfirmMessage }}</BaseConfirmBody>
      <template #footer>
        <el-button @click="statusConfirmVisible = false">取消</el-button>
        <el-button type="warning" :loading="statusChanging" @click="confirmToggleStatus"
          >确定</el-button
        >
      </template>
    </el-dialog>

    <!-- 用户删除确认弹窗 -->
    <DeleteConfirmDialog
      v-model="deleteConfirmVisible"
      :loading="userDeleting"
      @confirm="confirmDeleteUser"
    >
      {{ deleteConfirmMessage }}
    </DeleteConfirmDialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { ElMessage } from 'element-plus';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser as apiDeleteUser,
  toggleUserStatus as apiToggleUserStatus,
} from '../../api/user';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog.vue';
import ListErrorState from '../../components/ListErrorState.vue';
import UserFormDialog from './components/UserFormDialog.vue';
import ResetPasswordDialog from './components/ResetPasswordDialog.vue';

defineOptions({ name: 'UserManagement' });

const authStore = useAuthStore();

const users = ref([]);
const loading = ref(false);
// P0 修复：列表加载错误状态，供 ListErrorState 占位
const error = ref(null);
const submitting = ref(false);

// 弹窗组件引用
const formDialogRef = ref(null);
const resetPwdDialogRef = ref(null);

// 分页
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);

// P1-4：补 .page-toolbar 搜索框，对齐基础数据组节奏；客户端过滤已加载用户
const keyword = ref('');
const displayUsers = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return users.value;
  return users.value.filter(
    (u) =>
      (u.username && u.username.toLowerCase().includes(kw)) ||
      (u.realName && u.realName.toLowerCase().includes(kw)) ||
      (u.email && u.email.toLowerCase().includes(kw))
  );
});
// 搜索时以过滤后数量作为分页总数（仅对当前已加载页生效，跨页全文搜索需后端支持）
const paginationTotal = computed(() =>
  keyword.value.trim() ? displayUsers.value.length : total.value
);
// 搜索词变化回到第 1 页
watch(keyword, () => {
  currentPage.value = 1;
});

// 状态切换确认弹窗
const statusConfirmVisible = ref(false);
const statusConfirmMessage = ref('');
const statusChanging = ref(false);
const pendingStatusUser = ref(null);

// 删除确认弹窗
const deleteConfirmVisible = ref(false);
const deleteConfirmMessage = ref('');
const userDeleting = ref(false);
const pendingDeleteUser = ref(null);

async function loadUsers() {
  loading.value = true;
  try {
    const response = await getUsers({
      page: currentPage.value,
      page_size: pageSize.value,
      keyword: keyword.value,
    });
    const data = response.data;
    if (Array.isArray(data)) {
      // 向后兼容：如果服务端返回的是平面数组
      users.value = data;
      total.value = data.length;
    } else {
      users.value = data.items || [];
      total.value = data.total || 0;
    }
  } catch (err) {
    // P0 修复：写入错误状态（替代原有的仅 toast），列表区渲染 ListErrorState
    error.value = err?.response?.data?.message || '用户列表加载失败，请稍后重试';
    if (import.meta.env.DEV) console.error('加载用户列表失败:', err);
  } finally {
    loading.value = false;
  }
}

async function silentReload() {
  try {
    const response = await getUsers({
      page: currentPage.value,
      page_size: pageSize.value,
      keyword: keyword.value,
    });
    const data = response.data;
    if (Array.isArray(data)) {
      users.value = data;
      total.value = data.length;
    } else {
      users.value = data.items || [];
      total.value = data.total || 0;
    }
  } catch (error) {
    ElMessage.error('加载用户列表失败：' + (error.message || '未知错误'));
  }
}

function showCreateDialog() {
  formDialogRef.value?.open();
}

function showEditDialog(user) {
  formDialogRef.value?.open(user);
}

async function handleSubmit({ isEdit, id, data }) {
  submitting.value = true;

  try {
    if (isEdit) {
      await updateUser(id, data);
      ElMessage.success('更新成功');
    } else {
      await createUser(data);
      ElMessage.success('创建成功');
    }

    formDialogRef.value?.close();
    await silentReload();
  } catch (error) {
    // 提取服务端验证详情（422 响应 data.details 数组）
    const details = error.response?.data?.data?.details;
    if (Array.isArray(details) && details.length > 0) {
      ElMessage.error(details.map((d) => d.message).join('；'));
    } else {
      ElMessage.error(error.response?.data?.message || error.message || '操作失败');
    }
  } finally {
    submitting.value = false;
  }
}

function toggleUserStatus(user) {
  const action = user.isActive ? '禁用' : '激活';
  pendingStatusUser.value = user;
  statusConfirmMessage.value = `确定要${action}用户 "${user.username}" 吗？`;
  statusConfirmVisible.value = true;
}

async function confirmToggleStatus() {
  const user = pendingStatusUser.value;
  if (!user) return;
  const action = user.isActive ? '禁用' : '激活';

  statusConfirmVisible.value = false;
  statusChanging.value = true;
  try {
    const requestData = { isActive: !user.isActive };
    await apiToggleUserStatus(user.id, requestData);
    ElMessage.success(`${action}成功`);
    await silentReload();
  } catch (error) {
    ElMessage.error(`${action}失败：` + (error.message || '未知错误'));
  } finally {
    statusChanging.value = false;
    pendingStatusUser.value = null;
  }
}

function deleteUser(user) {
  if (user.id === authStore.userInfo?.id) {
    ElMessage.warning('不能删除当前登录的用户');
    return;
  }
  pendingDeleteUser.value = user;
  deleteConfirmMessage.value = `确定要删除用户 "${user.username}" 吗？此操作不可恢复！`;
  deleteConfirmVisible.value = true;
}

async function confirmDeleteUser() {
  const user = pendingDeleteUser.value;
  if (!user) return;

  deleteConfirmVisible.value = false;
  userDeleting.value = true;
  try {
    await apiDeleteUser(user.id);
    ElMessage.success('删除成功');
    await silentReload();
  } catch (error) {
    ElMessage.error('删除失败：' + (error.message || '未知错误'));
  } finally {
    userDeleting.value = false;
    pendingDeleteUser.value = null;
  }
}

function openResetPwdDialog(user) {
  resetPwdDialogRef.value?.open(user);
}

function getRoleType(role) {
  const types = {
    super_admin: 'danger',
    admin: 'warning',
    viewer: 'info',
  };
  return types[role] || 'info';
}

function getRoleLabel(role) {
  const labels = {
    super_admin: '超级管理员',
    admin: '管理员',
    viewer: '访客',
  };
  return labels[role] || role;
}

function formatTime(date) {
  return new Date(date).toLocaleString('zh-CN');
}

onMounted(() => {
  loadUsers();
});
</script>
