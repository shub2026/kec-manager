<template>
  <div class="dashboard">
    <!-- 欢迎区域 + 指标条 -->
    <div class="welcome-section">
      <div class="welcome-top">
        <div class="welcome-info">
          <h1 class="welcome-title">{{ greeting }}，{{ userName }}</h1>
          <p class="welcome-subtitle">
            <el-icon><Calendar /></el-icon>
            <span>{{ semesterLabel || '未设置学期' }}</span>
          </p>
        </div>
        <div class="welcome-actions">
          <el-button v-if="isAdmin" type="primary" @click="navigateTo('/teaching/arrange')">
            <el-icon><EditPen /></el-icon>
            开始排课
          </el-button>
          <el-button plain type="primary" @click="navigateTo('/query/semester')">
            <el-icon><Search /></el-icon>
            查询开课
          </el-button>
        </div>
        <!-- 装饰性几何图形：品牌蓝单色相非对称构成，纯装饰不进可访问性树 -->
        <svg
          class="welcome-decor"
          aria-hidden="true"
          width="320"
          height="112"
          viewBox="0 0 320 112"
          fill="none"
        >
          <defs>
            <pattern
              id="welcomeDecorDots"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="2" class="decor-dot" />
            </pattern>
            <linearGradient id="welcomeDecorFade" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#fff" stop-opacity="1" />
              <stop offset="1" stop-color="#fff" stop-opacity="0" />
            </linearGradient>
            <mask id="welcomeDecorMask">
              <rect x="104" y="16" width="80" height="80" fill="url(#welcomeDecorFade)" />
            </mask>
          </defs>
          <!-- 柔和面片垫底，给线性元素一点体积感 -->
          <circle cx="284" cy="78" r="18" class="decor-blob" />
          <!-- 点阵向右下渐隐，避免生硬的方块边界 -->
          <rect
            x="104"
            y="16"
            width="80"
            height="80"
            fill="url(#welcomeDecorDots)"
            mask="url(#welcomeDecorMask)"
          />
          <!-- 双环错位叠放形成轨道感，虚线环缓慢自转 -->
          <circle cx="252" cy="56" r="46" class="decor-ring" />
          <circle cx="238" cy="46" r="27" class="decor-ring decor-ring--dashed" />
          <!-- 轨道点：全图唯一实色重音，落在外环顶点 -->
          <circle cx="252" cy="10" r="4" class="decor-satellite" />
        </svg>
      </div>

      <!-- 内联指标条：一行纵览,紧凑高效 -->
      <el-skeleton v-if="loading" :rows="2" animated class="loading-skeleton" />
      <div v-else class="metrics-strip" role="list" aria-label="核心指标">
        <div v-for="m in metrics" :key="m.key" class="metric-item" role="listitem">
          <!-- 可点击指标用 router-link 承载链接语义：屏幕阅读器可感知、键盘原生激活 -->
          <router-link
            v-if="isAdmin && m.route"
            :to="m.route"
            class="metric-inner metric-clickable"
          >
            <span class="metric-value">{{ m.displayValue }}</span>
            <span class="metric-label">
              <el-icon :size="13"><component :is="m.icon" /></el-icon>
              {{ m.label }}
            </span>
          </router-link>
          <div v-else class="metric-inner">
            <span class="metric-value">{{ m.displayValue }}</span>
            <span class="metric-label">
              <el-icon :size="13"><component :is="m.icon" /></el-icon>
              {{ m.label }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 洞察区域：CSS Grid 非对称布局（左 60% 右 40%） -->
    <section class="insights-grid" role="region" aria-label="教学洞察">
      <!-- 加载中先占位，避免闪现“暂无数据”空态（同内嵌表格假加载闪烁问题的反向场景） -->
      <template v-if="insightsLoading">
        <div v-for="i in 4" :key="i" class="insight-skeleton">
          <el-skeleton :rows="4" animated />
        </div>
      </template>
      <template v-else>
        <div class="insight-main">
          <CourseProgressChart
            :data="insights.completion"
            :total-hours="stats.totalWeeklyHours"
            :assigned-hours="stats.assignedWeeklyHours"
          />
        </div>
        <div class="insight-side">
          <AlertCard :data="insights.alerts" />
        </div>
        <div class="insight-main">
          <CourseStatsCard :data="insights.courseStats" />
        </div>
        <div class="insight-side">
          <HoursChart :data="insights.distribution" />
        </div>
      </template>
    </section>

    <!-- 底部版权 -->
    <div class="dashboard-footer">
      <span>KEC课程管理平台 v{{ version }}</span>
      <span class="footer-sep">·</span>
      <span>© 2026</span>
      <span class="footer-sep">·</span>
      <span>Yangshubin@ztzyxy.cn</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { Calendar, EditPen, Search } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { getDashboardStats } from '../api/dashboard';
import { getDashboardInsights } from '../api/dashboard';
import { getWithCache } from '../utils/cache';
import { useCountUp } from '../composables/useCountUp';
import AlertCard from '../components/AlertCard.vue';
import HoursChart from '../components/HoursChart.vue';
import CourseProgressChart from '../components/CourseProgressChart.vue';
import CourseStatsCard from '../components/CourseStatsCard.vue';

defineOptions({ name: 'Dashboard' });

const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const loading = ref(false);
// 初始为 true：首次渲染即展示骨架屏，避免数据返回前闪现空态文案
const insightsLoading = ref(true);

const userName = computed(() => authStore.userInfo?.realName || '用户');
const isAdmin = computed(() => authStore.isAdmin);
const semesterLabel = computed(() => settingsStore.semesterLabel);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 17) return '下午好';
  if (hour < 19) return '傍晚好';
  return '晚上好';
});

