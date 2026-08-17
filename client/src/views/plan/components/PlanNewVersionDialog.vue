<template>
  <el-dialog
    :model-value="visible"
    title="派生新版本"
    width="var(--dialog-width-lg)"
    :fullscreen="isMobile"
    destroy-on-close
    @update:model-value="$emit('update:visible', $event)"
  >
    <el-form label-width="130px">
      <el-form-item label="源方案">
        <span>{{ source?.name }}</span>
      </el-form-item>
      <el-form-item label="新方案名称" required>
        <el-input v-model="form.name" placeholder="如：高级工人培V2.0" maxlength="200" />
      </el-form-item>
      <el-form-item label="版本号">
        <el-input v-model="form.version" placeholder="如：V2.0（留空则按源方案版本自动递增）" />
      </el-form-item>
      <el-form-item label="起始入学年份" required>
        <el-input-number v-model="form.applyFromYear" :min="2000" :max="2100" :controls="false" />
        <div class="form-hint">新版本自此入学年份起适用（如 2026 表示 2026 级及以后）</div>
      </el-form-item>
      <el-form-item label="旧方案处理">
        <el-checkbox v-model="form.updateSourceEndYear">
          同步将旧方案适用止年收窄为起始年份前一年
        </el-checkbox>
        <div class="form-hint">推荐勾选：保证旧年级继续匹配旧版本方案</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useResponsive } from '../../../composables/useResponsive';
import { incrementVersion } from '../incrementVersion';

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 派生源方案行 */
  source: { type: Object, default: null },
  saving: { type: Boolean, default: false },
});

const emit = defineEmits(['update:visible', 'save']);

const { isMobile } = useResponsive();

const form = ref({
  name: '',
  version: '',
  applyFromYear: null,
  updateSourceEndYear: true,
});

// 弹窗打开时预填表单：名称加后缀、版本号递增、起始年份取当前自然年
// immediate 兼容直接以 visible=true 挂载的场景（如测试环境）
watch(
  () => props.visible,
  (v) => {
    if (!v || !props.source) return;
    form.value = {
      name: `${props.source.name}（新版本）`,
      // 默认预填源版本号递增结果（如 V1.0 → V2.0），用户可修改
      version: incrementVersion(props.source.version),
      // 默认预填当前自然年，用户可按实际招生年级调整
      applyFromYear: new Date().getFullYear(),
      updateSourceEndYear: true,
    };
  },
  { immediate: true }
);

function handleSave() {
  if (!form.value.name?.trim()) {
    return ElMessage.warning('请输入新方案名称');
  }
  if (form.value.applyFromYear == null) {
    return ElMessage.warning('请填写起始入学年份');
  }
  emit('save', {
    name: form.value.name.trim(),
    version: form.value.version,
    applyFromYear: form.value.applyFromYear,
    updateSourceEndYear: form.value.updateSourceEndYear,
  });
}
</script>

<style scoped>
.form-hint {
  margin-top: var(--space-3);
  font-size: var(--font-size-body-sm);
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
</style>
