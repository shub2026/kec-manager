<template>
  <div class="settings-page">
    <!-- 学期配置组件 -->
    <SemesterConfig
      v-model:form="form"
      v-model:selectedSemester="selectedSemester"
      :saved-semester="savedSemester"
      :saving="saving"
      @save="handleSave"
    />

    <!-- 数据重置组件 -->
    <DataReset
      :resetting="resetting"
      @reset="showResetDialog"
    />

    <!-- 确认对话框组件 -->
    <ConfirmDialog
      v-model:dialog-visible="dialogVisible"
      v-model:simple-dialog-visible="clearAuditDialogVisible"
      v-model:save-dialog-visible="saveConfirmVisible"
      v-model:confirm-input="confirmInput"
      :reset-type="resetType"
      :resetting="resetting"
      :saving="saving"
      @confirm="handleReset"
      @confirm-simple="handleClearAuditLogs"
      @confirm-save="confirmSave"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '../../stores/settings'
import request from '../../utils/request'
import SemesterConfig from './components/SemesterConfig.vue'
import DataReset from './components/DataReset.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const settingsStore = useSettingsStore()
const saving = ref(false)
const resetting = ref(false)
const form = ref({
  current_semester: '',
  organization_name: '',
})

// 跟踪当前选中的学期和已保存的学期
const selectedSemester = ref('')
const savedSemester = ref('')

// 对话框状态
const dialogVisible = ref(false)
const resetType = ref('')
const confirmInput = ref('')
const clearAuditDialogVisible = ref(false)
const saveConfirmVisible = ref(false)

async function load() {
  await settingsStore.load()
  const s = settingsStore.settings
  const semesterValue = s.currentSemester?.value || ''
  const orgName = s.organizationName?.value || '欢迎回来'
  form.value.current_semester = semesterValue
  form.value.organization_name = orgName
  selectedSemester.value = semesterValue
  savedSemester.value = semesterValue
}

function handleSave() {
  saveConfirmVisible.value = true
}

async function confirmSave() {
  saving.value = true
  try {
    await settingsStore.save(form.value)
    savedSemester.value = form.value.current_semester
    ElMessage.success('学期设置已保存')
    saveConfirmVisible.value = false
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

function showResetDialog(type) {
  if (type === 'audit-logs') {
    clearAuditDialogVisible.value = true
    return
  }
  
  resetType.value = type
  confirmInput.value = ''
  dialogVisible.value = true
}

async function handleReset() {
  const expectedTextMap = {
    teachers: '确认',
    majors: '确认',
    colleges: '确认',
    levels: '确认',
    courses: '确认',
    textbooks: '确认',
    classes: '确认',
    plans: '确认',
    settings: '系统重置',
  }
  
  if (confirmInput.value !== expectedTextMap[resetType.value]) {
    ElMessage.error('确认文字不正确')
    return
  }

  resetting.value = true
  try {
    const endpoints = {
      teachers: '/settings/reset/teachers',
      majors: '/settings/reset/majors',
      colleges: '/settings/reset/colleges',
      levels: '/settings/reset/levels',
      courses: '/settings/reset/courses',
      textbooks: '/settings/reset/textbooks',
      classes: '/settings/reset/classes',
      plans: '/settings/reset/plans',
      settings: '/settings/reset/settings',
    }

    await request.post(endpoints[resetType.value])
    const successMsg = expectedTextMap[resetType.value] === '确认' ? '数据已清空' : `${expectedTextMap[resetType.value]}成功`
    ElMessage.success(successMsg)
    dialogVisible.value = false

    if (resetType.value === 'settings') {
      await load()
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败')
  } finally {
    resetting.value = false
  }
}

async function handleClearAuditLogs() {
  resetting.value = true
  try {
    await request.post('/settings/reset/audit-logs')
    ElMessage.success('操作日志已清空')
    clearAuditDialogVisible.value = false
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '清空失败')
  } finally {
    resetting.value = false
  }
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.settings-page {
  padding: 20px;
}
</style>
