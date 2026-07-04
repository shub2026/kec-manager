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
      <el-row v-else :gutter="20">
        <!-- 专业类别 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div
            class="stat-item"
            role="button"
            tabindex="0"
            @click="navigateTo('/majors')"
            @keyup.enter="navigateTo('/majors')"
          >
            <div class="stat-icon" style="background-color: var(--brand-primary-soft); color: var(--brand-primary)">
              <el-icon :size="24"><OfficeBuilding /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.majors }}</div>
              <div class="stat-label">专业类别</div>
            </div>
          </div>
        </el-col>

        <!-- 课程数量 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div
            class="stat-item"
            role="button"
            tabindex="0"
            @click="navigateTo('/courses')"
            @keyup.enter="navigateTo('/courses')"
          >
            <div class="stat-icon" style="background-color: var(--brand-success-soft); color: var(--brand-success)">
              <el-icon :size="24"><Reading /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.courses }}</div>
              <div class="stat-label">课程数量</div>
            </div>
          </div>
        </el-col>

        <!-- 班级数量 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div
            class="stat-item"
            role="button"
            tabindex="0"
            @click="navigateTo('/classes')"
            @keyup.enter="navigateTo('/classes')"
          >
            <div class="stat-icon" style="background-color: var(--brand-warning-soft); color: var(--brand-warning)">
              <el-icon :size="24"><Histogram /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.classes }}</div>
              <div class="stat-label">班级数量</div>
            </div>
          </div>
        </el-col>

        <!-- 活跃教材 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div
            class="stat-item"
            role="button"
            tabindex="0"
            @click="navigateTo('/textbooks')"
            @keyup.enter="navigateTo('/textbooks')"
          >
            <div class="stat-icon" style="background-color: var(--brand-danger-soft); color: var(--brand-danger)">
              <el-icon :size="24"><Notebook /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.textbooks }}</div>
              <div class="stat-label">活跃教材</div>
            </div>
          </div>
        </el-col>

        <!-- 培养方案 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div
            class="stat-item"
            role="button"
            tabindex="0"
            @click="navigateTo('/plans')"
            @keyup.enter="navigateTo('/plans')"
          >
            <div class="stat-icon" style="background-color: var(--bg-subtle); color: var(--text-secondary)">
              <el-icon :size="24"><Files /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.plans }}</div>
              <div class="stat-label">培养方案</div>
            </div>
          </div>
        </el-col>

        <!-- 在读学生 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div class="stat-item">
            <div class="stat-icon" style="background-color: var(--brand-primary-soft); color: var(--brand-primary)">
              <el-icon :size="24"><User /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalStudents }}</div>
              <div class="stat-label">在读学生</div>
            </div>
          </div>
        </el-col>

        <!-- 参与教师 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div
            class="stat-item"
            role="button"
            tabindex="0"
            @click="navigateTo('/teaching/arrange')"
            @keyup.enter="navigateTo('/teaching/arrange')"
          >
            <div class="stat-icon" style="background-color: var(--brand-warning-soft); color: var(--brand-warning)">
              <el-icon :size="24"><UserFilled /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.teachingTeachers }}</div>
              <div class="stat-label">参与教师</div>
            </div>
          </div>
        </el-col>

        <!-- 总周课时 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div
            class="stat-item"
            role="button"
            tabindex="0"
            @click="navigateTo('/teaching/arrange')"
            @keyup.enter="navigateTo('/teaching/arrange')"
          >
            <div class="stat-icon" style="background-color: var(--brand-success-soft); color: var(--brand-success)">
              <el-icon :size="24"><Clock /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalWeeklyHours }}</div>
              <div class="stat-label">总周课时</div>
            </div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 平台信息 -->
    <el-card class="info-card">
      <template #header>
        <span class="card-title">
          <el-icon><InfoFilled /></el-icon>
          关于 KEC 课程管理平台
        </span>
      </template>

      <div class="platform-info">
        <p>
          KEC
          课程管理平台是一款面向教育机构的全方位教学管理系统，涵盖基础数据管理、培养方案制定、智能排课、查询统计等核心功能。
        </p>

        <el-divider content-position="left">核心功能</el-divider>

        <el-row :gutter="20">
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="var(--brand-primary)"><School /></el-icon>
              <div>
                <div class="feature-title">基础数据管理</div>
                <div class="feature-desc">学院、专业、培养层次、班级</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="var(--brand-success)"><Reading /></el-icon>
              <div>
                <div class="feature-title">课程与教材管理</div>
                <div class="feature-desc">课程目录、教材信息、批量导入</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="var(--brand-warning)"><Files /></el-icon>
              <div>
                <div class="feature-title">培养方案管理</div>
                <div class="feature-desc">课程矩阵、课时分配、教材关联</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="var(--brand-danger)"><UserFilled /></el-icon>
              <div>
                <div class="feature-title">教师与智能排课</div>
                <div class="feature-desc">教师档案、排课偏好、自动分配</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="var(--text-secondary)"><Search /></el-icon>
              <div>
                <div class="feature-title">查询与统计分析</div>
                <div class="feature-desc">开课查询、教材查询、课时统计</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="#8B5CF6"><Setting /></el-icon>
              <div>
                <div class="feature-title">系统管理</div>
                <div class="feature-desc">用户管理、角色权限、审计日志</div>
              </div>
            </div>
          </el-col>
        </el-row>

        <el-divider content-position="left">技术栈</el-divider>

        <div class="tech-stack">
          <el-tag type="primary" effect="plain">Vue 3</el-tag>
          <el-tag type="success" effect="plain">Element Plus</el-tag>
          <el-tag type="warning" effect="plain">Express 5</el-tag>
          <el-tag type="danger" effect="plain">Prisma ORM</el-tag>
          <el-tag type="info" effect="plain">SQLite/MySQL</el-tag>
        </div>

        <el-divider />

        <div class="footer-info">
          <span>© 2026 KEC Course Manager v{{ version }}</span>
          <el-divider direction="vertical" />
          <a href="mailto:Yangshubin@ztzyxy.cn">Yangshubin@ztzyxy.cn</a>
          <el-divider direction="vertical" />
          <a href="https://sntip.cn" target="_blank">sntip.cn</a>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { getDashboardStats } from '../api/dashboard';
