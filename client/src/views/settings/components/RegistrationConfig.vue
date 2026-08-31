<template>
  <el-card class="registration-card">
    <template #header>
      <SettingsCardHeader dot="blue" tag="账号与安全" tag-type="primary"
        >注册设置</SettingsCardHeader
      >
    </template>

    <div class="registration-body">
      <div class="config-item">
        <div class="switch-row">
          <div class="switch-info">
            <label class="field-label">开放访客自助注册</label>
            <p class="switch-desc">
              控制登录页「注册访客账号」入口。<br />
              开启后：访客可在登录页自助注册，注册成功的账号<strong>直接激活</strong>，可立即登录使用。<br />
              关闭后：登录页与小程序隐藏注册入口，注册请求也会被服务端拒绝（默认）。
            </p>
          </div>
          <el-switch
            v-model="enabled"
            :loading="saving"
            inline-prompt
            active-text="开"
            inactive-text="关"
            size="large"
            @change="handleToggle"
          />
        </div>
        <div v-if="enabled" class="enabled-hint">
          <el-icon color="var(--brand-success)"><CircleCheckFilled /></el-icon>
          <span>已开启 — 访客注册后账号直接激活，请留意用户管理中的新增账号</span>
        </div>
        <div v-else class="enabled-hint off">
          <el-icon><InfoFilled /></el-icon>
          <span>已关闭 — 注册入口隐藏且注册请求被拒绝（默认）</span>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useSettingsStore } from '../../../stores/settings';
import SettingsCardHeader from './SettingsCardHeader.vue';

const settingsStore = useSettingsStore();
const enabled = ref(false);
const saving = ref(false);

async function loadState() {
  await settingsStore.load();
  enabled.value = settingsStore.settings.registerEnabled?.value === 'true';
}

async function handleToggle(value) {
  saving.value = true;
  try {
    await settingsStore.save({ registerEnabled: value });
    ElMessage.success(value ? '已开放注册：注册账号将直接激活' : '已关闭注册：注册入口已隐藏');
  } catch (e) {
    enabled.value = !value;
    ElMessage.error('保存失败：' + (e.message || '未知错误'));
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadState();
});
</script>

<style scoped>
.registration-body {
  padding: var(--space-6) 0 var(--space-4);
}

.config-item {
  max-width: 800px;
  padding: var(--space-2) 0;
}

.switch-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  /* --space-8 未在令牌中定义（只到 --space-7），会使 gap 失效为 0 */
  gap: var(--space-7);
}

.switch-info {
  flex: 1;
}

.field-label {
  display: block;
  margin-bottom: var(--space-3);
  font-weight: var(--fw-medium);
  font-size: var(--font-size-body);
  color: var(--text-regular);
  letter-spacing: 0.01em;
}

.switch-desc {
  margin: 0;
  font-size: var(--font-size-body-sm);
  line-height: 1.7;
  color: var(--text-secondary);
}

.enabled-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--space-4);
  font-size: var(--font-size-body-sm);
  /* 白底小字需 -text 深阶达标对比度，400 档仅用于图形/图标 */
  color: var(--brand-success-text);
}

.enabled-hint.off {
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .switch-row {
    flex-direction: column-reverse;
    align-items: flex-start;
  }
}
</style>
