<template>
  <el-dialog
    v-model="dialogVisible"
    title="修改密码"
    width="min(500px, 90vw)"
    :close-on-click-modal="!forced"
    :close-on-press-escape="!forced"
    :show-close="!forced"
    @close="handleClose"
  >
    <el-alert
      v-if="forced"
      title="首次登录必须修改默认密码"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    />
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="原密码" prop="oldPassword">
        <el-input
          v-model="form.oldPassword"
          type="password"
          show-password
          placeholder="请输入原密码"
        />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input
          v-model="form.newPassword"
          type="password"
          show-password
          placeholder="至少8位，包含两种字符类型（字母/数字/符号）"
        />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirmPassword">
        <el-input
          v-model="form.confirmPassword"
          type="password"
          show-password
          placeholder="请再次输入新密码"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button v-if="!forced" @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="loading" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { useAuthStore } from '../stores/auth';
import { ElMessage } from 'element-plus';

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
  forced: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'success']);

const authStore = useAuthStore();
const formRef = ref(null);
const loading = ref(false);

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const validateConfirmPassword = (rule, value, callback) => {
  if (value !== form.newPassword) {
    callback(new Error('两次输入的密码不一致'));
  } else {
    callback();
  }
};

const rules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
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
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
};

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

function handleClose() {
  dialogVisible.value = false;
  resetForm();
}

function resetForm() {
  form.oldPassword = '';
  form.newPassword = '';
  form.confirmPassword = '';
  if (formRef.value) {
    formRef.value.clearValidate();
  }
}

async function handleSubmit() {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  loading.value = true;

  try {
    const result = await authStore.changePassword(form.oldPassword, form.newPassword);

    if (result.success) {
      handleClose();
      emit('success');

      ElMessage.success('密码修改成功，2秒后将自动退出，请使用新密码重新登录');
      setTimeout(() => {
        authStore.logout();
      }, 2000);
    } else {
      ElMessage.error(result.message);
    }
  } catch {
    // 拦截器已弹窗，避免重复提示
  } finally {
    loading.value = false;
  }
}
</script>
