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

    <!-- 创建/编辑用户对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑用户' : '创建用户'"
      width="var(--dialog-width-lg)"
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
            <!-- 本页仅超级管理员可见，可创建管理员和访客 -->
            <el-option label="管理员" value="admin">
              <span>管理员</span>
              <span class="role-hint">基础数据和培养方案维护</span>
            </el-option>
            <el-option label="访客" value="viewer">
              <span>访客</span>
              <span class="role-hint">仅查询权限</span>
            </el-option>
          </el-select>
        </el-form-item>

        <el-alert v-if="!isEdit" title="角色说明" type="info" :closable="false" class="role-alert">
          <p>
            <strong>管理员（二级管理员）：</strong
            >可以维护基础数据（专业、学院、课程等）、培养方案和教学安排，但不能访问系统管理（用户管理、系统设置、操作日志）
          </p>
          <p><strong>访客：</strong>只能访问查询页面，适合需要查看数据但不需要修改的用户</p>
          <p class="danger-hint">
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
    <el-dialog
      v-model="deleteConfirmVisible"
      title="确认删除"
      width="var(--dialog-width)"
      align-center
    >
      <BaseConfirmBody icon-color="var(--brand-danger)">{{ deleteConfirmMessage }}</BaseConfirmBody>
      <template #footer>
        <el-button @click="deleteConfirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="userDeleting" @click="confirmDeleteUser"
          >确定删除</el-button
        >
      </template>
    </el-dialog>

    <!-- 重置密码对话框 -->
    <el-dialog
      v-model="resetPwdVisible"
      title="重置密码"
      width="var(--dialog-width-lg)"
      destroy-on-close
    >
      <el-alert
        :title="`将重置用户“${resetPwdUser?.username}”的密码，重置后该用户下次登录必须修改密码`"
        type="warning"
        :closable="false"
        show-icon
        class="reset-pwd-alert"
      />
      <el-form
        ref="resetPwdFormRef"
        :model="resetPwdForm"
        :rules="resetPwdRules"
        label-width="100px"
      >
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="resetPwdForm.newPassword"
            type="password"
            show-password
            placeholder="至少8位，包含两种字符类型（字母/数字/符号）"
          >
            <template #append>
              <el-button @click="fillRandomPassword">随机生成</el-button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="resetPwdForm.confirmPassword"
            type="password"
            show-password
            placeholder="请再次输入新密码"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPwdVisible = false">取消</el-button>
        <el-button type="warning" :loading="resetPwdSubmitting" @click="handleResetPassword"
          >确定重置</el-button
        >
      </template>
    </el-dialog>
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
  resetUserPassword,
} from '../../api/user';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';
import BaseConfirmBody from '../../components/BaseConfirmBody.vue';
import ListErrorState from '../../components/ListErrorState.vue';

defineOptions({ name: 'UserManagement' });

const authStore = useAuthStore();

const users = ref([]);
const loading = ref(false);
// P0 修复：列表加载错误状态，供 ListErrorState 占位
const error = ref(null);
const dialogVisible = ref(false);
const isEdit = ref(false);
const submitting = ref(false);
const formRef = ref(null);

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

// 重置密码对话框
const resetPwdVisible = ref(false);
const resetPwdUser = ref(null);
const resetPwdFormRef = ref(null);
const resetPwdSubmitting = ref(false);
const resetPwdForm = ref({
  newPassword: '',
  confirmPassword: '',
});

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

// 重置密码校验规则（强度规则与 ChangePasswordDialog / 后端保持一致）
const validateResetConfirm = (rule, value, callback) => {
  if (value !== resetPwdForm.value.newPassword) {
    callback(new Error('两次输入的密码不一致'));
  } else {
    callback();
  }
};

const resetPwdRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, max: 128, message: '密码长度必须在8-128位之间', trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (!value) return callback();
        let types = 0;
        if (/[a-z]/.test(value)) types++;
        if (/[A-Z]/.test(value)) types++;
        if (/\d/.test(value)) types++;
        if (/[^a-zA-Z\d]/.test(value)) types++;
        if (types < 2) {
          callback(
            new Error('密码须至少包含两种字符类型（小写字母、大写字母、数字、特殊字符中的两种）')
          );
        } else {
          callback();
        }
      },
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    { validator: validateResetConfirm, trigger: 'blur' },
  ],
};

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
  isEdit.value = false;
  formData.value = {
    username: '',
    password: '',
    realName: '',
    email: '',
    role: 'admin',
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

function openResetPwdDialog(user) {
  resetPwdUser.value = user;
  resetPwdForm.value = { newPassword: '', confirmPassword: '' };
  resetPwdVisible.value = true;
}

// 生成随机密码：保证同时包含小写、大写、数字、特殊字符（满足强度校验），
// 并剔除易混淆字符（l/O/0/1）
function generateRandomPassword(length = 12) {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = lower + upper + digits + symbols;
  const rand = new Uint32Array(length);
  crypto.getRandomValues(rand);
  const chars = [
    lower[rand[0] % lower.length],
    upper[rand[1] % upper.length],
    digits[rand[2] % digits.length],
    symbols[rand[3] % symbols.length],
  ];
  for (let i = 4; i < length; i++) {
    chars.push(all[rand[i] % all.length]);
  }
  // Fisher-Yates 洗牌，打散前四位的固定类型顺序
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function fillRandomPassword() {
  const pwd = generateRandomPassword();
  resetPwdForm.value.newPassword = pwd;
  resetPwdForm.value.confirmPassword = pwd;
  resetPwdFormRef.value?.clearValidate();
}

async function handleResetPassword() {
  if (!resetPwdFormRef.value) return;

  try {
    await resetPwdFormRef.value.validate();
  } catch {
    return;
  }

  resetPwdSubmitting.value = true;
  try {
    await resetUserPassword(resetPwdUser.value.id, {
      newPassword: resetPwdForm.value.newPassword,
    });
    ElMessage.success('密码重置成功，该用户下次登录须修改密码');
    resetPwdVisible.value = false;
  } catch (error) {
    ElMessage.error(
      '密码重置失败：' + (error.response?.data?.message || error.message || '未知错误')
    );
  } finally {
    resetPwdSubmitting.value = false;
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

<style scoped>
.role-hint {
  color: var(--text-secondary);
  font-size: 12px;
  margin-left: 10px;
}
.role-alert {
  margin-top: 10px;
}
.danger-hint {
  margin-top: 8px;
  color: var(--brand-danger-text);
}
.reset-pwd-alert {
  margin-bottom: var(--space-4);
}
</style>
