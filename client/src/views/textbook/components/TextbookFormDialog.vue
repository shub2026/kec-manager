<template>
  <el-dialog
    v-model="visible"
    :title="form.id ? '编辑教材' : '新增教材'"
    :fullscreen="isMobile"
    width="var(--dialog-width-lg)"
    destroy-on-close
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-row :gutter="16">
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="书名" prop="title" required>
            <el-input v-model="form.title" maxlength="200" />
          </el-form-item>
        </el-col>
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="书号">
            <el-input v-model="form.isbn" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="出版社">
            <el-input v-model="form.publisher" />
          </el-form-item>
        </el-col>
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="版次">
            <el-input v-model="form.edition" placeholder="如：第3版" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="出版日期">
            <el-input v-model="form.publishDate" />
          </el-form-item>
        </el-col>
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="定价" prop="price">
            <el-input-number v-model="form.price" :min="0" :precision="2" style="width: 100%" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="作者">
            <el-input v-model="form.author" />
          </el-form-item>
        </el-col>
        <el-col :span="12" :xs="24" :sm="12">
          <el-form-item label="类别">
            <el-select v-model="form.category" style="width: 100%">
              <el-option label="技工" value="技工" />
              <el-option label="非技工" value="非技工" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="备注">
        <el-input v-model="form.description" type="textarea" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue';
import { useResponsive } from '@/composables/useResponsive';

defineProps({
  saving: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['save']);

// 弹窗小屏全屏：复用共享响应式断点（由 useResponsive 统一管理 resize 监听）
const { isMobile } = useResponsive();

const visible = ref(false);
const formRef = ref(null);
const rules = {
  title: [
    { required: true, message: '请输入教材名称', trigger: 'blur' },
    { min: 2, max: 200, message: '书名长度应在 2-200 个字符之间', trigger: 'blur' },
  ],
  price: [{ type: 'number', min: 0, message: '定价必须大于等于0', trigger: 'blur' }],
};

const defaultForm = {
  id: null,
  title: '',
  isbn: '',
  publisher: '',
  author: '',
  edition: '',
  publishDate: '',
  price: null,
  category: '',
  description: '',
  isActive: true,
};
const form = ref({ ...defaultForm });

function open(row) {
  form.value = row ? { ...row } : { ...defaultForm };
  visible.value = true;
}

function close() {
  visible.value = false;
}

async function handleSave() {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  // 前端统一使用 camelCase，由 naming 中间件自动转换为 snake_case 给后端
  emit('save', {
    id: form.value.id,
    data: {
      title: form.value.title,
      isbn: form.value.isbn || undefined,
      publisher: form.value.publisher || undefined,
      author: form.value.author || undefined,
      edition: form.value.edition || undefined,
      publishDate: form.value.publishDate || undefined,
      price:
        form.value.price !== null && form.value.price !== '' ? Number(form.value.price) : undefined,
      category: form.value.category || undefined,
      description: form.value.description || undefined,
      isActive: form.value.isActive,
      sortOrder: form.value.sortOrder,
    },
  });
}

defineExpose({ open, close });
</script>