// ─── 指标配置与 countup ───
// icon 用全局注册的 EP 图标名，与侧边栏菜单符号保持一致（培养方案=Document 等）
const metricConfigs = [
  { key: 'totalWeeklyHours', label: '总周课时', route: '/teaching/arrange', icon: 'Clock' },
  { key: 'teachingTeachers', label: '参与教师', route: '/teaching/arrange', icon: 'User' },
  { key: 'courses', label: '课程数量', route: '/courses', icon: 'Reading' },
  { key: 'classes', label: '班级数量', route: '/classes', icon: 'School' },
  { key: 'totalStudents', label: '在读学生', route: '', icon: 'Avatar' },
  { key: 'plans', label: '培养方案', route: '/plans', icon: 'Document' },
];

const stats = ref({
  majors: 0,
  courses: 0,
  classes: 0,
  textbooks: 0,
  plans: 0,
  totalStudents: 0,
  teachingTeachers: 0,
  totalWeeklyHours: 0,
  assignedWeeklyHours: null,
});

// 为每个指标创建独立 ref 和 countup
const metricRefs = metricConfigs.map(() => ref(0));
const metricCountups = metricRefs.map((r) => {
  const { displayValue } = useCountUp(r, { duration: 900 });
  return displayValue;
});

// 当 stats 变化时同步到各指标 ref
const metrics = computed(() =>
  metricConfigs.map((cfg, i) => ({
    ...cfg,
    displayValue: metricCountups[i].value,
  }))
);

function syncMetricRefs() {
  metricConfigs.forEach((cfg, i) => {
    metricRefs[i].value = stats.value[cfg.key] || 0;
  });
}

// 洞察数据
const insights = ref({
  completion: { totalCourses: 0, assignedCourses: 0, rate: 0 },
  alerts: { unassignedCourses: [], overloadedTeachers: [] },
  distribution: [],
  courseStats: [],
});

