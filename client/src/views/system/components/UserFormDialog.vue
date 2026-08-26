<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑用户' : '创建用户'"
    width="var(--dialog-width-lg)"
    :fullscreen="isMobile"
    :close-on-click-modal="false"
    destroy-on-close
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
          placeholder="至少8位，包含两种字符类型（字母/数字/符号）"
        />
      </el-form-item>

      <el-form-item label="姓名" prop="realName">
        <el-input v-model="formData.realName" placeholder="请输入姓名" />
      </el-form-item>

      <el-form-item label="邮箱" prop="email">
        <el-input v-model="formData.email" placeholder="请输入邮箱" />
      </el-form-item>

      <el-form-item label="角色" prop="role">
        <el-select
          v-model="formData.role"
          placeholder="请选择角色"
          style="width: 100%"
          :disabled="isEdit && formData.role === 'super_admin'"
        >
          <el-option
            v-if="isEdit && formData.role === 'super_admin'"
            label="超级管理员"
            value="super_admin"
            disabled
          />
          <el-option label="管理员" value="admin">
            <span>管理员</span>
            <span class="role-hint">基础数据和培养方案维护</span>
          </el-option>
          <el-option label="访客" value="viewer">
            <span>访客</span>
            <span class="role-hint">仅查询权限</span>
          </el-option>
        </el-select>
        <div v-if="isEdit && formData.role === 'super_admin'" class="role-hint-self">
          当前用户为超级管理员，角色不可修改
        </div>
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
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue';
import { useResponsive } from '@/composables/useResponsive';
import { createPasswordRules } from '@/utils/passwordRules';

defineProps({
  submitting: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['save']);

const { isMobile } = useResponsive();

const visible = ref(false);
const isEdit = ref(false);
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
    ...createPasswordRules({ required: false }),
  ],
  email: [{ type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
};

function open(user) {
  if (user) {
    isEdit.value = true;
    formData.value = {
      id: user.id,
      username: user.username,
      realName: user.realName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    };
  } else {
    isEdit.value = false;
    formData.value = {
      username: '',
      password: '',
      realName: '',
      email: '',
      role: 'admin',
    };
  }
  visible.value = true;
}

function close() {
  visible.value = false;
}

async function handleSubmit() {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  emit('save', {
    isEdit: isEdit.value,
    id: formData.value.id,
    data: isEdit.value
      ? formData.value.role === 'super_admin'
        ? {
            realName: formData.value.realName,
            email: formData.value.email,
          }
        : {
            realName: formData.value.realName,
            email: formData.value.email,
            role: formData.value.role,
          }
      : {
          username: formData.value.username,
          password: formData.value.password,
          realName: formData.value.realName || undefined,
          email: formData.value.email || undefined,
          role: formData.value.role,
        },
  });
}

defineExpose({ open, close });
</script>

<style scoped>
.role-hint {
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  margin-left: 10px;
}
.role-hint-self {
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  margin-top: 6px;
}
.role-alert {
  margin-top: 10px;
}
.danger-hint {
  margin-top: 8px;
  color: var(--brand-danger-text);
}
</style>
