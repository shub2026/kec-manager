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
    <template #reference><span style="display: none"></span></template>
    <template #default>
      <div v-if="editingSemester" class="popover-content">
        <div class="popover-title">
          {{ editingCourse?.courseName }} — 第{{ editingSemester.semester }}学期
        </div>

        <el-form label-width="100px" size="small">
          <el-form-item label="周课时">
            <el-radio-group
              :model-value="editingSemester?.weeklyHours"
              class="full-width"
              @update:model-value="
                $emit('update-editing-semester', { ...editingSemester, weeklyHours: $event })
              "
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
              filterable
              clearable
              placeholder="选择教材（可选）"
              class="full-width"
              :disabled="editingSemester?.weeklyHours === 0"
              @update:model-value="$emit('update-editing-textbook-id', $event)"
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
          <el-button size="small" type="primary" :loading="saving" @click="$emit('save-edit')">
            保存
          </el-button>
        </div>
      </div>
    </template>
  </el-popover>

  <!-- 开课学期设置对话框 -->
  <el-dialog
    :model-value="semesterDialogVisible"
    title="设置开课学期"
    width="var(--dialog-width)"
    @update:model-value="$emit('update-semester-dialog-visible', $event)"
  >
    <el-form label-width="100px">
      <el-alert
        :title="`课程：${editingCourseForSemester?.courseName || ''}`"
        type="info"
        :closable="false"
        show-icon
        class="semester-alert"
      />
      <el-form-item label="起始学期" required>
        <el-input-number
          :model-value="semesterForm?.startSemester"
          :min="1"
          :max="12"
          class="full-width"
          @update:model-value="
            $emit('update-semester-form', { ...semesterForm, startSemester: $event })
          "
        />
      </el-form-item>
      <el-form-item label="结束学期" required>
        <el-input-number
          :model-value="semesterForm?.endSemester"
          :min="1"
          :max="12"
          class="full-width"
          @update:model-value="
            $emit('update-semester-form', { ...semesterForm, endSemester: $event })
          "
        />
      </el-form-item>
      <el-alert
        title="提示：修改后将自动创建或删除对应的学期记录"
        type="warning"
        :closable="false"
        show-icon
      />
    </el-form>
    <template #footer>
      <el-button @click="$emit('close-semester')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="$emit('save-semester')"> 保存 </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
// TODO: L-7 - 当前组件有 8 个 emit，建议重构为 v-model + 事件对象模式减少 prop-drilling
const props = defineProps({
  popoverVisible: { type: Boolean, default: false },
  semesterDialogVisible: { type: Boolean, default: false },
  editingCourse: { type: Object, default: null },
  editingSemester: { type: Object, default: null },
  editingCourseForSemester: { type: Object, default: null },
  semesterForm: {
    type: Object,
    default: () => ({ startSemester: 1, endSemester: 2 }),
  },
  editingTextbookId: { type: Number, default: null },
  saving: { type: Boolean, default: false },
  allTextbooks: { type: Array, default: () => [] },
});

defineEmits([
  'close-popover',
  'save-edit',
  'close-semester',
  'save-semester',
  'update-editing-semester',
  'update-editing-textbook-id',
  'update-semester-dialog-visible',
  'update-semester-form',
]);
</script>

<style scoped>
/* Popover */
.popover-content {
  padding: var(--space-1) 0;
}

.popover-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-light);
}

.popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-light);
}

.textbook-disabled-tip {
  font-size: 12px;
  color: var(--brand-danger-text);
  margin-top: var(--space-1);
}

.full-width {
  width: 100%;
}

:deep(.el-input-number.full-width) {
  width: 100%;
}
.semester-alert {
  margin-bottom: var(--space-4);
}
</style>
