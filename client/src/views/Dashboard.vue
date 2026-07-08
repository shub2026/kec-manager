<template>
  <div class="dashboard">
    <!-- 欢迎区域 -->
    <div class="welcome-section">
      <div class="welcome-info">
        <h2 class="welcome-title">{{ greeting }}，{{ userName }}</h2>
        <p class="welcome-subtitle">
          <el-icon><Calendar /></el-icon>
          当前学期：{{ semesterLabel || '未设置' }}
        </p>
      </div>
      <div class="welcome-actions">
        <el-button type="primary" @click="navigateTo('/teaching/arrange')">
          <el-icon><EditPen /></el-icon>
          开始排课
        </el-button>
        <el-button @click="navigateTo('/query/semester')">
          <el-icon><Search /></el-icon>
          查询开课
        </el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-card class="stats-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">
            <el-icon><DataLine /></el-icon>
            数据概览
          </span>
        </div>
      </template>

      <el-skeleton v-if="loading" :rows="6" animated />
      <template v-else>
        <!-- 核心指标行 -->
        <el-row :gutter="16" class="stats-row">
          <el-col v-for="s in coreStats" :key="s.key" :xs="12" :sm="12" :md="6">
            <StatCard
              :value="stats[s.key]"
              :label="s.label"
              :icon="s.icon"
              :bg-color="s.bg"
              :icon-color="s.color"
              :core="true"
              :route="s.route"
              :spark-data="sparkData(s.key)"
            />
          </el-col>
        </el-row>
        <!-- 次要指标行 -->
        <el-row :gutter="16" class="stats-row">
          <el-col v-for="s in secondaryStats" :key="s.key" :xs="12" :sm="8" :md="6">
            <StatCard
              :value="stats[s.key]"
              :label="s.label"
              :icon="s.icon"
              :bg-color="s.bg"
              :icon-color="s.color"
              :route="s.route"
              :spark-data="sparkData(s.key)"
            />
          </el-col>
        </el-row>
      </template>
    </el-card>

    <!-- 洞察区域 -->
    <el-row :gutter="16" class="insights-row">
      <el-col :xs="24" :sm="24" :md="8">
        <SchedulingProgress :data="insights.completion" />
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <AlertCard :data="insights.alerts" />
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <HoursChart :data="insights.distribution" />
      </el-col>
    </el-row>

    <!-- 底部版权 -->
    <div class="dashboard-footer">
      <span>KEC课程管理平台 v{{ version }}</span>
      <span class="footer-sep">·</span>
      <span>© 2026</span>
      <span class="footer-sep">·</span>
      <a href="mailto:Yangshubin@ztzyxy.cn">Yangshubin@ztzyxy.cn</a>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, markRaw } from 'vue';
