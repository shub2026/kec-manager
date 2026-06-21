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
        <el-button type="primary" @click="goToTeaching">
          <el-icon><EditPen /></el-icon>
          开始排课
        </el-button>
        <el-button @click="goToQuery">
          <el-icon><Search /></el-icon>
          查询开课
        </el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-card v-loading="loading" class="stats-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">
            <el-icon><DataLine /></el-icon>
            数据概览
          </span>
          <el-button text type="primary" :loading="loading" @click="refreshStats">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </template>

      <el-row :gutter="20">
        <!-- 专业类别 -->
        <el-col :xs="12" :sm="8" :md="6">
          <div class="stat-item" @click="goToMajor">
            <div class="stat-icon" style="background-color: #ecf5ff; color: #409eff">
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
          <div class="stat-item" @click="goToCourse">
            <div class="stat-icon" style="background-color: #f0f9eb; color: #67c23a">
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
          <div class="stat-item" @click="goToClass">
            <div class="stat-icon" style="background-color: #fdf6ec; color: #e6a23c">
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
          <div class="stat-item" @click="goToTextbook">
            <div class="stat-icon" style="background-color: #fef0f0; color: #f56c6c">
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
          <div class="stat-item" @click="goToPlan">
            <div class="stat-icon" style="background-color: #f4f4f5; color: #909399">
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
            <div class="stat-icon" style="background-color: #ecf5ff; color: #409eff">
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
          <div class="stat-item" @click="goToTeaching">
            <div class="stat-icon" style="background-color: #fdf6ec; color: #e6a23c">
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
          <div class="stat-item" @click="goToTeaching">
            <div class="stat-icon" style="background-color: #f0f9eb; color: #67c23a">
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

    <!-- 快捷操作 -->
    <el-card class="actions-card">
      <template #header>
        <span class="card-title">
          <el-icon><Lightning /></el-icon>
          快捷操作
        </span>
      </template>

      <el-row :gutter="20">
        <el-col v-if="canEdit" :xs="12" :sm="8" :md="6">
          <div class="action-item" @click="goToPlanEdit">
            <el-icon :size="28" color="#409EFF"><EditPen /></el-icon>
            <span>编辑培养方案</span>
          </div>
        </el-col>

        <el-col v-if="canEdit" :xs="12" :sm="8" :md="6">
          <div class="action-item" @click="goToTeaching">
            <el-icon :size="28" color="#67C23A"><SetUp /></el-icon>
            <span>智能排课</span>
          </div>
        </el-col>

        <el-col :xs="12" :sm="8" :md="6">
          <div class="action-item" @click="goToQuery">
            <el-icon :size="28" color="#E6A23C"><Search /></el-icon>
            <span>开课查询</span>
          </div>
        </el-col>

        <el-col :xs="12" :sm="8" :md="6">
          <div class="action-item" @click="goToTextbookQuery">
            <el-icon :size="28" color="#F56C6C"><Document /></el-icon>
            <span>教材查询</span>
          </div>
        </el-col>

        <el-col v-if="canEdit" :xs="12" :sm="8" :md="6">
          <div class="action-item" @click="goToImport">
            <el-icon :size="28" color="#909399"><Upload /></el-icon>
            <span>数据导入</span>
          </div>
        </el-col>

        <el-col v-if="canEdit" :xs="12" :sm="8" :md="6">
          <div class="action-item" @click="goToStatistics">
            <el-icon :size="28" color="#8B5CF6"><DataAnalysis /></el-icon>
            <span>课时统计</span>
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
              <el-icon color="#409EFF"><School /></el-icon>
              <div>
                <div class="feature-title">基础数据管理</div>
                <div class="feature-desc">学院、专业、培养层次、班级</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="#67C23A"><Reading /></el-icon>
              <div>
                <div class="feature-title">课程与教材管理</div>
                <div class="feature-desc">课程目录、教材信息、批量导入</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="#E6A23C"><Files /></el-icon>
              <div>
                <div class="feature-title">培养方案管理</div>
                <div class="feature-desc">课程矩阵、课时分配、教材关联</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="#F56C6C"><UserFilled /></el-icon>
              <div>
                <div class="feature-title">教师与智能排课</div>
                <div class="feature-desc">教师档案、排课偏好、自动分配</div>
              </div>
            </div>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <div class="feature-item">
              <el-icon color="#909399"><Search /></el-icon>
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
import {
  Calendar,
  EditPen,
  Search,
  DataLine,
  Refresh,
  OfficeBuilding,
  Reading,
  Histogram,
  Notebook,
  Files,
  User,
  UserFilled,
  Clock,
  Lightning,
  Document,
  Upload,
  DataAnalysis,
  Setting,
  InfoFilled,
  School,
} from '@element-plus/icons-vue';
import { getMajors } from '../api/major';
import { getCourses } from '../api/course';
import { getTextbooks } from '../api/textbook';
import { getClassStats } from '../api/class';
import { getPlans } from '../api/plan';
import { getTeachingStatistics } from '../api/teachingArrange';
import { getWithCache } from '../utils/cache';

