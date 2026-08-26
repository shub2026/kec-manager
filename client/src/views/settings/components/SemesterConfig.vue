<template>
  <el-card class="semester-card">
    <template #header>
      <SettingsCardHeader dot="blue" tag="常规设置" tag-type="info">学期配置</SettingsCardHeader>
    </template>

    <div class="semester-body">
      <!-- 左侧：配置模块 -->
      <div class="config-module">
        <!-- 学期选择 -->
        <div class="config-item">
          <label class="field-label">选择当前学期</label>
          <el-select
            v-model="localForm.currentSemester"
            placeholder="请选择当前学期"
            size="large"
            filterable
            class="semester-select"
            @change="handleSemesterChange"
          >
            <el-option
              v-for="sem in availableSemesters"
              :key="sem.value"
              :label="sem.label"
              :value="sem.value"
            >
              <div class="semester-option">
                <span class="option-year">{{ sem.label.split('学年')[0] }}学年</span>
                <el-tag
                  size="small"
                  :type="sem.value.includes('-1') ? 'warning' : 'success'"
                  effect="plain"
                  disable-transitions
                >
                  {{ sem.value.includes('-1') ? '秋季' : '春季' }}
                </el-tag>
              </div>
            </el-option>
          </el-select>
          <div class="semester-hint">
            <el-icon><InfoFilled /></el-icon>
            <span>用于计算班级年级、查询当前学期开课情况。建议每学期初更新。</span>
          </div>
        </div>

        <!-- 系统标识设置 -->
        <div class="config-item organization-item">
          <label class="field-label">系统标识（单位）</label>
          <el-input
            v-model="localForm.organizationName"
            placeholder="请输入单位名称，如：某某职业技术学院"
            size="large"
            maxlength="14"
            show-word-limit
            clearable
            class="organization-input"
          />
          <div class="semester-hint">
            <el-icon><InfoFilled /></el-icon>
            <span>用于首页登录框上方展示。默认为"欢迎回来"，填写后将显示此内容。</span>
          </div>
        </div>
      </div>

      <!-- 右侧：学期预览 -->
      <div v-if="currentSemesterPreview" class="semester-preview">
        <div class="preview-badge">当前设置</div>
        <div class="preview-main">
          <div class="preview-year">{{ currentSemesterPreview.yearRange }}</div>
          <div class="preview-detail">
            <el-tag
              :type="currentSemesterPreview.season === '秋季' ? 'warning' : 'success'"
              effect="dark"
              size="large"
              round
              disable-transitions
            >
              {{ currentSemesterPreview.season }}
            </el-tag>
            <span class="preview-semester-index">第{{ currentSemesterPreview.index }}学期</span>
          </div>
        </div>
        <div v-if="!isCurrentSemesterSaved" class="preview-footer">
          <el-icon><Warning /></el-icon>
          <span>未生效</span>
        </div>
        <div v-else class="preview-footer saved">
          <el-icon><CircleCheck /></el-icon>
          <span>已生效</span>
        </div>
      </div>
      <div v-else class="semester-preview empty">
        <el-icon :size="48"><Calendar /></el-icon>
        <p>请选择学期后查看预览</p>
      </div>
    </div>

    <div class="semester-actions">
      <el-button
        type="primary"
        size="large"
        :loading="saving"
        :disabled="!isDirty"
        @click="handleSave"
      >
        <el-icon><Check /></el-icon>
        保存设置
      </el-button>
    </div>
  </el-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useSemesters } from '../../../composables/useSemesters';
import SettingsCardHeader from './SettingsCardHeader.vue';

