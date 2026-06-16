<template>
  <!-- Popover 编辑卡片 -->
  <el-popover
    ref="editPopover"
    :visible="popoverVisible"
    placement="bottom"
    :width="360"
    trigger="click"
    :teleported="true"
  >
    <template #default>
      <div class="popover-content" v-if="editingSemester">
        <div class="popover-title">
          {{ editingCourse?.courseName }} — 第{{ editingSemester.semester }}学期
        </div>

        <el-form label-width="80px" size="small">
          <el-form-item label="周课时">
            <el-radio-group 
              :model-value="editingSemester?.weeklyHours"
              @update:model-value="$emit('update-editing-semester', { ...editingSemester, weeklyHours: $event })"
              class="full-width"
            >
              <el-radio-button :value="0">0</el-radio-button>
              <el-radio-button :value="2">2</el-radio-button>
              <el-radio-button :value="4">4</el-radio-button>
              <el-radio-button :value="6">6</el-radio-button>
              <el-radio-button :value="8">8</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="关联教材">
            <el-select
              :model-value="editingTextbookId"
              @update:model-value="$emit('update-editing-textbook-id', $event)"
              filterable
              clearable
              placeholder="选择教材（可选）"
              class="full-width"
              :disabled="editingSemester?.weeklyHours === 0"
            >
              <el-option
                v-for="t in allTextbooks"
                :key="t.id"
                :label="`${t.title} (${t.publisher || ''})`"
                :value="t.id"
              />
            </el-select>
            <div v-if="editingSemester?.weeklyHours === 0" class="textbook-disabled-tip">
              周课时为0时不可选择教材
            </div>
          </el-form-item>
        </el-form>

        <div class="popover-actions">
          <el-button size="small" @click="$emit('close-popover')">取消</el-button>
          <el-button size="small" type="primary" @click="$emit('save-edit')" :loading="saving">
            保存
          </el-button>
        </div>
      </div>
    </template>
  </el-popover>

  <!-- 开课学期设置对话框 -->
  <el-dialog 
    :model-value="semesterDialogVisible"
    @update:model-value="$emit('update-semester-dialog-visible', $event)"
    title="设置开课学期" 
    width="450px"
  >
    <el-form label-width="100px">
      <el-alert
        :title="`课程：${editingCourseForSemester?.courseName || ''}`"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      />
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="起始学期" required>
            <el-input-number
              :model-value="semesterForm?.startSemester"
              @update:model-value="$emit('update-semester-form', { ...semesterForm, startSemester: $event })"
              :min="1"
              :max="12"
              class="full-width"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="结束学期" required>
            <el-input-number
              :model-value="semesterForm?.endSemester"
              @update:model-value="$emit('update-semester-form', { ...semesterForm, endSemester: $event })"
              :min="1"
              :max="12"
              class="full-width"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-alert
        title="提示：修改后将自动创建或删除对应的学期记录"
        type="warning"
        :closable="false"
        show-icon
      />
    </el-form>
    <template #footer>
      <el-button @click="$emit('close-semester')">取消</el-button>
      <el-button type="primary" @click="$emit('save-semester')" :loading="saving">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
const props = defineProps({
  popoverVisible: { type: Boolean, default: false },
  semesterDialogVisible: { type: Boolean, default: false },
  editingCourse: { type: Object, default: null },
  editingSemester: { type: Object, default: null },
  editingCourseForSemester: { type: Object, default: null },
  semesterForm: { 
    type: Object, 
    default: () => ({ startSemester: 1, endSemester: 2 }) 
  },
  editingTextbookId: { type: [Number, null], default: null },
  saving: { type: Boolean, default: false },
  allTextbooks: { type: Array, default: () => [] },
})

defineEmits([
  'close-popover', 
  'save-edit', 
  'close-semester', 
  'save-semester',
  'update-editing-semester',
  'update-editing-textbook-id',
  'update-semester-dialog-visible',
  'update-semester-form',
])
</script>

<style scoped>
/* Popover */
.popover-content {
  padding: 4px 0;
}

.popover-title {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e4e7ed;
}

.popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #e4e7ed;
}

.textbook-disabled-tip {
  font-size: 12px;
  color: #f56c6c;
  margin-top: 4px;
}

.full-width {
  width: 100%;
}
</style>
