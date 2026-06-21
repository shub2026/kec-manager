<template>
  <el-dialog v-model="dialogVisible" title="修改密码" width="500px" @close="handleClose">
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
          placeholder="请输入新密码（至少8位）"
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
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="loading" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { useAuthStore } from '../stores/auth';
import { ElMessage } from 'element-plus';

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
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
    { min: 8, message: '密码长度至少8位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
};

const dialogVisible = ref(false);

watch(
  () => props.modelValue,
  (val) => {
    dialogVisible.value = val;
  }
);

watch(dialogVisible, (val) => {
  emit('update:modelValue', val);
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

  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    loading.value = true;

    try {
      const result = await authStore.changePassword(form.oldPassword, form.newPassword);

      if (result.success) {
        ElMessage.success(result.message);
        handleClose();
        emit('success');

        // 退出登录，让用户重新登录
        await authStore.logout();
        ElMessage.success('密码已修改，请重新登录');
      } else {
        ElMessage.error(result.message);
      }
    } catch (error) {
      ElMessage.error('密码修改失败，请稍后重试');
    } finally {
      loading.value = false;
    }
  });
}
</script>