const router = useRouter();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();

const version = __APP_VERSION__;
const loading = ref(false);
const canEdit = computed(() => ['admin', 'super_admin'].includes(authStore.userInfo?.role));

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
    const CACHE_TTL = 5 * 60 * 1000;
    const results = await Promise.allSettled([
      getWithCache(() => getMajors(), 'dashboard:majors', CACHE_TTL),
      getWithCache(() => getCourses(), 'dashboard:courses', CACHE_TTL),
      getWithCache(() => getTextbooks(), 'dashboard:textbooks', CACHE_TTL),
      getWithCache(() => getClassStats(), 'dashboard:classStats', CACHE_TTL),
      getWithCache(() => getPlans(), 'dashboard:plans', CACHE_TTL),
    ]);

    if (results[0].status === 'fulfilled') stats.value.majors = results[0].value.data?.length || 0;
    if (results[1].status === 'fulfilled') stats.value.courses = results[1].value.data?.length || 0;
    if (results[2].status === 'fulfilled')
      stats.value.textbooks = (results[2].value.data || []).filter((t) => t.isActive).length;
    if (results[3].status === 'fulfilled') {
      stats.value.classes = results[3].value.data?.totalClasses || 0;
      stats.value.totalStudents = results[3].value.data?.totalStudents || 0;
    }
    if (results[4].status === 'fulfilled') stats.value.plans = results[4].value.data?.length || 0;

    const semester = settingsStore.settings?.currentSemester?.value;
    if (semester) {
      try {
        const teachRes = await getWithCache(
          () => getTeachingStatistics({ semester }),
          'dashboard:teachingStats',
          CACHE_TTL
        );
        const summary = teachRes.data?.summary;
        if (summary) {
          stats.value.teachingTeachers = summary.totalTeachers || 0;
          stats.value.totalWeeklyHours = summary.totalWeeklyHours || 0;
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn('Teaching stats fetch failed:', e);
      }
    }
  } finally {
    loading.value = false;
  }
}

function refreshStats() {
  fetchStats();
}

function goToTeaching() {
  router.push('/teaching/arrange');
}

function goToQuery() {
  router.push('/query/semester');
}

function goToMajor() {
  router.push('/majors');
}

function goToCourse() {
  router.push('/courses');
}

function goToClass() {
  router.push('/classes');
}

function goToTextbook() {
  router.push('/textbooks');
}

function goToPlan() {
  router.push('/plans');
}

function goToPlanEdit() {
  router.push('/plans');
}

function goToTextbookQuery() {
  router.push('/query/textbook');
}

function goToImport() {
  ElMessage.info('数据导入功能开发中');
}

function goToStatistics() {
  router.push('/teaching/statistics');
}

onMounted(() => {
  fetchStats();
});
</script>

<style scoped>
.dashboard {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 欢迎区域 */
.welcome-section {
  background: #fff;
  padding: 24px;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.welcome-title {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}

.welcome-subtitle {
  margin: 0;
  font-size: 14px;
  color: #606266;
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
.actions-card,
.info-card {
  border-radius: 4px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 统计项 */
.stat-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: #fafbfc;
  border-radius: 4px;
  border: 1px solid #f0f0f0;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 20px;
}

.stat-item:hover {
  background: #fff;
  border-color: #dcdfe6;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}

.stat-icon {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-info {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 13px;
  color: #909399;
  font-weight: 500;
}

/* 快捷操作 */
.action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 16px;
  background: #fafbfc;
  border-radius: 4px;
  border: 1px solid #f0f0f0;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 20px;
  font-size: 14px;
  color: #606266;
}

.action-item:hover {
  background: #ecf5ff;
  border-color: #409eff;
  color: #409eff;
}

/* 平台信息 */
.platform-info {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #fafbfc;
  border-radius: 4px;
  margin-bottom: 12px;
}

.feature-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.feature-desc {
  font-size: 12px;
  color: #909399;
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
  color: #b0b3b8;
}

.footer-info a {
  color: #909399;
  text-decoration: none;
}

.footer-info a:hover {
  color: #409eff;
}

/* 响应式 */
@media (max-width: 768px) {
  .dashboard {
    padding: 12px;
    gap: 16px;
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
    font-size: 20px;
  }

  .stat-item {
    padding: 16px;
    gap: 12px;
  }

  .stat-icon {
    width: 44px;
    height: 44px;
  }

  .stat-value {
    font-size: 22px;
  }

  .action-item {
    padding: 16px 12px;
  }
}
</style>
