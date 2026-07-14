<template>
  <div class="semester-select">
    <el-button :disabled="modelValue === currentSemester" @click="goToCurrent">
      <el-icon><Calendar /></el-icon> 当前学期
    </el-button>
    <el-select
      :model-value="modelValue"
      placeholder="选择学期"
      class="filter-2xl"
      @change="onChange"
    >
      <el-option
        v-for="sem in availableSemesters"
        :key="sem.value"
        :label="sem.label"
        :value="sem.value"
      />
    </el-select>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Calendar } from '@element-plus/icons-vue';
import { useSemesters } from '../composables/useSemesters';

const props = defineProps({
  modelValue: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue', 'change']);

const { availableSemesters, fetchCurrentSemester } = useSemesters();
// 全局「当前学期」值，用于「当前学期」按钮默认态与禁用判断
const currentSemester = ref('');

onMounted(async () => {
  currentSemester.value = await fetchCurrentSemester();
  // 父组件未预设学期时，默认落到全局当前学期
  if (!props.modelValue) {
    emit('update:modelValue', currentSemester.value);
  }
});

function goToCurrent() {
  emit('update:modelValue', currentSemester.value);
  emit('change', currentSemester.value);
}

function onChange(val) {
  emit('update:modelValue', val);
  emit('change', val);
}
</script>

<style scoped>
.semester-select {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
</style>
