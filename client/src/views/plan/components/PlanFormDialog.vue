<template>
  <el-dialog
    :model-value="visible"
    :title="form.id ? '编辑方案' : '新增方案'"
    width="var(--dialog-width-lg)"
    :fullscreen="isMobile"
    destroy-on-close
    @update:model-value="$emit('update:visible', $event)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="方案名称" prop="name" required>
        <el-input v-model="form.name" placeholder="如：2024级学前教育培养方案" maxlength="200" />
      </el-form-item>

      <el-form-item label="使用部门">
        <el-select
          v-model="form.collegeId"
          placeholder="请选择使用部门（可选）"
          class="full-width"
          clearable
        >
          <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </el-form-item>

      <el-form-item label="关联方式" required>
        <div class="relation-mode-wrapper">
          <el-radio-group
            v-model="relationMode"
            class="relation-mode-group"
            @change="handleModeChange"
          >
            <el-radio value="major">按专业</el-radio>
            <el-radio value="trainingLevel">按层次</el-radio>
          </el-radio-group>
          <div class="form-hint">
            <span v-if="relationMode === 'major'"
              >该方案关联特定专业，适用于同一专业的培养方案</span
            >
            <span v-else-if="relationMode === 'trainingLevel'"
              >该方案关联特定培养层次，适用于跨专业的统一方案</span
            >
          </div>
        </div>
      </el-form-item>

      <el-form-item label="关联数据" required>
        <el-select
          v-if="relationMode === 'major'"
          v-model="form.majorId"
          placeholder="请选择专业类别"
          class="full-width"
        >
          <el-option v-for="m in majors" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
        <el-select
          v-else
          v-model="form.trainingLevelId"
          placeholder="请选择培养层次"
          class="full-width"
        >
          <el-option
            v-for="level in trainingLevels"
            :key="level.id"
            :label="level.name"
            :value="level.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="状态">
        <el-radio-group v-model="form.status">
          <el-radio value="draft">草稿</el-radio>
          <el-radio value="active">生效</el-radio>
          <el-radio value="archived">归档</el-radio>
        </el-radio-group>
        <div class="form-hint">
          归档后方案保留数据，但不再参与排课、开课与教材推导；草稿和生效均正常参与匹配
        </div>
      </el-form-item>
      <el-form-item label="版本">
        <el-input v-model="form.version" placeholder="如：v1.0" />
      </el-form-item>
      <el-form-item label="适用入学年份">
        <div class="apply-year-row">
          <el-input-number
            v-model="form.applyFromYear"
            :min="2000"
            :max="2100"
            :controls="false"
            placeholder="起始（不限）"
            class="apply-year-input"
          />
          <span class="apply-year-sep">~</span>
          <el-input-number
            v-model="form.applyToYear"
            :min="2000"
            :max="2100"
            :controls="false"
            placeholder="截止（不限）"
            class="apply-year-input"
          />
        </div>
        <div class="form-hint">
          按班级入学年份区分方案版本，留空表示不限。如 V1.0 填 2025~2025，V2.0 填 2026~留空
        </div>
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="form.description" type="textarea" />
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

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 编辑时传入方案行；新增传 null */
  plan: { type: Object, default: null },
  colleges: { type: Array, default: () => [] },
  majors: { type: Array, default: () => [] },
  trainingLevels: { type: Array, default: () => [] },
  saving: { type: Boolean, default: false },
});

const emit = defineEmits(['update:visible', 'save']);

const { isMobile } = useResponsive();

const emptyForm = () => ({
  id: null,
  name: '',
  collegeId: null,
  majorId: null,
  trainingLevelId: null,
  status: 'draft',
  version: '',
  applyFromYear: null,
  applyToYear: null,
  description: '',
});

const form = ref(emptyForm());
const relationMode = ref('major'); // 'major' 或 'trainingLevel'

// 表单引用与校验规则
const formRef = ref(null);
const rules = {
  name: [
    { required: true, message: '请输入方案名称', trigger: 'blur' },
    { min: 2, max: 200, message: '名称长度应在 2-200 个字符之间', trigger: 'blur' },
  ],
};

// 弹窗打开时按传入方案初始化表单与关联模式
// immediate 兼容直接以 visible=true 挂载的场景（如测试环境）
watch(
  () => props.visible,
  (v) => {
    if (!v) return;
    const row = props.plan;
    if (row) {
      form.value = {
        ...row,
        collegeId: row.collegeId || null,
        trainingLevelId: row.trainingLevelId || null,
        // 后端始终返回 status；兜底防止旧数据缺省
        status: row.status || 'draft',
      };
      // 根据已有数据确定关联模式（优先判断层次）
      relationMode.value = row.trainingLevelId ? 'trainingLevel' : 'major';
    } else {
      form.value = emptyForm();
      relationMode.value = 'major';
    }
  },
  { immediate: true }
);

function handleModeChange(mode) {
  if (mode === 'major') {
    // 按专业模式：清空层次
    form.value.trainingLevelId = null;
  } else {
    // 按层次模式：清空专业
    form.value.majorId = null;
  }
}

async function handleSave() {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  // 根据关联模式验证必填项
  if (relationMode.value === 'major' && !form.value.majorId) {
    return ElMessage.warning('请选择专业类别');
  }
  if (relationMode.value === 'trainingLevel' && !form.value.trainingLevelId) {
    return ElMessage.warning('请选择培养层次');
  }

  // 适用入学年份区间合法性校验（与后端 validateApplyYearRange 同口径）
  if (
    form.value.applyFromYear != null &&
    form.value.applyToYear != null &&
    form.value.applyFromYear > form.value.applyToYear
  ) {
    return ElMessage.warning('适用入学年份起始不能大于截止');
  }

  emit('save', {
    name: form.value.name,
    collegeId: form.value.collegeId || null,
    majorId: form.value.majorId || null,
    trainingLevelId: form.value.trainingLevelId || null,
    status: form.value.status || 'draft',
    version: form.value.version,
    applyFromYear: form.value.applyFromYear ?? null,
    applyToYear: form.value.applyToYear ?? null,
    description: form.value.description,
  });
}
</script>

<style scoped>
.relation-mode-wrapper {
  display: flex;
  flex-direction: column;
}

.relation-mode-group {
  display: flex;
  gap: var(--space-4);
}

.form-hint {
  margin-top: var(--space-3);
  font-size: var(--font-size-body-sm);
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.apply-year-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.apply-year-input {
  width: 130px;
}

.apply-year-sep {
  color: var(--text-secondary);
}
</style>
