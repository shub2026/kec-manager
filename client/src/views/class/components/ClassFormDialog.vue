<template>
  <div>
    <!-- 编辑/新增对话框 -->
    <el-dialog
      v-model="visible"
      :title="form.id ? '编辑班级' : '新增班级'"
      width="min(800px, 92vw)"
      :fullscreen="isMobile"
      destroy-on-close
      @close="$emit('close')"
    >
      <el-form ref="formRef" :model="localForm" :rules="rules" label-width="100px">
        <el-row :gutter="20">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="班级名称" prop="name" required>
              <el-input v-model="localForm.name" placeholder="如：2024级学前1班" />
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="专业类别">
              <el-select
                v-model="localForm.majorId"
                clearable
                placeholder="请选择"
                class="full-width"
              >
                <el-option v-for="m in majors" :key="m.id" :label="m.name" :value="m.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="二级学院">
              <el-select
                v-model="localForm.collegeId"
                clearable
                placeholder="请选择"
                class="full-width"
              >
                <el-option
                  v-for="college in colleges"
                  :key="college.id"
                  :label="college.name"
                  :value="college.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="培养层次" required>
              <el-select
                v-model="localForm.trainingLevelId"
                placeholder="请选择"
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
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="8" :xs="24" :sm="8">
            <el-form-item label="入学年份" prop="enrollmentYear" required>
              <el-input-number
                v-model="localForm.enrollmentYear"
                :min="2000"
                :max="2099"
                class="full-width"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8" :xs="24" :sm="8">
            <el-form-item label="学制(年)" prop="durationYears" required>
              <el-input-number
                v-model="localForm.durationYears"
                :min="1"
                :max="6"
                class="full-width"
              />
            </el-form-item>
          </el-col>
          <el-col :span="8" :xs="24" :sm="8">
            <el-form-item label="班级人数" prop="studentCount">
              <el-input-number v-model="localForm.studentCount" :min="0" class="full-width" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="特殊状态离校">
              <el-switch v-model="localForm.isLeftSchool" />
              <div class="form-hint">
                开启后班级状态固定显示"离校"，关闭则由系统自动推算在读/已毕业
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12" :xs="24" :sm="12">
            <el-form-item label="特殊培养方案">
              <el-select
                v-model="localForm.customPlanId"
                clearable
                placeholder="默认使用专业方案"
                class="full-width"
              >
                <el-option v-for="p in plans" :key="p.id" :label="p.name" :value="p.id" />
              </el-select>
              <div class="form-hint">最高优先级：一旦设置，将覆盖按层次或专业的默认关联</div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量设置对话框 -->
    <el-dialog
      v-model="batchVisible"
      :title="batchDialogTitle"
      width="min(500px, 90vw)"
      destroy-on-close
      @close="$emit('batch-close')"
    >
      <el-form label-width="120px">
        <el-form-item v-if="batchFormType === 'major'" label="专业类别">
          <el-select v-model="batchForm.majorId" placeholder="请选择专业" class="full-width">
            <el-option v-for="m in majors" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-else-if="batchFormType === 'college'" label="二级学院">
          <el-select
            v-model="batchForm.collegeId"
            clearable
            placeholder="请选择学院"
            class="full-width"
          >
            <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-else-if="batchFormType === 'level'" label="培养层次">
          <el-select
            v-model="batchForm.trainingLevelId"
            clearable
            placeholder="请选择层次"
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
        <el-form-item v-else-if="batchFormType === 'year'" label="入学年份">
          <el-input-number
            v-model="batchForm.enrollmentYear"
            :min="2000"
            :max="2099"
            class="full-width"
          />
        </el-form-item>
        <el-form-item v-else-if="batchFormType === 'duration'" label="学制(年)">
          <el-input-number v-model="batchForm.durationYears" :min="1" :max="6" class="full-width" />
        </el-form-item>
        <el-form-item v-else-if="batchFormType === 'leftSchool'" label="离校状态">
          <el-select v-model="batchForm.isLeftSchool" class="full-width">
            <el-option label="是（标记为离校）" :value="true" />
            <el-option label="否（恢复正常状态）" :value="false" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="$emit('batch-save')">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useResponsive } from '../../../composables/useResponsive';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  batchVisible: {
    type: Boolean,
    default: false,
  },
  form: {
    type: Object,
    required: true,
  },
  batchForm: {
    type: Object,
    required: true,
  },
  batchFormType: {
    type: String,
    default: '',
  },
  batchDialogTitle: {
    type: String,
    default: '批量设置',
  },
  saving: {
    type: Boolean,
    default: false,
  },
  majors: {
    type: Array,
    default: () => [],
  },
  colleges: {
    type: Array,
    default: () => [],
  },
  trainingLevels: {
    type: Array,
    default: () => [],
  },
  plans: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  'update:visible',
  'update:batchVisible',
  'update:form',
  'update:batchForm',
  'save',
  'batch-save',
  'close',
  'batch-close',
]);

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
});

const batchVisible = computed({
  get: () => props.batchVisible,
  set: (val) => emit('update:batchVisible', val),
});

const localForm = computed({
  get: () => props.form,
  set: (val) => emit('update:form', val),
});

const batchForm = computed({
  get: () => props.batchForm,
  set: (val) => emit('update:batchForm', val),
});

const formRef = ref(null);
const rules = {
  name: [{ required: true, message: '请输入班级名称', trigger: 'blur' }],
  enrollmentYear: [
    { required: true, message: '请输入入学年份', trigger: 'blur' },
    { type: 'number', message: '入学年份必须为数字', trigger: 'blur' },
  ],
  durationYears: [
    { required: true, message: '请输入学制', trigger: 'blur' },
    {
      validator: (rule, value, cb) =>
        value != null && value > 0 ? cb() : cb(new Error('学制必须大于 0')),
      trigger: 'blur',
    },
  ],
  studentCount: [
    { required: true, message: '请输入班级人数', trigger: 'blur' },
    {
      validator: (rule, value, cb) =>
        value != null && value >= 0 ? cb() : cb(new Error('班级人数不能为负数')),
      trigger: 'blur',
    },
  ],
};

// 小屏弹窗全屏：复用共享响应式断点（由 useResponsive 统一管理 resize 监听）
const { isMobile } = useResponsive();

async function handleSave() {
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  emit('save');
}
</script>

<style scoped>
.full-width {
  width: 100%;
}

.form-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
