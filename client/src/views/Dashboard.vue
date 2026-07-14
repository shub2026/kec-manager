<template>
  <div class="dashboard">
    <!-- 欢迎区域 -->
    <div class="welcome-section">
      <div class="welcome-info">
        <h1 class="welcome-title">{{ greeting }}，{{ userName }}</h1>
        <p class="welcome-subtitle">
          <el-icon><Calendar /></el-icon>
          <span>{{ semesterLabel || '未设置学期' }}</span>
          <template v-if="!loading && stats.courses">
            <span class="subtitle-sep">·</span>
            <span class="subtitle-summary">
              {{ stats.courses }} 门课程 / {{ stats.teachingTeachers }} 位教师 / {{ stats.classes }} 个班级
            </span>
          </template>
        </p>
      </div>
      <div class="welcome-actions">
        <el-button v-if="isAdmin" type="primary" @click="navigateTo('/teaching/arrange')">
          <el-icon><EditPen /></el-icon>
          开始排课
        </el-button>
        <el-button text type="primary" @click="navigateTo('/query/semester')">
          <el-icon><Search /></el-icon>
          查询开课
        </el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-skeleton v-if="loading" :rows="3" animated />
    <template v-else>
      <!-- 核心指标行（4 张纵向大卡） -->
      <el-row :gutter="20" class="stats-row">
        <el-col v-for="s in coreStats" :key="s.key" :xs="12" :sm="12" :md="6">
          <StatCard
            :value="stats[s.key]"
            :label="s.label"
            :icon="s.icon"
            :bg-color="s.bg"
            :icon-color="s.color"
            :core="true"
            :route="isAdmin ? s.route : ''"
          />
        </el-col>
      </el-row>
      <!-- 次要指标行（2 张横向宽卡） -->
      <el-row :gutter="20" class="stats-row">
        <el-col v-for="s in secondaryStats" :key="s.key" :xs="12" :sm="12" :md="12">
          <StatCard
            :value="stats[s.key]"
            :label="s.label"
            :icon="s.icon"
            :bg-color="s.bg"
            :icon-color="s.color"
            :route="isAdmin ? s.route : ''"
          />
        </el-col>
      </el-row>
    </template>

    <!-- 洞察区域：2×2 栅格，恢复异常提醒 -->
    <el-row :gutter="20" class="insights-row">
      <el-col :xs="24" :md="12">
        <CourseProgressChart :data="insights.completion" :total-hours="stats.totalWeeklyHours" />
      </el-col>
      <el-col :xs="24" :md="12">
        <AlertCard :data="insights.alerts" />
      </el-col>
    </el-row>
    <el-row :gutter="20" class="insights-row">
      <el-col :xs="24" :md="12">
        <CourseStatsCard :data="insights.courseStats" />
      </el-col>
      <el-col :xs="24" :md="12">
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
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  Calendar,
  EditPen,
  Search,
  Clock,
  UserFilled,
  Reading,
  School,
  Files,
  User,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { getDashboardStats } from '../api/dashboard';
import { getDashboardInsights } from '../api/dashboard';
import { getWithCache } from '../utils/cache';
import StatCard from '../components/StatCard.vue';
import AlertCard from '../components/AlertCard.vue';
import HoursChart from '../components/HoursChart.vue';
import CourseProgressChart from '../components/CourseProgressChart.vue';
import CourseStatsCard from '../components/CourseStatsCard.vue';

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

// 统计配置：核心指标（大卡片）
// 色彩策略：核心卡统一浅蓝底+左色条,图标色按"排课业务(蓝)/资源(靛蓝)"区分,收敛色相
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
    bg: 'var(--brand-indigo-soft)',
    color: 'var(--brand-indigo)',
    route: '/courses',
  },
  {
    key: 'classes',
    label: '班级数量',
    icon: markRaw(School),
    bg: 'var(--brand-indigo-soft)',
    color: 'var(--brand-indigo)',
    route: '/classes',
  },
];

// 统计配置：次要指标（小卡片）
// 色彩策略：薄荷绿统一表达"资源与成果"维度,与核心蓝形成蓝绿冷色互补
const secondaryStats = [
  {
    key: 'totalStudents',
    label: '在读学生',
    icon: markRaw(User),
    bg: 'var(--brand-mint-soft)',
    color: 'var(--brand-mint)',
    route: '',
  },
  {
    key: 'plans',
    label: '培养方案',
    icon: markRaw(Files),
    bg: 'var(--brand-mint-soft)',
    color: 'var(--brand-mint)',
    route: '/plans',
  },
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

// 洞察数据：排课完成度 + 异常提醒 + 课时分布
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
  /* 放开 overflow,内容自然流动,首屏核心信息可见,洞察区下滑查看 */
  min-height: calc(100vh - 60px - var(--space-5) * 2);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 欢迎区域 — 去卡片化,作为页面视觉入口 */
.welcome-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  flex-shrink: 0;
  padding: 4px 0;
}

.welcome-title {
  margin: 0 0 4px 0;
  font-size: 24px;
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
  flex-wrap: wrap;
}

.welcome-subtitle .el-icon {
  color: var(--brand-primary);
}

.subtitle-sep {
  color: var(--text-placeholder);
  margin: 0 2px;
}

.subtitle-summary {
  color: var(--text-regular);
  font-variant-numeric: tabular-nums;
}

.welcome-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.welcome-actions :deep(.el-button--primary) {
  font-weight: 600;
}

/* 统计卡片行间距 */
.stats-row {
  margin-bottom: 0;
}

/* 洞察区域 — 自然高度,行间由父级 gap 控制 */
.insights-row {
  margin-bottom: 0;
}

.insights-row :deep(.el-card) {
  margin-bottom: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
}

.insights-row :deep(.el-card__header) {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.insights-row :deep(.el-card__body) {
  padding: 16px 20px;
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

/* 底部版权 — 贴底 + 留白呼吸 */
.dashboard-footer {
  margin-top: auto;
  text-align: center;
  padding: 16px 0 4px;
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
    min-height: calc(100vh - 50px - 24px);
    gap: 16px;
    padding-bottom: 4px;
  }

  .welcome-section {
    flex-direction: column;
    align-items: flex-start;
    padding: 4px 0;
  }

  .welcome-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .welcome-actions .el-button {
    flex: 1;
    min-width: 120px;
  }

  .welcome-title {
    font-size: 20px;
  }

  /* 洞察卡纵向堆叠时增加行间距 */
  .insights-row .el-col {
    margin-bottom: 16px;
  }

  .insights-row .el-col:last-child {
    margin-bottom: 0;
  }

  .insights-row :deep(.el-card__body) {
    overflow-y: visible;
  }
}
</style>
