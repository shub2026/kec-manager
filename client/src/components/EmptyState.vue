<template>
  <div class="custom-empty" role="status" aria-label="空状态">
    <div class="empty-illustration" :class="`empty-${type}`">
      <svg
        viewBox="0 0 120 120"
        width="120"
        height="120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <!-- 背景圆 -->
        <circle cx="60" cy="60" r="56" fill="var(--illust-bg)" />
        <!-- 装饰圆点 -->
        <circle cx="22" cy="28" r="4" fill="var(--illust-dot)" />
        <circle cx="98" cy="88" r="3" fill="var(--illust-dot)" />
        <circle cx="90" cy="24" r="5" fill="var(--illust-dot)" opacity="0.5" />

        <!-- 按 type 切换插画 -->
        <!-- course: 翻开的书本 -->
        <g v-if="type === 'course'">
          <path
            d="M36 50 L60 42 L84 50 L84 80 L60 72 L36 80Z"
            fill="var(--illust-main)"
            opacity="0.15"
          />
          <path d="M60 42 L60 72" stroke="var(--illust-main)" stroke-width="2" />
          <path
            d="M36 50 L60 42 L84 50 L84 80 L60 72 L36 80Z"
            stroke="var(--illust-main)"
            stroke-width="2"
            stroke-linejoin="round"
            fill="none"
          />
          <path d="M42 55 L56 50" stroke="var(--illust-main)" stroke-width="1.5" opacity="0.5" />
          <path d="M42 60 L56 55" stroke="var(--illust-main)" stroke-width="1.5" opacity="0.5" />
          <path d="M42 65 L56 60" stroke="var(--illust-main)" stroke-width="1.5" opacity="0.5" />
          <path d="M64 50 L78 55" stroke="var(--illust-main)" stroke-width="1.5" opacity="0.5" />
          <path d="M64 55 L78 60" stroke="var(--illust-main)" stroke-width="1.5" opacity="0.5" />
          <path d="M64 60 L78 65" stroke="var(--illust-main)" stroke-width="1.5" opacity="0.5" />
        </g>

        <!-- class: 教室/黑板 -->
        <g v-else-if="type === 'class'">
          <rect
            x="34"
            y="38"
            width="52"
            height="36"
            rx="3"
            fill="var(--illust-main)"
            opacity="0.15"
          />
          <rect
            x="34"
            y="38"
            width="52"
            height="36"
            rx="3"
            stroke="var(--illust-main)"
            stroke-width="2"
            fill="none"
          />
          <line
            x1="42"
            y1="48"
            x2="62"
            y2="48"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <line
            x1="42"
            y1="54"
            x2="56"
            y2="54"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <line
            x1="42"
            y1="60"
            x2="66"
            y2="60"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <line
            x1="42"
            y1="66"
            x2="52"
            y2="66"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <!-- 粉笔 -->
          <line
            x1="72"
            y1="68"
            x2="78"
            y2="62"
            stroke="var(--illust-main)"
            stroke-width="2"
            stroke-linecap="round"
          />
          <!-- 桌脚 -->
          <line
            x1="42"
            y1="78"
            x2="42"
            y2="84"
            stroke="var(--illust-main)"
            stroke-width="2"
            stroke-linecap="round"
          />
          <line
            x1="78"
            y1="78"
            x2="78"
            y2="84"
            stroke="var(--illust-main)"
            stroke-width="2"
            stroke-linecap="round"
          />
        </g>

        <!-- teacher: 人物剪影 -->
        <g v-else-if="type === 'teacher'">
          <circle cx="60" cy="44" r="12" fill="var(--illust-main)" opacity="0.15" />
          <circle cx="60" cy="44" r="12" stroke="var(--illust-main)" stroke-width="2" fill="none" />
          <path
            d="M38 84 C38 68 50 62 60 62 C70 62 82 68 82 84"
            fill="var(--illust-main)"
            opacity="0.15"
          />
          <path
            d="M38 84 C38 68 50 62 60 62 C70 62 82 68 82 84"
            stroke="var(--illust-main)"
            stroke-width="2"
            fill="none"
          />
          <!-- 领带/装饰 -->
          <path
            d="M57 62 L60 70 L63 62"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            fill="none"
          />
        </g>

        <!-- textbook: 立着的书本 -->
        <g v-else-if="type === 'textbook'">
          <rect
            x="38"
            y="34"
            width="32"
            height="44"
            rx="2"
            fill="var(--illust-main)"
            opacity="0.15"
          />
          <rect
            x="38"
            y="34"
            width="32"
            height="44"
            rx="2"
            stroke="var(--illust-main)"
            stroke-width="2"
            fill="none"
          />
          <rect x="46" y="34" width="2" height="44" fill="var(--illust-main)" opacity="0.3" />
          <line
            x1="52"
            y1="44"
            x2="64"
            y2="44"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <line
            x1="52"
            y1="50"
            x2="62"
            y2="50"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <line
            x1="52"
            y1="56"
            x2="64"
            y2="56"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <!-- 第二本书（背后） -->
          <rect
            x="44"
            y="30"
            width="32"
            height="44"
            rx="2"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            fill="none"
            opacity="0.3"
          />
          <!-- 笔 -->
          <line
            x1="76"
            y1="52"
            x2="82"
            y2="82"
            stroke="var(--illust-main)"
            stroke-width="2"
            stroke-linecap="round"
            opacity="0.5"
          />
        </g>

        <!-- plan: 文档/清单 -->
        <g v-else-if="type === 'plan'">
          <rect
            x="38"
            y="30"
            width="44"
            height="56"
            rx="3"
            fill="var(--illust-main)"
            opacity="0.15"
          />
          <rect
            x="38"
            y="30"
            width="44"
            height="56"
            rx="3"
            stroke="var(--illust-main)"
            stroke-width="2"
            fill="none"
          />
          <line
            x1="48"
            y1="44"
            x2="72"
            y2="44"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <line
            x1="48"
            y1="52"
            x2="66"
            y2="52"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <line
            x1="48"
            y1="60"
            x2="70"
            y2="60"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <line
            x1="48"
            y1="68"
            x2="58"
            y2="68"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            opacity="0.5"
          />
          <!-- 折角 -->
          <path
            d="M70 30 L70 40 L82 40"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            fill="var(--illust-bg)"
          />
          <!-- 勾选标记 -->
          <circle cx="44" cy="44" r="2" fill="var(--illust-main)" />
          <circle cx="44" cy="52" r="2" fill="var(--illust-main)" />
          <circle cx="44" cy="60" r="2" fill="var(--illust-main)" />
        </g>

        <!-- major/college: 学院/建筑 -->
        <g v-else-if="type === 'college' || type === 'major'">
          <path d="M60 32 L90 52 L90 84 L30 84 L30 52Z" fill="var(--illust-main)" opacity="0.1" />
          <path
            d="M60 32 L90 52 L90 84 L30 84 L30 52Z"
            stroke="var(--illust-main)"
            stroke-width="2"
            fill="none"
            stroke-linejoin="round"
          />
          <rect
            x="52"
            y="64"
            width="16"
            height="20"
            rx="1"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            fill="none"
          />
          <line
            x1="60"
            y1="64"
            x2="60"
            y2="84"
            stroke="var(--illust-main)"
            stroke-width="1"
            opacity="0.3"
          />
          <circle
            cx="60"
            cy="46"
            r="4"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            fill="none"
          />
        </g>

        <!-- 通用: 文件夹/搜索 -->
        <g v-else>
          <rect
            x="32"
            y="42"
            width="56"
            height="40"
            rx="4"
            fill="var(--illust-main)"
            opacity="0.15"
          />
          <rect
            x="32"
            y="42"
            width="56"
            height="40"
            rx="4"
            stroke="var(--illust-main)"
            stroke-width="2"
            fill="none"
          />
          <path d="M32 48 L50 48 L54 42 L32 42Z" fill="var(--illust-main)" opacity="0.2" />
          <path
            d="M32 42 L50 42 L54 48"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            fill="none"
          />
          <!-- 内部文件 -->
          <rect
            x="44"
            y="54"
            width="32"
            height="22"
            rx="2"
            stroke="var(--illust-main)"
            stroke-width="1.5"
            fill="none"
            opacity="0.4"
          />
          <line
            x1="50"
            y1="62"
            x2="70"
            y2="62"
            stroke="var(--illust-main)"
            stroke-width="1"
            opacity="0.3"
          />
          <line
            x1="50"
            y1="68"
            x2="64"
            y2="68"
            stroke="var(--illust-main)"
            stroke-width="1"
            opacity="0.3"
          />
        </g>
      </svg>
    </div>

    <div class="empty-content">
      <p class="empty-description">{{ description }}</p>
      <slot name="action" />
    </div>
  </div>