async function fetchStats() {
  loading.value = true;
  try {
    let semester = settingsStore.settings?.currentSemester?.value;
    if (!semester) {
      await settingsStore.load(true);
      semester = settingsStore.settings?.currentSemester?.value;
    }
    if (!semester) return;

    const CACHE_TTL = 5 * 60 * 1000;
    const res = await getWithCache(
      () => getDashboardStats(semester),
      `dashboard:stats:${semester}`,
      CACHE_TTL
    );

    const d = res.data;
    if (d) {
      stats.value.majors = d.majors || 0;
      stats.value.courses = d.courses || 0;
      stats.value.classes = d.classes || 0;
      stats.value.textbooks = d.textbooks || 0;
      stats.value.plans = d.plans || 0;
      stats.value.totalStudents = d.totalStudents || 0;
      stats.value.teachingTeachers = d.teachingTeachers || 0;
      stats.value.totalWeeklyHours = d.totalWeeklyHours || 0;
      stats.value.assignedWeeklyHours = d.assignedWeeklyHours ?? null;
      syncMetricRefs();
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('Dashboard 统计加载失败:', e);
    ElMessage.error('统计数据加载失败');
  } finally {
    loading.value = false;
  }
}

function navigateTo(path) {
  router.push(path);
}

async function fetchInsights() {
  insightsLoading.value = true;
  try {
    let semester = settingsStore.settings?.currentSemester?.value;
    if (!semester) return;

    const CACHE_TTL = 5 * 60 * 1000;
    const res = await getWithCache(
      () => getDashboardInsights(semester),
      `dashboard:insights:${semester}`,
      CACHE_TTL
    );

    const d = res.data;
    if (d) {
      insights.value.completion = d.completion || insights.value.completion;
      insights.value.alerts = d.alerts || insights.value.alerts;
      insights.value.distribution = d.distribution || [];
      insights.value.courseStats = d.courseStats || [];
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('Dashboard 洞察加载失败:', e);
    ElMessage.error('洞察数据加载失败');
  } finally {
    insightsLoading.value = false;
  }
}

onMounted(async () => {
  // SEC-H2: 强制改密期间跳过 API 调用，避免触发 403 MUST_CHANGE_PASSWORD
  if (authStore.mustChangePassword) {
    insightsLoading.value = false;
    return;
  }
  loading.value = true;
  await settingsStore.load();
  await Promise.all([fetchStats(), fetchInsights()]);
});
</script>

<style scoped>
.dashboard {
  /* 首页看板有意限宽居中，区别于其他页面的全宽布局 */
  max-width: 1440px;
  margin: 0 auto;
  /* layout-main 是 flex 拉伸的确定高度滚动容器，100% 自动扣除各端内边距；
     旧公式多减了不存在的 60px 顶栏，致页脚 margin-top:auto 只能推到“假底部” */
  min-height: 100%;
  display: flex;
  flex-direction: column;
  /* 分级间距：欢迎→洞察 24px，洞察→页脚 auto */
  gap: 0;
}

/* ─── 欢迎区域 ─── */
.welcome-section {
  flex-shrink: 0;
  padding-top: var(--space-4);
}

.welcome-top {
  /* 装饰层的定位上下文 */
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding-bottom: var(--space-5);
}

.welcome-title {
  margin: 0 0 8px 0;
  font-size: var(--font-size-display);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  line-height: 1.3;
}

.welcome-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.welcome-subtitle .el-icon {
  color: var(--brand-primary);
}

.welcome-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-shrink: 0;
  /* 压在装饰图形之上 */
  position: relative;
  z-index: 1;
}

.welcome-actions :deep(.el-button--primary) {
  font-weight: 600;
}

/* ─── 欢迎区装饰图形：品牌蓝单色相几何组合，似有若无的背景层 ─── */
.welcome-decor {
  position: absolute;
  /* 右侧锚定：外环边缘微叠进按钮组下方形成搭接层次 */
  right: 170px;
  top: 50%;
  transform: translateY(-52%);
  z-index: 0;
  pointer-events: none;
  opacity: 0.6;
}

.decor-ring {
  stroke: var(--brand-primary-lighter);
  stroke-width: 1.5;
  opacity: 0.55;
}

/* 虚线环：圆点笔触 + 极缓自转，给静态页面一丝若有若无的生命力 */
.decor-ring--dashed {
  stroke-dasharray: 1 8;
  stroke-linecap: round;
  stroke-width: 2;
  opacity: 0.8;
  transform-box: fill-box;
  transform-origin: center;
  animation: decor-spin 90s linear infinite;
}

@keyframes decor-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .decor-ring--dashed {
    animation: none;
  }
}

.decor-satellite {
  fill: var(--brand-primary);
  opacity: 0.45;
}

.decor-blob {
  fill: var(--brand-primary-soft);
}

.decor-dot {
  fill: var(--brand-primary-lighter);
  opacity: 0.7;
}

