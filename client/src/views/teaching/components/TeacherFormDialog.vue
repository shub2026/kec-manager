<template>
  <el-dialog
    v-model="visible"
    :title="form.id ? '编辑教师' : '新增教师'"
    width="var(--dialog-width-lg)"
    :fullscreen="isMobile"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-row :gutter="16">
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="姓名" prop="name" required>
            <el-input v-model="form.name" placeholder="请输入姓名" maxlength="50" />
          </el-form-item>
        </el-col>
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="性别">
            <el-select v-model="form.gender" placeholder="请选择" clearable style="width: 100%">
              <el-option label="男" value="male" />
              <el-option label="女" value="female" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="出生年月">
            <el-date-picker
              v-model="form.birthDate"
              type="month"
              placeholder="选择年月"
              value-format="YYYY-MM"
              :clearable="true"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="归属学院">
            <el-select
              v-model="form.affiliatedCollegeId"
              placeholder="选择归属学院"
              clearable
              filterable
              style="width: 100%"
            >
              <el-option v-for="c in allColleges" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="8" :xs="24" :sm="12">
          <el-form-item label="人员类别">
            <el-select v-model="form.personnelType" placeholder="请选择" style="width: 100%">
              <el-option label="专职" value="full_time" />
              <el-option label="兼职" value="part_time" />
              <el-option label="外聘" value="external" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8" :xs="24" :sm="12">
          <el-form-item label="状态">
            <el-select v-model="form.status" style="width: 100%">
              <el-option label="启用" value="active" />
              <el-option label="禁用" value="disabled" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="学科（课程）">
        <el-select
          v-model="form.courseIds"
          multiple
          filterable
          placeholder="选择可教授的课程"
          class="field-limited"
        >
          <el-option v-for="c in allCourses" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="意向学院">
        <el-select
          v-model="form.collegeIds"
          multiple
          filterable
          placeholder="选择优先指定学院"
          class="field-limited"
        >
          <el-option v-for="c in availableColleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="意向层次">
        <el-select
          v-model="form.trainingLevelIds"
          multiple
          filterable
          placeholder="选择优先指定层次"
          class="field-limited"
        >
          <el-option
            v-for="l in availableTrainingLevels"
            :key="l.id"
            :label="l.name"
            :value="l.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="自定义课时">
        <el-input-number
          v-model="form.defaultWeeklyHours"
          :min="0"
          :max="40"
          :step="1"
          placeholder="不填使用课时要求"
          controls-position="right"
          class="hours-input"
        />
      </el-form-item>
      <el-form-item label="只带一本教材">
        <el-switch v-model="form.singleTextbookOnly" />
        <span class="switch-hint">开启后该教师本学期最多只能持有一本教材</span>
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          placeholder="请输入备注信息"
          clearable
          maxlength="100"
          class="field-limited"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useResponsive } from '@/composables/useResponsive';

const props = defineProps({
  allCourses: {
    type: Array,
    default: () => [],
  },
  allColleges: {
    type: Array,
    default: () => [],
  },
  allTrainingLevels: {
    type: Array,
    default: () => [],
  },
  collegeLevelMapping: {
    type: Object,
    default: () => ({ collegeToLevels: {}, levelToColleges: {} }),
  },
  saving: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['save']);

// 小屏弹窗全屏：复用共享响应式断点
const { isMobile } = useResponsive();

const visible = ref(false);
const formRef = ref(null);
const rules = {
  name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { min: 2, max: 50, message: '姓名长度应在 2-50 个字符之间', trigger: 'blur' },
  ],
};

const defaultForm = {
  id: null,
  name: '',
  gender: null,
  birthDate: null,
  personnelType: 'full_time',
  remark: null,
  affiliatedCollegeId: null,
  defaultWeeklyHours: null,
  singleTextbookOnly: false,
  status: 'active',
  courseIds: [],
  collegeIds: [],
  trainingLevelIds: [],
};
const form = ref({ ...defaultForm });

// 意向学院/意向层次双向联动筛选
const availableColleges = computed(() => {
  const selectedLevelIds = form.value.trainingLevelIds || [];
  if (!selectedLevelIds.length) return props.allColleges;
  const mapping = props.collegeLevelMapping.levelToColleges;
  const allowedIds = new Set();
  for (const lid of selectedLevelIds) {
    const cids = mapping[lid] || [];
    cids.forEach((id) => allowedIds.add(id));
  }
  return props.allColleges.filter((c) => allowedIds.has(c.id));
});

const availableTrainingLevels = computed(() => {
  const selectedCollegeIds = form.value.collegeIds || [];
  if (!selectedCollegeIds.length) return props.allTrainingLevels;
  const mapping = props.collegeLevelMapping.collegeToLevels;
  const allowedIds = new Set();
  for (const cid of selectedCollegeIds) {
    const lids = mapping[cid] || [];
    lids.forEach((id) => allowedIds.add(id));
  }
  return props.allTrainingLevels.filter((l) => allowedIds.has(l.id));
});

function open(row) {
  if (row) {
    form.value = {
      ...row,
      birthDate: row.birthDate ? String(row.birthDate).substring(0, 7) : null,
      singleTextbookOnly: !!row.singleTextbookOnly,
      affiliatedCollegeId: row.affiliatedCollege?.id || null,
      courseIds: row.courseList?.map((c) => c.id) || [],
      collegeIds: row.collegeList?.map((c) => c.id) || [],
      trainingLevelIds: row.trainingLevelList?.map((l) => l.id) || [],
    };
  } else {
    form.value = { ...defaultForm };
  }
  visible.value = true;
}

function close() {
  visible.value = false;
}

async function handleSave() {
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  emit('save', {
    id: form.value.id,
    data: {
      name: form.value.name,
      gender: form.value.gender,
      birthDate: form.value.birthDate,
      personnelType: form.value.personnelType,
      remark: form.value.remark,
      affiliatedCollegeId: form.value.affiliatedCollegeId,
      defaultWeeklyHours: form.value.defaultWeeklyHours,
      singleTextbookOnly: !!form.value.singleTextbookOnly,
      status: form.value.status || 'active',
      courseIds: form.value.courseIds,
      collegeIds: form.value.collegeIds,
      trainingLevelIds: form.value.trainingLevelIds,
    },
  });
}

defineExpose({ open, close });
</script>

<style scoped>
/* 备注与学科/意向学院/意向层次统一限宽：多选弹层与输入框同宽，
   满宽时展开会盖住右下角取消/保存按钮，收窄后弹层左对齐展开，
   右侧按钮区始终可见可点；备注输入框同宽保持纵向视觉对齐 */
.field-limited {
  width: 100%;
  max-width: 320px;
}
/* 只带一本教材开关说明文字：弱化提示，与开关同行展示 */
.switch-hint {
  margin-left: 8px;
  font-size: var(--font-size-caption);
  color: var(--el-text-color-secondary);
}
/* 自定义课时：EP 按需样式晚于全局工具类加载，.el-input-number 的 150px 会同优先级覆盖
   filter-* 档位；scoped 提升优先级并加宽到能完整显示占位提示 */
.hours-input {
  width: 240px;
}
</style>