</template>

<script setup>
defineProps({
  /**
   * 插画类型: course | class | teacher | textbook | plan | college | major | generic
   */
  type: {
    type: String,
    default: 'generic',
  },
  /**
   * 描述文字
   */
  description: {
    type: String,
    default: '暂无数据',
  },
});
</script>

<style scoped>
.custom-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-7) var(--space-5);
}

.empty-illustration {
  margin-bottom: var(--space-4);
  --illust-bg: var(--brand-primary-soft, #e8f3fe);
  --illust-main: var(--brand-primary, #1c82f5);
  --illust-dot: var(--brand-primary-lighter, #b5d6fc);
}

/* 不同类型使用不同色调 */
.empty-class,
.empty-college,
.empty-major {
  --illust-bg: var(--brand-warning-soft, #fef3c7);
  --illust-main: var(--brand-warning, #fbbf24);
  --illust-dot: var(--brand-warning-lighter);
}

.empty-teacher {
  --illust-bg: var(--brand-success-soft, #d1fae5);
  --illust-main: var(--brand-success, #34d399);
  --illust-dot: var(--brand-success-lighter);
}

.empty-textbook {
  --illust-bg: var(--brand-danger-soft, #fee2e2);
  --illust-main: var(--brand-danger, #f87171);
  --illust-dot: var(--brand-danger-lighter);
}

.empty-plan {
  --illust-bg: var(--brand-indigo-soft, #eef2ff);
  --illust-main: var(--brand-indigo, #818cf8);
  --illust-dot: var(--brand-indigo-lighter, #c7d2fe);
}

.empty-content {
  text-align: center;
}

.empty-description {
  margin: 0 0 var(--space-3);
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
}
</style>
