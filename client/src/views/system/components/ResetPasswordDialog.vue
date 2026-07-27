<template>
  <el-dialog
    v-model="visible"
    title="重置密码"
    width="var(--dialog-width-lg)"
    :fullscreen="isMobile"
    destroy-on-close
  >
    <el-alert
      :title="`将重置用户“${targetUser?.username}”的密码，重置后该用户下次登录必须修改密码`"
      type="warning"
      :closable="false"
      show-icon
      class="reset-pwd-alert"
    />
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="新密码" prop="newPassword">
        <el-input
          v-model="form.newPassword"
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
          v-model="form.confirmPassword"
          type="password"
          show-password
          placeholder="请再次输入新密码"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="warning" :loading="submitting" @click="handleResetPassword"
        >确定重置</el-button
      >
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { resetUserPassword } from '@/api/user';
import { useResponsive } from '@/composables/useResponsive';

const { isMobile } = useResponsive();

const visible = ref(false);
const targetUser = ref(null);
const formRef = ref(null);
const submitting = ref(false);
const form = ref({
  newPassword: '',
  confirmPassword: '',
});

// 重置密码校验规则（强度规则与 ChangePasswordDialog / 后端保持一致）
const validateResetConfirm = (rule, value, callback) => {
  if (value !== form.value.newPassword) {
    callback(new Error('两次输入的密码不一致'));
  } else {
    callback();
  }
};

const rules = {
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

function open(user) {
  targetUser.value = user;
  form.value = { newPassword: '', confirmPassword: '' };
  visible.value = true;
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
  form.value.newPassword = pwd;
  form.value.confirmPassword = pwd;
  formRef.value?.clearValidate();
}

async function handleResetPassword() {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  submitting.value = true;
  try {
    await resetUserPassword(targetUser.value.id, {
      newPassword: form.value.newPassword,
    });
    ElMessage.success('密码重置成功，该用户下次登录须修改密码');
    visible.value = false;
  } catch (error) {
    ElMessage.error(
      '密码重置失败：' + (error.response?.data?.message || error.message || '未知错误')
    );
  } finally {
    submitting.value = false;
  }
}

defineExpose({ open });
</script>

<style scoped>
.reset-pwd-alert {
  margin-bottom: var(--space-4);
}
</style>
