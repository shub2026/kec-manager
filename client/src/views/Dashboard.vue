<template>
  <div class="dashboard-container">
    <!-- 当前学期 -->
    <el-card v-if="semesterLabel" class="semester-card">
      <template #header>当前学期</template>
      <el-tag size="large" type="primary">{{ semesterLabel }}</el-tag>
    </el-card>

    <!-- 统计数字 -->
    <el-row :gutter="20" class="stat-row">
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="专业类别" :value="stats.majors" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="课程数量" :value="stats.courses" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="班级数量" :value="stats.classes" />
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="20" class="stat-row">
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="教材数量" :value="stats.textbooks" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="培养方案" :value="stats.plans" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card">
          <el-statistic title="在读学生" :value="stats.totalStudents" />
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="20" class="stat-row">
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card teaching-stat-card">
          <el-statistic title="参与教师" :value="stats.teachingTeachers" suffix="人" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card teaching-stat-card">
          <el-statistic title="总周课时" :value="stats.totalWeeklyHours" suffix="课时" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="stat-card teaching-stat-card">
          <el-statistic title="已安排班级" :value="stats.teachingClasses" suffix="个" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 平台介绍（核心重构区） -->
    <el-card class="intro-card" shadow="never">
      <!-- 头部 Hero -->
      <div class="intro-hero">
        <div class="intro-hero-left">
          <div class="intro-brand">
            <span class="intro-logo">KEC</span>
            <span class="intro-logo-sub">Course Manager</span>
          </div>
          <h2 class="intro-title">智能课程管理平台</h2>
          <p class="intro-tagline">面向中小型教育机构的全方位教学管理系统，覆盖从培养方案到排课统计的全流程</p>
          <div class="intro-tags">
            <el-tag size="small" type="primary" effect="plain">v{{ version }}</el-tag>
            <el-tag size="small" type="success" effect="plain">活跃维护</el-tag>
            <el-tag size="small" type="info" effect="plain">MIT 开源</el-tag>
          </div>
        </div>
        <div class="intro-hero-right">
          <div class="intro-tech-stack">
            <div class="tech-item"><span class="tech-dot vue" />Vue 3</div>
            <div class="tech-item"><span class="tech-dot ep" />Element Plus</div>
            <div class="tech-item"><span class="tech-dot node" />Express 5</div>
            <div class="tech-item"><span class="tech-dot prisma" />Prisma ORM</div>
            <div class="tech-item"><span class="tech-dot sqlite" />SQLite / MySQL</div>
            <div class="tech-item"><span class="tech-dot docker" />Docker Ready</div>
          </div>
        </div>
      </div>

      <!-- 功能全景 -->
      <div class="intro-section">
        <div class="section-header">
          <h3 class="section-title">功能全景</h3>
          <p class="section-desc">六大核心模块，覆盖教学管理全生命周期</p>
        </div>
        <div class="module-grid">
          <!-- 模块 1：基础数据 -->
          <div class="module-card">
            <div class="module-icon" style="background:#ecf5ff;color:#409EFF">
              <el-icon :size="22"><OfficeBuilding /></el-icon>
            </div>
            <div class="module-body">
              <div class="module-name">基础数据管理</div>
              <div class="module-desc">构建完整的教学基础数据库，支持学院、专业、培养层次三级体系</div>
              <div class="module-tags">
                <el-tag size="small" effect="plain">学院管理</el-tag>
                <el-tag size="small" effect="plain">专业管理</el-tag>
                <el-tag size="small" effect="plain">培养层次</el-tag>
                <el-tag size="small" effect="plain">班级管理</el-tag>
              </div>
            </div>
          </div>

          <!-- 模块 2：课程与教材 -->
          <div class="module-card">
            <div class="module-icon" style="background:#f0f9eb;color:#67C23A">
              <el-icon :size="22"><Notebook /></el-icon>
            </div>
            <div class="module-body">
              <div class="module-name">课程与教材管理</div>
              <div class="module-desc">维护课程目录与教材信息，支持多教材关联、批量导入导出</div>
              <div class="module-tags">
                <el-tag size="small" effect="plain">课程目录</el-tag>
                <el-tag size="small" effect="plain">教材管理</el-tag>
                <el-tag size="small" effect="plain">批量导入</el-tag>
                <el-tag size="small" effect="plain">Excel 导出</el-tag>
              </div>
            </div>
          </div>

          <!-- 模块 3：培养方案 -->
          <div class="module-card">
            <div class="module-icon" style="background:#fdf6ec;color:#E6A23C">
              <el-icon :size="22"><Files /></el-icon>
            </div>
            <div class="module-body">
              <div class="module-name">培养方案管理</div>
              <div class="module-desc">可视化课程矩阵编辑各学期课时分布，支持多版本方案对比</div>
              <div class="module-tags">
                <el-tag size="small" effect="plain">课程矩阵</el-tag>
                <el-tag size="small" effect="plain">多版本管理</el-tag>
                <el-tag size="small" effect="plain">课时分配</el-tag>
                <el-tag size="small" effect="plain">教材关联</el-tag>
              </div>
            </div>
          </div>

          <!-- 模块 4：教师与排课 -->
          <div class="module-card">
            <div class="module-icon" style="background:#fef0f0;color:#F56C6C">
              <el-icon :size="22"><UserFilled /></el-icon>
            </div>
            <div class="module-body">
              <div class="module-name">教师与智能排课</div>
              <div class="module-desc">教师档案管理，支持学院/层次排课偏好配置；内置多阶段匹配算法，自动完成排课</div>
              <div class="module-tags">
                <el-tag size="small" effect="plain">教师档案</el-tag>
                <el-tag size="small" effect="plain">排课偏好</el-tag>
                <el-tag size="small" effect="plain">自动排课</el-tag>
                <el-tag size="small" effect="plain">手动调整</el-tag>
                <el-tag size="small" effect="plain">批量排课</el-tag>
              </div>
            </div>
          </div>

          <!-- 模块 5：查询与统计 -->
          <div class="module-card">
            <div class="module-icon" style="background:#f4ecff;color:#8B5CF6">
              <el-icon :size="22"><DataAnalysis /></el-icon>
            </div>
            <div class="module-body">
              <div class="module-name">查询与统计分析</div>
              <div class="module-desc">多维度数据查询，实时课时统计，教材使用分析，支持历史学期回溯</div>
              <div class="module-tags">
                <el-tag size="small" effect="plain">开课查询</el-tag>
                <el-tag size="small" effect="plain">教材查询</el-tag>
                <el-tag size="small" effect="plain">课时统计</el-tag>
                <el-tag size="small" effect="plain">历史回溯</el-tag>
              </div>
            </div>
          </div>

          <!-- 模块 6：系统管理 -->
          <div class="module-card">
            <div class="module-icon" style="background:#e8faf0;color:#0CA678">
              <el-icon :size="22"><Setting /></el-icon>
            </div>
            <div class="module-body">
              <div class="module-name">系统管理</div>
              <div class="module-desc">三级角色权限体系，学期配置，数据重置，完整审计日志追踪所有操作</div>
              <div class="module-tags">
                <el-tag size="small" effect="plain">用户管理</el-tag>
                <el-tag size="small" effect="plain">角色权限</el-tag>
                <el-tag size="small" effect="plain">审计日志</el-tag>
                <el-tag size="small" effect="plain">学期配置</el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 核心亮点 -->
      <div class="intro-section">
        <div class="section-header">
          <h3 class="section-title">核心亮点</h3>
          <p class="section-desc">为教育机构量身打造，注重实用性与易用性</p>
        </div>
        <div class="highlights-grid">
          <div class="highlight-item">
            <div class="highlight-icon">🎯</div>
            <div class="highlight-body">
              <div class="highlight-name">智能排课算法</div>
              <div class="highlight-desc">多阶段匹配策略，综合考虑学院偏好、培养层次、教材内聚度，最大化排课成功率</div>
            </div>
          </div>
          <div class="highlight-item">
            <div class="highlight-icon">📊</div>
            <div class="highlight-body">
              <div class="highlight-name">可视化课程矩阵</div>
              <div class="highlight-desc">培养方案以矩阵形式直观展示，点击即可编辑各学期课时，操作简单高效</div>
            </div>
          </div>
          <div class="highlight-item">
            <div class="highlight-icon">🔄</div>
            <div class="highlight-body">
              <div class="highlight-name">Excel 双向互通</div>
              <div class="highlight-desc">支持班级、课程、教材、教师数据的批量导入与多维度导出，无缝对接现有表格</div>
            </div>
          </div>
          <div class="highlight-item">
            <div class="highlight-icon">📝</div>
            <div class="highlight-body">
              <div class="highlight-name">完整审计追踪</div>
              <div class="highlight-desc">所有增删改操作自动记录，支持按用户、模块、时间筛选，责任可追溯</div>
            </div>
          </div>
          <div class="highlight-item">
            <div class="highlight-icon">🏗️</div>
            <div class="highlight-body">
              <div class="highlight-name">灵活部署方案</div>
              <div class="highlight-desc">支持 Docker Compose 一键部署或裸机 PM2 部署，最低 1 核 2GB 即可运行</div>
            </div>
          </div>
          <div class="highlight-item">
            <div class="highlight-icon">🔐</div>
            <div class="highlight-body">
              <div class="highlight-name">安全权限体系</div>
              <div class="highlight-desc">JWT 双令牌认证，三级角色权限隔离，API 层 XSS 防护与操作鉴权</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部信息 -->
      <div class="intro-footer">
        <div class="footer-left">
          <span>© 2026 KEC Course Manager</span>
          <el-divider direction="vertical" />
          <a href="mailto:Yangshubin@ztzyxy.cn">Yangshubin@ztzyxy.cn</a>
          <el-divider direction="vertical" />
          <a href="https://sntip.cn" target="_blank">sntip.cn</a>
        </div>
        <div class="footer-right">
          <span class="footer-tech">Vue 3 + Element Plus + Express + Prisma</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { OfficeBuilding, UserFilled, Files, DataAnalysis, Setting, Notebook } from '@element-plus/icons-vue'