const props = defineProps({
  form: {
    type: Object,
    required: true,
  },
  saving: {
    type: Boolean,
    default: false,
  },
  selectedSemester: {
    type: String,
    default: '',
  },
  savedSemester: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:form', 'update:selectedSemester', 'save']);

// 本地表单副本
const localForm = computed({
  get: () => props.form,
  set: (val) => emit('update:form', val),
});

// 生成可选学期列表
const { availableSemesters } = useSemesters({ rangeBefore: 5 });

// 学期预览
const currentSemesterPreview = computed(() => {
  if (!localForm.value.currentSemester) return null;
  const parts = localForm.value.currentSemester.split('-');
  const season = parts[2] === '1' ? '秋季' : '春季';
  return {
    yearRange: `${parts[0]} - ${parts[1]} 学年`,
    season,
    index: parts[2],
  };
});

const isCurrentSemesterSaved = computed(() => {
  return props.selectedSemester !== '' && props.selectedSemester === props.savedSemester;
});

function handleSemesterChange(value) {
  emit('update:selectedSemester', value);
}

// L-9: 脏状态追踪 - 避免无变更时重复提交
const isDirty = ref(false);
const _lastSavedSnapshot = ref({
  currentSemester: props.form.currentSemester || '',
  organizationName: props.form.organizationName || '',
  selectedSemester: props.selectedSemester || '',
});

watch(
  () => [localForm.value.currentSemester, localForm.value.organizationName, props.selectedSemester],
  () => {
    const s = _lastSavedSnapshot.value;
    isDirty.value =
      localForm.value.currentSemester !== s.currentSemester ||
      localForm.value.organizationName !== s.organizationName ||
      props.selectedSemester !== s.selectedSemester;
  }
);

// 当父组件确认保存后（savedSemester 更新），重置脏状态快照
watch(
  () => props.savedSemester,
  (newVal) => {
    _lastSavedSnapshot.value = {
      currentSemester: localForm.value.currentSemester || '',
      organizationName: localForm.value.organizationName || '',
      selectedSemester: newVal || '',
    };
    isDirty.value = false;
  }
);

function handleSave() {
  if (!isDirty.value) return;
  emit('save');
}
</script>

<style scoped>
.semester-card {
  /* 卡片在 tab-pane 内，无需底部间距 */
}

.semester-body {
  display: flex;
  flex-wrap: wrap;
  /* 注意：令牌只定义到 --space-7，之前的 --space-8 未定义导致 gap 失效为 0，
     预览卡换行后紧贴提示文字、-12px 外扩的"当前设置"徽标直接压到文案；
     48px 行间距扣除徽标外扩后仍有 36px 净呼吸空间 */
  gap: var(--space-7);
  padding: var(--space-6) 0 var(--space-4);
  align-items: flex-start;
}

/* 左侧配置模块 */
.config-module {
  flex: 1 1 480px;
  max-width: 640px;
}

.config-item {
  margin-bottom: var(--space-7);
}

.config-item:last-child {
  margin-bottom: 0;
}

.organization-item {
  margin-top: 0;
}

.field-label {
  display: block;
  margin-bottom: var(--space-3);
  font-weight: 500;
  font-size: var(--font-size-body);
  color: var(--text-regular);
  letter-spacing: 0.01em;
}

/* 学期下拉与系统标识输入框统一等宽；520px 对选项文本而言过长，收窄后更紧凑美观 */
.semester-select,
.organization-input {
  width: 100%;
  max-width: 360px;
}

.semester-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-3);
  font-size: var(--font-size-body-sm);
  color: var(--text-secondary);
  line-height: 1.6;
}

/* 右侧：学期预览（可成长：宽屏并排时分摊剩余空间，中屏换行后撑满整行，均受 max-width 封顶） */
.semester-preview {
  flex: 1 1 300px;
  min-width: 300px;
  max-width: 440px;
  height: auto;
  position: relative;
  padding: 32px var(--space-6);
  background: var(--bg-subtle);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  text-align: center;
  transition:
    box-shadow var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.semester-preview:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.preview-badge {
  position: absolute;
  top: -12px;
  right: var(--space-5);
  padding: var(--space-1) var(--space-3);
  background: var(--brand-primary);
  color: var(--bg-card);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-caption);
  font-weight: 500;
}

.preview-year {
  font-size: var(--font-size-display);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: var(--space-5);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.preview-detail {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-3);
}

.preview-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-6);
  padding-top: var(--space-5);
  border-top: 1px solid var(--border-light);
  color: var(--text-regular);
  font-size: var(--font-size-body);
  font-weight: 500;
}

.preview-footer.saved {
  color: var(--brand-success-text);
}

.semester-preview.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  height: auto;
  padding: var(--space-4) var(--space-5);
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  border: 1px dashed var(--border-base);
}

.semester-preview.empty :deep(.el-icon) {
  color: var(--text-placeholder);
  margin-bottom: var(--space-3);
}

.semester-preview.empty p {
  font-size: var(--font-size-body);
  margin: 0;
}

.semester-actions {
  display: flex;
  justify-content: flex-start;
  padding-top: var(--space-5);
  border-top: 1px solid var(--border-light);
}

.semester-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.option-year {
  font-size: var(--font-size-body);
}

/* 响应式布局 */
@media (max-width: 768px) {
  .semester-body {
    flex-direction: column;
    /* 窄屏下收紧垂直节奏，32px 扣除徽标外扩后仍留 20px 间距 */
    gap: var(--space-6);
  }

  .config-module,
  .semester-preview {
    width: 100%;
    max-width: 100%;
  }

  .config-module {
    min-width: auto;
  }

  /* 移动端预览卡提前到配置项上方，先展示当前生效状态再进行配置 */
  .semester-preview {
    order: -1;
    /* 列布局下主轴变为垂直，宽屏的 flex-basis 300px 会变成基准高度撑高卡片，
       重置为按内容自然高度 */
    flex: 0 0 auto;
    min-width: auto;
    /* 预览卡成为首个元素后，预留 -12px 外扩徽标的空间，避免被卡头裁切 */
    margin-top: var(--space-3);
  }
}
</style>
