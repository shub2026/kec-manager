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
      <!-- 左侧：选择器 -->
      <div class="semester-selector">
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

        <!-- 系统标识设置 -->
        <div class="organization-section">
          <label class="field-label">系统标识（单位）</label>
          <el-input
            v-model="localForm.organization_name"
            placeholder="请输入单位名称，如：某某职业技术学院"
            size="large"
            maxlength="16"
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
const availableSemesters = computed(() => {
  const currentYear = new Date().getFullYear()
  const semesters = []
  for (let y = currentYear - 5; y <= currentYear + 3; y++) {
    semesters.push(
      { value: `${y}-${y + 1}-1`, label: `${y}-${y + 1}学年 秋季(第1学期)` },
      { value: `${y}-${y + 1}-2`, label: `${y}-${y + 1}学年 春季(第2学期)` }
    )
  }
  return semesters
})

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
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 30px;
  padding: 20px 0;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #606266;
}

.semester-select {
  width: 100%;
  max-width: 320px; /* 约16个字符宽度 */
}

.semester-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: #909399;
}

.organization-section {
  margin-top: 20px;
}

.organization-input {
  width: 100%;
  max-width: 320px; /* 约16个字符宽度 */
}

.semester-preview {
  position: relative;
  padding: 20px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e7ed 100%);
  border-radius: 8px;
  text-align: center;
}

.preview-badge {
  position: absolute;
  top: -10px;
  right: 20px;
  padding: 4px 12px;
  background: #409eff;
  color: white;
  border-radius: 12px;
  font-size: 12px;
}

.preview-year {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.preview-detail {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}

.preview-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px dashed #dcdfe6;
  color: #e6a23c;
  font-size: 13px;
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
  color: #909399;
}

.semester-actions {
  display: flex;
  justify-content: flex-end;
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
</style>
