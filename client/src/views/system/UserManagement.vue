<template>
  <div class="user-management">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>用户管理</span>
          <el-button type="primary" @click="showCreateDialog">
            <el-icon><Plus /></el-icon>
            创建用户
          </el-button>
        </div>
      </template>

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
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="realName" label="姓名" min-width="100" />
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column label="角色" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="getRoleType(row.role)" size="small">
              {{ getRoleLabel(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
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
        <el-table-column label="操作" fixed="right" width="220" align="center">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="showEditDialog(row)">编辑</el-button>
            <el-button
              size="small"
              :type="row.isActive ? 'warning' : 'success'"
              :disabled="row.role === 'super_admin'"
              @click="toggleUserStatus(row)"
            >
              {{ row.isActive ? '禁用' : '激活' }}
            </el-button>
            <el-button
              size="small"
              type="danger"
              :disabled="row.id === authStore.userInfo?.id || row.role === 'super_admin'"
              @click="deleteUser(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建/编辑用户对话框 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑用户' : '创建用户'" width="600px">
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
              <span style="color: #999; font-size: 12px; margin-left: 10px"
                >基础数据和培养方案维护</span
              >
            </el-option>
            <el-option label="访客" value="viewer">
              <span>访客</span>
              <span style="color: #999; font-size: 12px; margin-left: 10px">仅查询权限</span>
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
          <p style="margin-top: 8px; color: #f56c6c">
            <strong>注意：</strong>超级管理员是系统唯一角色，不能通过此界面创建。
          </p>
        </el-alert>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '@/utils/request';

const authStore = useAuthStore();

const users = ref([]);
const loading = ref(false);
const dialogVisible = ref(false);
const isEdit = ref(false);
const submitting = ref(false);
const formRef = ref(null);

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
    const response = await request.get('/users');
    users.value = response.data;
  } catch (error) {
    ElMessage.error('加载用户列表失败：' + (error.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

async function silentReload() {
  try {
    const response = await request.get('/users');
    users.value = response.data;
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

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    submitting.value = true;

    try {
      if (isEdit.value) {
        await request.put(`/users/${formData.value.id}`, {
          real_name: formData.value.realName,
          email: formData.value.email,
          role: formData.value.role,
        });
        ElMessage.success('更新成功');
      } else {
        // 转换字段名为snake_case以匹配后端期望
        const userData = {
          username: formData.value.username,
          password: formData.value.password,
          real_name: formData.value.realName || undefined,
          email: formData.value.email || undefined,
          role: formData.value.role,
        };
        await request.post('/users', userData);
        ElMessage.success('创建成功');
      }

      dialogVisible.value = false;
      await silentReload();
    } catch (error) {
      ElMessage.error(error.message || '操作失败');
    } finally {
      submitting.value = false;
    }
  });
}

async function toggleUserStatus(user) {
  const action = user.isActive ? '禁用' : '激活';

  await ElMessageBox.confirm(`确定要${action}用户 "${user.username}" 吗？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  });

  try {
    const requestData = { is_active: !user.isActive };

    await request.put(`/users/${user.id}/status`, requestData);

    ElMessage.success(`${action}成功`);
    await silentReload();
  } catch (error) {
    ElMessage.error(`${action}失败：` + (error.message || '未知错误'));
  }
}

async function deleteUser(user) {
  if (user.id === authStore.userInfo?.id) {
    ElMessage.warning('不能删除当前登录的用户');
    return;
  }

  await ElMessageBox.confirm(`确定要删除用户 "${user.username}" 吗？此操作不可恢复！`, '警告', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'error',
  });

  try {
    await request.delete(`/users/${user.id}`);
    ElMessage.success('删除成功');
    await silentReload();
  } catch (error) {
    ElMessage.error('删除失败');
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
.user-management {
  padding: 20px;
}

.text-muted {
  color: #909399;
  font-size: 13px;
}
</style>