import { getWithCache } from '../utils/cache';

const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

const version = __APP_VERSION__;
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

async function fetchStats() {
  loading.value = true;
  try {
    let semester = settingsStore.settings?.currentSemester?.value;
    // settings 尚未加载完成时，强制重新拉取一次（避免首次竞态导致 semester 为空）
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

// 统一导航函数，替代 8 个独立的 goTo* 函数
function navigateTo(path) {
  router.push(path);
}

onMounted(async () => {
  loading.value = true; // 立即显示骨架屏，避免首次渲染闪现全 0 数据
  await settingsStore.load();
  await fetchStats();
});
</script>

<style scoped>
.dashboard {
  max-width: 1400px;
  margin: 0 auto;
  min-height: calc(100vh - 92px - 32px);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 欢迎区域 */
.welcome-section {
  background: var(--bg-card);
  padding: 16px 24px;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  flex-shrink: 0;
}

.welcome-title {
  margin: 0 0 4px 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.welcome-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--text-regular);
  display: flex;
  align-items: center;
  gap: 6px;
}

.welcome-actions {
  display: flex;
  gap: 12px;
}

/* 卡片通用样式 */
.stats-card,
.info-card {
  border-radius: var(--radius-sm);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 统计项 */
.stat-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 12px;
}

.stat-item:hover {
  background: var(--bg-card);
  border-color: var(--border-light);
  box-shadow: var(--shadow-md);
}

.stat-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-info {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  margin-bottom: 2px;
}

.stat-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

/* 平台信息 */
.platform-info {
  font-size: 14px;
  color: var(--text-regular);
  line-height: 1.6;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
}

.feature-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.feature-desc {
  font-size: 11px;
  color: var(--text-secondary);
}

.tech-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.footer-info {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.footer-info a {
  color: var(--text-secondary);
  text-decoration: none;
}

.footer-info a:hover {
  color: var(--brand-primary);
}

/* 响应式 */
@media (max-width: 768px) {
  .dashboard {
    padding: 12px;
    gap: 12px;
  }

  .welcome-section {
    flex-direction: column;
    align-items: flex-start;
  }

  .welcome-actions {
    width: 100%;
  }

  .welcome-actions .el-button {
    flex: 1;
  }

  .welcome-title {
    font-size: 18px;
  }

  .stat-item {
    padding: 10px 12px;
    gap: 10px;
  }

  .stat-icon {
    width: 36px;
    height: 36px;
  }

  .stat-value {
    font-size: 18px;
  }
}
</style>