import { useRouter } from 'vue-router';
import {
  Calendar,
  EditPen,
  Search,
  DataLine,
  Clock,
  UserFilled,
  Reading,
  Histogram,
  OfficeBuilding,
  Notebook,
  Files,
  User,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { getDashboardStats } from '../api/dashboard';
import { getDashboardInsights } from '../api/dashboard';
import { getWithCache } from '../utils/cache';
import StatCard from '../components/StatCard.vue';
import SchedulingProgress from '../components/SchedulingProgress.vue';
import AlertCard from '../components/AlertCard.vue';
import HoursChart from '../components/HoursChart.vue';

const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const loading = ref(false);

const userName = computed(() => authStore.userInfo?.realName || '用户');
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

// 统计配置：核心指标（大卡片 + sparkline）
const coreStats = [
  {
    key: 'totalWeeklyHours',
    label: '总周课时',
    icon: markRaw(Clock),
    bg: 'var(--brand-primary-soft)',
    color: 'var(--brand-primary)',
    route: '/teaching/arrange',
  },
  {
    key: 'teachingTeachers',
    label: '参与教师',
    icon: markRaw(UserFilled),
    bg: 'var(--brand-primary-soft)',
    color: 'var(--brand-primary)',
    route: '/teaching/arrange',
  },
  {
    key: 'courses',
    label: '课程数量',
    icon: markRaw(Reading),
    bg: 'var(--brand-primary-soft)',
    color: 'var(--brand-primary)',
    route: '/courses',
  },
  {
    key: 'classes',
    label: '班级数量',
    icon: markRaw(Histogram),
    bg: 'var(--brand-primary-soft)',
    color: 'var(--brand-primary)',
    route: '/classes',
  },
];

// 统计配置：次要指标（小卡片）
const secondaryStats = [
  {
    key: 'majors',
    label: '专业类别',
    icon: markRaw(OfficeBuilding),
    bg: 'var(--bg-subtle)',
    color: 'var(--text-secondary)',
    route: '/majors',
  },
  {
    key: 'textbooks',
    label: '活跃教材',
    icon: markRaw(Notebook),
    bg: 'var(--bg-subtle)',
    color: 'var(--text-secondary)',
    route: '/textbooks',
  },
  {
    key: 'plans',
    label: '培养方案',
    icon: markRaw(Files),
    bg: 'var(--bg-subtle)',
    color: 'var(--text-secondary)',
    route: '/plans',
  },
  {
    key: 'totalStudents',
    label: '在读学生',
    icon: markRaw(User),
    bg: 'var(--bg-subtle)',
    color: 'var(--text-secondary)',
    route: '',
  },
];

// 生成 mock sparkline 趋势数据（基于当前值模拟 6 个点）
function sparkData(key) {
  const val = stats.value[key];
  if (!val || val < 2) return [];
  const points = 6;
  const data = [];
  for (let i = 0; i < points; i++) {
    const ratio = 0.4 + (i / (points - 1)) * 0.6;
    const jitter = Math.sin(i * 2.5 + key.length) * 0.08;
    data.push(Math.max(1, Math.round(val * (ratio + jitter))));
  }
  data[data.length - 1] = val; // 确保最后一个点是当前值
  return data;
}

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

// 洞察数据：排课完成度 + 异常提醒 + 课时分布
const insights = ref({
  completion: { totalCourses: 0, assignedCourses: 0, rate: 0 },
  alerts: { unassignedCourses: [], overloadedTeachers: [] },
  distribution: [],
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
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('Dashboard 统计加载失败:', e);
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
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('Dashboard 洞察加载失败:', e);
  }
}

onMounted(async () => {
  loading.value = true;
  await settingsStore.load();
  // 统计和洞察并行加载
  await Promise.all([fetchStats(), fetchInsights()]);
});
</script>

<style scoped>
.dashboard {
  max-width: 1400px;
  margin: 0 auto;
  height: calc(100vh - 60px - var(--space-5) * 2);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

/* 欢迎区域 — 白底卡片 + 左侧品牌色条，克制优雅 */
.welcome-section {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-left: 3px solid var(--brand-primary);
  border-radius: var(--radius-md);
  padding: 14px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

.welcome-title {
  margin: 0 0 2px 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.welcome-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.welcome-actions {
  display: flex;
  gap: 10px;
}

/* 欢迎区域按钮 — 浅底场景下的主色实心 + 柔和次级 */
.welcome-actions :deep(.el-button--primary) {
  font-weight: 600;
}

.welcome-actions :deep(.el-button:not(.el-button--primary)) {
  background: var(--bg-subtle);
  border-color: var(--border-light);
  color: var(--text-regular);
}

.welcome-actions :deep(.el-button:not(.el-button--primary):hover) {
  background: var(--brand-primary-soft);
  border-color: var(--brand-primary-lighter);
  color: var(--brand-primary);
}

/* 卡片通用样式 */
.stats-card {
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.stats-card :deep(.el-card__header) {
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-light);
}

.stats-card :deep(.el-card__body) {
  padding: 14px 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: -0.01em;
}

/* 统计卡片行间距 */
.stats-row {
  margin-bottom: 10px;
}

.stats-row:last-child {
  margin-bottom: 0;
}

/* 洞察区域 — flex:1 吸收剩余高度 */
.insights-row {
  flex: 1;
  min-height: 0;
  margin-bottom: 0;
}

.insights-row :deep(.el-card) {
  margin-bottom: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.insights-row :deep(.el-card__header) {
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.insights-row :deep(.el-card__body) {
  padding: 12px 20px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.insights-row :deep(.card-title) {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: -0.01em;
}

/* 底部版权 — 紧凑贴底 */
.dashboard-footer {
  text-align: center;
  padding: 6px 0 0;
  font-size: 11px;
  color: var(--text-placeholder);
  flex-shrink: 0;
  letter-spacing: 0.02em;
}

.dashboard-footer a {
  color: var(--text-placeholder);
  text-decoration: none;
  transition: color var(--dur-fast);
}

.dashboard-footer a:hover {
  color: var(--brand-primary);
}

.footer-sep {
  margin: 0 4px;
}

/* 响应式 */
@media (max-width: 768px) {
  .dashboard {
    height: auto;
    min-height: calc(100vh - 50px - 24px);
    overflow-y: auto;
    gap: 10px;
  }

  .welcome-section {
    flex-direction: column;
    align-items: flex-start;
    padding: 14px 16px;
  }

  .welcome-actions {
    width: 100%;
  }

  .welcome-actions .el-button {
    flex: 1;
  }

  .welcome-title {
    font-size: 16px;
  }

  .insights-row {
    flex: none;
  }

  .insights-row :deep(.el-card__body) {
    overflow-y: visible;
  }
}
</style>