import { getMajors } from '../api/major'
import { getCourses } from '../api/course'
import { getTextbooks } from '../api/textbook'
import { getClassStats } from '../api/class'
import { getPlans } from '../api/plan'
import { getTeachingStatistics } from '../api/teachingArrange'
import { getWithCache } from '../utils/cache'

const settingsStore = useSettingsStore()
const semesterLabel = computed(() => settingsStore.semesterLabel)
const stats = ref({
  majors: 0, courses: 0, classes: 0, textbooks: 0,
  plans: 0, totalStudents: 0,
  teachingTeachers: 0, totalWeeklyHours: 0, teachingClasses: 0,
})
const version = __APP_VERSION__

onMounted(async () => {
  try {
    const CACHE_TTL = 5 * 60 * 1000

    const results = await Promise.allSettled([
      getWithCache(() => getMajors(), 'dashboard:majors', CACHE_TTL),
      getWithCache(() => getCourses(), 'dashboard:courses', CACHE_TTL),
      getWithCache(() => getTextbooks(), 'dashboard:textbooks', CACHE_TTL),
      getWithCache(() => getClassStats(), 'dashboard:classStats', CACHE_TTL),
      getWithCache(() => getPlans(), 'dashboard:plans', CACHE_TTL),
    ])

    if (results[0].status === 'fulfilled') stats.value.majors = results[0].value.data?.length || 0
    if (results[1].status === 'fulfilled') stats.value.courses = results[1].value.data?.length || 0
    if (results[2].status === 'fulfilled') stats.value.textbooks = (results[2].value.data || []).filter(t => t.isActive).length
    if (results[3].status === 'fulfilled') {
      stats.value.classes = results[3].value.data?.totalClasses || 0
      stats.value.totalStudents = results[3].value.data?.totalStudents || 0
    }
    if (results[4].status === 'fulfilled') stats.value.plans = results[4].value.data?.length || 0

    const semester = settingsStore.settings?.currentSemester?.value
    if (semester) {
      try {
        const teachRes = await getWithCache(() => getTeachingStatistics({ semester }), 'dashboard:teachingStats', CACHE_TTL)
        const summary = teachRes.data?.summary
        if (summary) {
          stats.value.teachingTeachers = summary.totalTeachers || 0
          stats.value.totalWeeklyHours = summary.totalWeeklyHours || 0
          stats.value.teachingClasses = summary.totalClasses || 0
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn('Teaching stats fetch failed:', e)
      }
    }

    if (import.meta.env.DEV) {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(`Dashboard data fetch failed for item ${index}:`, result.reason)
        }
      })
    }
  } catch (e) {
    if (import.meta.env.DEV) console.error('Dashboard data fetch error:', e)
  }
})
</script>

