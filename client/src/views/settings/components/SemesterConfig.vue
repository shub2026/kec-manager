<template>
  <el-card class="semester-card" shadow="never">
    <template #header>
      <div class="card-title-row">
        <span class="card-dot dot-blue"></span>
        <span class="card-title-text">学期配置</span>
        <el-tag size="small" type="info" effect="plain">常规设置</el-tag>
      </div>
    </template>

    <div class="semester-body">
      <!-- 左侧：配置模块 -->
      <div class="config-module">
        <!-- 学期选择 -->
        <div class="config-item">
          <label class="field-label">选择当前学期</label>
          <el-select
            v-model="localForm.current_semester"
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
                <el-tag size="small" :type="sem.value.includes('-1') ? 'warning' : 'success'" effect="plain">
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
            v-model="localForm.organization_name"
            placeholder="请输入单位名称，如：某某职业技术学院"
            size="large"
            maxlength="20"
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
      <div class="semester-preview" v-if="currentSemesterPreview">
        <div class="preview-badge">当前设置</div>
        <div class="preview-main">
          <div class="preview-year">{{ currentSemesterPreview.yearRange }}</div>
          <div class="preview-detail">
            <el-tag
              :type="currentSemesterPreview.season === '秋季' ? 'warning' : 'success'"
              effect="dark"
              size="large"
              round
            >
              {{ currentSemesterPreview.season }}
            </el-tag>
            <span class="preview-semester-index">第{{ currentSemesterPreview.index }}学期</span>
          </div>
        </div>
        <div class="preview-footer" v-if="!isCurrentSemesterSaved">
          <el-icon><Warning /></el-icon>
          <span>未生效</span>
        </div>
        <div class="preview-footer saved" v-else>
          <el-icon><CircleCheck /></el-icon>
          <span>已生效</span>
        </div>
      </div>
      <div class="semester-preview empty" v-else>
        <el-icon :size="48"><Calendar /></el-icon>
        <p>请选择学期后查看预览</p>
      </div>
    </div>

    <div class="semester-actions">
      <el-button type="primary" size="large" @click="$emit('save')" :loading="saving">
        <el-icon><Check /></el-icon>
        保存设置
      </el-button>
    </div>
  </el-card>
</template>

<script setup>
import { computed } from 'vue'
import { InfoFilled, Warning, CircleCheck, Check, Calendar } from '@element-plus/icons-vue'
import { useSemesters } from '../../../composables/useSemesters'

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
})

const emit = defineEmits(['update:form', 'save'])

// 本地表单副本
const localForm = computed({
  get: () => props.form,
  set: (val) => emit('update:form', val),
})

// 生成可选学期列表
const { availableSemesters } = useSemesters({ rangeBefore: 5 })

// 学期预览
const currentSemesterPreview = computed(() => {
  if (!localForm.value.current_semester) return null
  const parts = localForm.value.current_semester.split('-')
  const season = parts[2] === '1' ? '秋季' : '春季'
  return {
    yearRange: `${parts[0]} - ${parts[1]} 学年`,
    season,
    index: parts[2],
  }
})

const isCurrentSemesterSaved = computed(() => {
  return props.selectedSemester !== '' && props.selectedSemester === props.savedSemester
})

function handleSemesterChange(value) {
  emit('update:selectedSemester', value)
}
</script>

<style scoped>
.semester-card {
  margin-bottom: 20px;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-blue {
  background-color: #409eff;
}

.card-title-text {
  font-weight: 600;
  font-size: 16px;
}

.semester-body {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding: 20px 0;
  align-items: flex-start;
}

/* 左侧配置模块 */
.config-module {
  flex: 1;
  min-width: 320px;
  max-width: 400px;
}

.config-item {
  margin-bottom: 24px;
}

.config-item:last-child {
  margin-bottom: 0;
}

.organization-item {
  margin-top: 8px;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #606266;
}

.semester-select {
  width: 100%;
  max-width: 400px; /* 与系统标识输入框保持一致 */
}

.semester-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: #909399;
}

.organization-input {
  width: 100%;
  max-width: 400px; /* 约20个字符宽度 */
}

/* 确保配置模块宽度与输入框匹配 */
.config-module {
  flex: 0 0 auto;
  min-width: 400px;
  max-width: 480px;
}

.semester-preview {
  flex: 0 0 auto;
  min-width: 280px;
  max-width: 380px;
  height: auto;
  position: relative;
  padding: 28px 24px;
  background: linear-gradient(135deg, #e8f4fd 0%, #d1ecff 100%);
  border: 2px solid #b3d9ff;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(64, 158, 255, 0.12);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.semester-preview:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(64, 158, 255, 0.2);
  border-color: #409eff;
}

.preview-badge {
  position: absolute;
  top: -12px;
  right: 24px;
  padding: 6px 16px;
  background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
  color: white;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.3);
}

.preview-year {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
  margin-bottom: 16px;
}

.preview-detail {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.preview-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #dcdfe6;
  color: #606266;
  font-size: 14px;
  font-weight: 500;
}

.preview-footer.saved {
  color: #67c23a;
}

.semester-preview.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  height: auto;
  padding: 32px 24px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e7ed 100%);
  border-radius: 12px;
  color: #909399;
  border: 2px dashed #dcdfe6;
}

.semester-preview.empty :deep(.el-icon) {
  color: #c0c4cc;
  margin-bottom: 12px;
}

.semester-preview.empty p {
  font-size: 14px;
  margin: 0;
}

.semester-actions {
  display: flex;
  justify-content: flex-start;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}

.semester-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.option-year {
  font-size: 14px;
}

/* 响应式布局 */
@media (max-width: 768px) {
  .semester-body {
    flex-direction: column;
  }

  .config-module,
  .semester-preview {
    width: 100%;
    max-width: 100%;
  }

  .config-module {
    min-width: auto;
  }
}
</style>
