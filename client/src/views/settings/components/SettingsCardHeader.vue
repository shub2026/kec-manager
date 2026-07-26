<template>
  <div class="card-title-row">
    <span class="card-dot" :style="{ backgroundColor: dotColor }"></span>
    <span class="card-title-text"><slot /></span>
    <el-tag v-if="tag" size="small" :type="tagType" effect="plain" disable-transitions>{{
      tag
    }}</el-tag>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  dot: {
    type: String,
    default: 'blue',
    validator: (v) => ['blue', 'green', 'red'].includes(v),
  },
  tag: {
    type: String,
    default: '',
  },
  tagType: {
    type: String,
    default: 'info',
  },
});

const colorMap = {
  blue: 'var(--brand-primary)',
  green: 'var(--brand-success, #34d399)',
  red: 'var(--brand-danger)',
};

const dotColor = computed(() => colorMap[props.dot] || colorMap.blue);
</script>

<style scoped>
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

.card-title-text {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}
</style>