<style scoped>
.dashboard-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.stat-row {
  margin-bottom: 0 !important;
}
.stat-card {
  border-radius: 10px;
  transition: all 0.25s ease;
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08) !important;
}
.teaching-stat-card {
  border-top: 3px solid #E6A23C;
}
.semester-card {
  flex-shrink: 0;
}

/* ===== 介绍卡片整体 ===== */
.intro-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #e8eaed;
  border-radius: 14px;
  overflow: hidden;
}
.intro-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0;
}

/* ===== Hero 头部 ===== */
.intro-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 32px;
  padding: 32px 32px 28px;
  background: linear-gradient(135deg, #f8faff 0%, #f0f4ff 50%, #faf8ff 100%);
  border-bottom: 1px solid #e8eaed;
}
.intro-hero-left {
  flex: 1;
}
.intro-brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}
.intro-logo {
  font-size: 28px;
  font-weight: 800;
  color: #409EFF;
  letter-spacing: 2px;
}
.intro-logo-sub {
  font-size: 13px;
  color: #909399;
  font-weight: 500;
}
.intro-title {
  margin: 0 0 8px 0;
  font-size: 22px;
  font-weight: 700;
  color: #1a1a2e;
}
.intro-tagline {
  margin: 0 0 14px 0;
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
  max-width: 520px;
}
.intro-tags {
  display: flex;
  gap: 8px;
}
.intro-hero-right {
  flex-shrink: 0;
}
.intro-tech-stack {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 20px;
}
.tech-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
}
.tech-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tech-dot.vue { background: #42b883; }
.tech-dot.ep { background: #409EFF; }
.tech-dot.node { background: #67c23a; }
.tech-dot.prisma { background: #0CA678; }
.tech-dot.sqlite { background: #F56C6C; }
.tech-dot.docker { background: #2496ED; }

/* ===== 通用 section ===== */
.intro-section {
  padding: 28px 32px;
  border-bottom: 1px solid #f0f0f0;
}
.intro-section:last-of-type {
  border-bottom: none;
}
.section-header {
  margin-bottom: 20px;
}
.section-title {
  margin: 0 0 6px 0;
  font-size: 17px;
  font-weight: 700;
  color: #1a1a2e;
}
.section-desc {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

/* ===== 功能模块网格 ===== */
.module-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.module-card {
  display: flex;
  gap: 16px;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  background: #fafbfc;
  transition: all 0.25s ease;
}
.module-card:hover {
  background: #fff;
  border-color: #dcdfe6;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}
.module-icon {
  flex-shrink: 0;
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.module-body {
  min-width: 0;
  flex: 1;
}
.module-name {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}
.module-desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-bottom: 10px;
}
.module-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* ===== 核心亮点网格 ===== */
.highlights-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
}
.highlight-item {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-radius: 10px;
  background: #fafbfc;
  border: 1px solid #f0f0f0;
  transition: all 0.2s ease;
}
.highlight-item:hover {
  background: #fff;
  border-color: #dcdfe6;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.highlight-icon {
  flex-shrink: 0;
  font-size: 24px;
  line-height: 1;
  margin-top: 2px;
}
.highlight-body {
  min-width: 0;
}
.highlight-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}
.highlight-desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

/* ===== 底部 ===== */
.intro-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 32px;
  background: #fafbfc;
  border-top: 1px solid #f0f0f0;
  font-size: 12px;
  color: #b0b3b8;
}
.footer-left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.footer-left a {
  color: #909399;
  text-decoration: none;
  transition: color 0.2s;
}
.footer-left a:hover {
  color: #409eff;
}
.footer-tech {
  color: #b0b3b8;
  font-size: 11px;
}

/* ===== 响应式 ===== */
@media (max-width: 900px) {
  .intro-hero {
    flex-direction: column;
    align-items: flex-start;
  }
  .module-grid {
    grid-template-columns: 1fr;
  }
  .highlights-grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 600px) {
  .highlights-grid {
    grid-template-columns: 1fr;
  }
  .intro-hero {
    padding: 20px;
  }
  .intro-section {
    padding: 20px;
  }
}
</style>
