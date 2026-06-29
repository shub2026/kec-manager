<template>
  <div class="matrix-toolbar">
    <el-button type="primary" @click="$emit('add-course')">
      <el-icon><Plus /></el-icon> 添加课程
    </el-button>
    <div class="matrix-toolbar-right">
      <span class="total-courses-label">共 {{ allCourses.length }} 门课程</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  allCourses: { type: Array, default: () => [] },
});

defineEmits(['add-course']);
</script>

<style scoped>
.matrix-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.matrix-toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.total-courses-label {
  color: #909399;
  font-size: 13px;
}
</style>