/* ─── 内联指标条 ─── */
.metrics-strip {
  display: flex;
  align-items: stretch;
  margin-top: 0;
  padding: var(--space-5) var(--space-6);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
  gap: 0;
}

.metric-item {
  flex: 1;
  display: flex;
  position: relative;
}

/* 指标内容层：可点击时为 router-link(a 标签)，需重置链接默认样式 */
.metric-inner {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out);
  color: inherit;
  text-decoration: none;
}

/* 指标间的竖线分隔符 */
.metric-item + .metric-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 25%;
  bottom: 25%;
  width: 1px;
  background: var(--border-light);
}

.metric-clickable {
  cursor: pointer;
}

.metric-clickable:hover {
  background: var(--bg-subtle);
}

.metric-clickable:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: -2px;
}

.metric-value {
  font-size: var(--font-size-display);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  transition: color var(--dur-fast) var(--ease-out);
}

/* 可点击指标 hover：数字染品牌蓝，比单纯换灰底的反馈更明确 */
.metric-clickable:hover .metric-value {
  color: var(--brand-primary);
}

.metric-label {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  font-weight: 500;
  letter-spacing: 0.01em;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  /* 图标不另设色：继承标签的 --text-secondary，形状锚点与文字同灰同权重，不抢数字注意力 */
}

/* ─── 洞察网格：非对称 3fr 2fr ─── */
.insights-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: var(--space-4);
  margin-top: var(--space-5);
}

.insights-grid > div {
  min-height: 0;
}

.insights-grid :deep(.insight-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  /* hover 浮起微交互：建立可感知的前后景深 */
  transition:
    box-shadow var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.insights-grid :deep(.insight-card:hover) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.insights-grid :deep(.insight-card .el-card__header) {
  padding: 12px 18px 8px;
  border-bottom: none;
  flex-shrink: 0;
}

.insights-grid :deep(.insight-card .el-card__body) {
  padding: 0 18px 16px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 洞察卡片加载骨架：复用卡片容器视觉，避免加载完成时布局跳变 */
.insight-skeleton {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: var(--space-4) 18px;
}

/* 卡片标题：左侧圆点色块，去掉下边框 */
.insights-grid :deep(.card-title) {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  letter-spacing: -0.01em;
}

.insights-grid :deep(.card-title .el-icon) {
  color: var(--brand-primary);
  font-size: 16px;
}

/* ─── 底部版权 ─── */
.dashboard-footer {
  margin-top: auto;
  text-align: center;
  /* 页面收尾元素：上方留白需比区块间距(24px)大一档才能脱开带投影的洞察卡，下方留足防贴底 */
  padding: var(--space-7) 0 var(--space-5);
  /* 版本号是排障信息，需保证可读性：caption 字阶 + secondary 色 */
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  flex-shrink: 0;
  letter-spacing: 0.02em;
}

.footer-sep {
  margin: 0 var(--space-1);
}

/* ─── 响应式 ─── */
@media (max-width: 1200px) {
  .insights-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 992px) {
  .metric-value {
    font-size: 22px;
  }

  /* 窄屏欢迎区转纵向排列，装饰会与文字/按钮打架 */
  .welcome-decor {
    display: none;
  }
}

@media (max-width: 768px) {
  .dashboard {
    min-height: calc(100vh - 50px - 24px);
  }

  .welcome-top {
    flex-direction: column;
    align-items: flex-start;
  }

  .welcome-title {
    font-size: 19px;
  }

  .welcome-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .welcome-actions .el-button {
    flex: 1;
    min-width: 120px;
  }

  /* 指标条 3×2 网格 */
  .metrics-strip {
    flex-wrap: wrap;
    padding: 16px 20px;
    gap: 0;
  }

  .metric-item {
    flex: 0 0 calc(100% / 3);
  }

  .metric-inner {
    padding: 10px 8px;
  }

  /* 隐藏第二个分组起的竖线 */
  .metric-item:nth-child(4)::before {
    display: none;
  }

  /* 洞察区单列堆叠 */
  .insights-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .insights-grid :deep(.insight-card .el-card__body) {
    overflow-y: visible;
  }
}
.loading-skeleton {
  margin-top: var(--space-4);
}
</style>
