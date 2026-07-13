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
      <!-- 权限提示 -->
      <el-alert
        v-if="authStore.userInfo?.role === 'admin'"
        title="提示：您当前为管理员角色，只能查看和管理访客账号。如需管理其他角色，请联系超级管理员。"
        type="info"
        :closable="false"
        style="margin-bottom: 16px"
      />

      <!-- 用户列表 -->
      <el-table v-loading="loading" :data="users" stripe row-key="id">
        <template #empty>
          <EmptyState type="generic" description="暂无数据" />
        </template>
        <el-table-column type="index" label="序号" min-width="60" align="center" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="realName" label="姓名" min-width="100" />
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column label="角色" min-width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="getRoleType(row.role)" size="small">
              {{ getRoleLabel(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'danger'" size="small">
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
        <el-table-column label="操作" width="220" align="center">
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
      <div style="display: flex; justify-content: flex-end; margin-top: 16px">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadUsers"
          @current-change="loadUsers"
        />
      </div>
    </el-card>

    <!-- 创建/编辑用户对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑用户' : '创建用户'"
      width="min(600px, 90vw)"
    >
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="formData.username" placeholder="请输入用户名" :disabled="isEdit" />
        </el-form-item>

        <el-form-item v-if="!isEdit" label="密码" prop="password">
          <el-input
            v-model="formData.password"
            type="password"
            show-password
            placeholder="请输入密码（至少8位）"
          />
        </el-form-item>

        <el-form-item label="姓名" prop="realName">
          <el-input v-model="formData.realName" placeholder="请输入姓名" />
        </el-form-item>

        <el-form-item label="邮箱" prop="email">
          <el-input v-model="formData.email" placeholder="请输入邮箱" />
        </el-form-item>

        <el-form-item label="角色" prop="role">
          <el-select v-model="formData.role" placeholder="请选择角色" style="width: 100%">
            <!-- 所有管理员都可以创建管理员和访客 -->
            <el-option label="管理员" value="admin">
              <span>管理员</span>
              <span style="color: var(--text-secondary); font-size: 12px; margin-left: 10px"
                >基础数据和培养方案维护</span
              >
            </el-option>
            <el-option label="访客" value="viewer">
              <span>访客</span>
              <span style="color: var(--text-secondary); font-size: 12px; margin-left: 10px"
                >仅查询权限</span
              >
            </el-option>
          </el-select>
        </el-form-item>

        <el-alert
          v-if="!isEdit"
          title="角色说明"
          type="info"
          :closable="false"
          style="margin-top: 10px"
        >
          <p>
            <strong>管理员（二级管理员）：</strong
            >可以维护基础数据（专业、学院、课程等）和培养方案，但不能配置系统设置和重置系统
          </p>
          <p><strong>访客：</strong>只能访问查询页面，适合需要查看数据但不需要修改的用户</p>
          <p style="margin-top: 8px; color: var(--brand-danger-text)">
            <strong>注意：</strong>超级管理员是系统唯一角色，不能通过此界面创建。
          </p>
        </el-alert>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 用户状态切换确认弹窗 -->
    <el-dialog
      v-model="statusConfirmVisible"
      title="确认操作"
      width="min(400px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-warning)" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <p style="margin: 0; line-height: 1.6; color: var(--text-regular)">
          {{ statusConfirmMessage }}
        </p>
      </div>
      <template #footer>
        <el-button @click="statusConfirmVisible = false">取消</el-button>
        <el-button type="warning" :loading="statusChanging" @click="confirmToggleStatus"
          >确定</el-button
        >
      </template>
    </el-dialog>

    <!-- 用户删除确认弹窗 -->
    <el-dialog
      v-model="deleteConfirmVisible"
      title="确认删除"
      width="min(400px, 90vw)"
      align-center
    >
      <div style="display: flex; gap: 12px; align-items: flex-start">
        <el-icon :size="24" color="var(--brand-danger)" style="flex-shrink: 0; margin-top: 2px"
          ><WarningFilled
        /></el-icon>
        <p style="margin: 0; line-height: 1.6; color: var(--text-regular)">
          {{ deleteConfirmMessage }}
        </p>
      </div>
      <template #footer>
        <el-button @click="deleteConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="userDeleting" @click="confirmDeleteUser"
          >确定删除</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { UserFilled } from '@element-plus/icons-vue';
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

defineOptions({ name: 'UserManagement' });

const authStore = useAuthStore();

const users = ref([]);
const loading = ref(false);
const dialogVisible = ref(false);
const isEdit = ref(false);
const submitting = ref(false);
const formRef = ref(null);

// 分页
const currentPage = ref(1);
const pageSize = ref(20);
const total = ref(0);

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

const formData = ref({
  username: '',
  password: '',
  realName: '',
  email: '',
  role: 'admin',
});

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度3-20个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码长度至少8位', trigger: 'blur' },
  ],
  email: [{ type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
};

async function loadUsers() {
  loading.value = true;
  try {
    const response = await getUsers({ page: currentPage.value, page_size: pageSize.value });
    const data = response.data;
    if (Array.isArray(data)) {
      // 向后兼容：如果服务端返回的是平面数组
      users.value = data;
      total.value = data.length;
    } else {
      users.value = data.items || [];
      total.value = data.total || 0;
    }
  } catch (error) {
    ElMessage.error('加载用户列表失败：' + (error.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

async function silentReload() {
  try {
    const response = await getUsers({ page: currentPage.value, page_size: pageSize.value });
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
  isEdit.value = false;
  formData.value = {
    username: '',
    password: '',
    realName: '',
    email: '',
    role: authStore.userInfo?.role === 'admin' ? 'viewer' : 'admin',
  };
  dialogVisible.value = true;
}

function showEditDialog(user) {
  isEdit.value = true;
  formData.value = {
    id: user.id,
    username: user.username,
    realName: user.realName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  };
  dialogVisible.value = true;
}

async function handleSubmit() {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  submitting.value = true;

  try {
    if (isEdit.value) {
      await updateUser(formData.value.id, {
        realName: formData.value.realName,
        email: formData.value.email,
        role: formData.value.role,
      });
      ElMessage.success('更新成功');
    } else {
      const userData = {
        username: formData.value.username,
        password: formData.value.password,
        realName: formData.value.realName || undefined,
        email: formData.value.email || undefined,
        role: formData.value.role,
      };
      await createUser(userData);
      ElMessage.success('创建成功');
    }

    dialogVisible.value = false;
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

<style scoped></style>
