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
      </div>

      <!-- 内联指标条：一行纵览,紧凑高效 -->
      <el-skeleton v-if="loading" :rows="2" animated class="loading-skeleton" />
      <div v-else class="metrics-strip" role="list" aria-label="核心指标">
        <div
          v-for="m in metrics"
          :key="m.key"
          class="metric-item"
          :class="{ 'metric-clickable': isAdmin && m.route }"
          role="listitem"
          :tabindex="isAdmin && m.route ? 0 : -1"
          @click="isAdmin && m.route && navigateTo(m.route)"
          @keyup.enter="isAdmin && m.route && navigateTo(m.route)"
        >
          <span class="metric-value">{{ m.displayValue }}</span>
          <span class="metric-label">{{ m.label }}</span>
        </div>
      </div>
    </div>

    <!-- 洞察区域：CSS Grid 非对称布局（左 60% 右 40%） -->
    <div class="insights-grid">
      <div class="insight-main">
        <CourseProgressChart :data="insights.completion" :total-hours="stats.totalWeeklyHours" />
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
    </div>

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
const metricConfigs = [
  { key: 'totalWeeklyHours', label: '总周课时', route: '/teaching/arrange' },
  { key: 'teachingTeachers', label: '参与教师', route: '/teaching/arrange' },
  { key: 'courses', label: '课程数量', route: '/courses' },
  { key: 'classes', label: '班级数量', route: '/classes' },
  { key: 'totalStudents', label: '在读学生', route: '' },
  { key: 'plans', label: '培养方案', route: '/plans' },
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
  }
}

onMounted(async () => {
  // SEC-H2: 强制改密期间跳过 API 调用，避免触发 403 MUST_CHANGE_PASSWORD
  if (authStore.mustChangePassword) {
    return;
  }
  loading.value = true;
  await settingsStore.load();
  await Promise.all([fetchStats(), fetchInsights()]);
});
</script>

<style scoped>
.dashboard {
  max-width: 1440px;
  margin: 0 auto;
  min-height: calc(100vh - 60px - var(--space-5) * 2);
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
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding-bottom: var(--space-5);
}

.welcome-title {
  margin: 0 0 8px 0;
  font-size: 22px;
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
}

.welcome-actions :deep(.el-button--primary) {
  font-weight: 600;
}

/* ─── 内联指标条 ─── */
.metrics-strip {
  display: flex;
  align-items: stretch;
  margin-top: 0;
  padding: 22px 28px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
  gap: 0;
}

.metric-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out);
  position: relative;
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
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
}

.metric-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
  letter-spacing: 0.01em;
}

/* ─── 洞察网格：非对称 3fr 2fr ─── */
.insights-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
  margin-top: 20px;
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
  padding: 40px 0 12px;
  font-size: 11px;
  color: var(--text-placeholder);
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
