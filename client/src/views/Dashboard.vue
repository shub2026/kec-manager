<template>
  <div class="dashboard-container">
    <el-card v-if="semesterLabel" class="semester-card">
      <template #header>当前学期</template>
      <el-tag size="large" type="primary">{{ semesterLabel }}</el-tag>
    </el-card>
    
    <el-row :gutter="20" class="stat-row">
      <el-col :span="8">
        <el-card shadow="hover">
          <el-statistic title="专业类别" :value="stats.majors" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <el-statistic title="课程数量" :value="stats.courses" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <el-statistic title="班级数量" :value="stats.classes" />
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="20" class="stat-row">
      <el-col :span="8">
        <el-card shadow="hover">
          <el-statistic title="教材数量" :value="stats.textbooks" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <el-statistic title="培养方案" :value="stats.plans" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover">
          <el-statistic title="在读学生" :value="stats.totalStudents" />
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="20" class="stat-row">
      <el-col :span="8">
        <el-card shadow="hover" class="teaching-stat-card">
          <el-statistic title="参与教师" :value="stats.teachingTeachers" suffix="人" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="teaching-stat-card">
          <el-statistic title="总周课时" :value="stats.totalWeeklyHours" suffix="课时" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card shadow="hover" class="teaching-stat-card">
          <el-statistic title="总安排班级数" :value="stats.teachingClasses" suffix="个" />
        </el-card>
      </el-col>
    </el-row>
    
    <el-card class="intro-card" shadow="never">
      <div class="intro-header">
        <div class="intro-header-left">
          <h2 class="intro-title">KEC 课程管理平台</h2>
          <p class="intro-subtitle">专为中小型教育机构设计的独立教学管理系统</p>
        </div>
        <el-tag type="info" size="small" effect="plain" round>v{{ version }}</el-tag>
      </div>

      <div class="features-grid">
        <div class="feature-card" v-for="f in features" :key="f.title">
          <div class="feature-icon" :style="{ background: f.bg, color: f.color }">
            <el-icon :size="20"><component :is="f.icon" /></el-icon>
          </div>
          <div class="feature-body">
            <div class="feature-name">{{ f.title }}</div>
            <div class="feature-detail">{{ f.desc }}</div>
          </div>
        </div>
      </div>

      <div class="intro-footer">
        <span>Vue3 + Express5 + SQLite</span>
        <span class="footer-sep">|</span>
        <span>Copyright &copy; 2026 Sntip.cn</span>
        <span class="footer-sep">|</span>
        <a href="mailto:Yangshubin@ztzyxy.cn">Yangshubin@ztzyxy.cn</a>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, markRaw } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { OfficeBuilding, UserFilled, Document, DataAnalysis } from '@element-plus/icons-vue'
import { getMajors } from '../api/major'
import { getCourses } from '../api/course'
import { getTextbooks } from '../api/textbook'
import { getClassStats } from '../api/class'
import { getPlans } from '../api/plan'
import { getTeachingStatistics } from '../api/teachingArrange'
import { getWithCache } from '../utils/cache'

const settingsStore = useSettingsStore()
const semesterLabel = computed(() => settingsStore.semesterLabel)
const stats = ref({ majors: 0, courses: 0, classes: 0, textbooks: 0, plans: 0, totalStudents: 0, teachingTeachers: 0, totalWeeklyHours: 0, teachingClasses: 0 })
const version = __APP_VERSION__

const features = [
  { title: '基础数据管理', desc: '学院、专业、培养层次三级管理体系', icon: markRaw(OfficeBuilding), color: '#409EFF', bg: '#ecf5ff' },
  { title: '班级与课程管理', desc: '智能年级推算，批量导入导出', icon: markRaw(UserFilled), color: '#67C23A', bg: '#f0f9eb' },
  { title: '培养方案', desc: '可视化课程矩阵，多版本管理', icon: markRaw(Document), color: '#E6A23C', bg: '#fdf6ec' },
  { title: '查询与统计', desc: '开课查询、教材统计、审计日志', icon: markRaw(DataAnalysis), color: '#F56C6C', bg: '#fef0f0' },
]

onMounted(async () => {
  try {
    // 使用缓存减少重复请求，缓存时间5分钟
    const CACHE_TTL = 5 * 60 * 1000
    
    const results = await Promise.allSettled([
      getWithCache(() => getMajors(), 'dashboard:majors', CACHE_TTL),
      getWithCache(() => getCourses(), 'dashboard:courses', CACHE_TTL),
      getWithCache(() => getTextbooks(), 'dashboard:textbooks', CACHE_TTL),
      getWithCache(() => getClassStats(), 'dashboard:classStats', CACHE_TTL),
      getWithCache(() => getPlans(), 'dashboard:plans', CACHE_TTL),
    ])
    
    // 处理每个结果，失败时使用默认值
    if (results[0].status === 'fulfilled') stats.value.majors = results[0].value.data?.length || 0
    if (results[1].status === 'fulfilled') stats.value.courses = results[1].value.data?.length || 0
    if (results[2].status === 'fulfilled') stats.value.textbooks = (results[2].value.data || []).filter(t => t.isActive).length
    if (results[3].status === 'fulfilled') {
      stats.value.classes = results[3].value.data?.totalClasses || 0
      stats.value.totalStudents = results[3].value.data?.totalStudents || 0
    }
    if (results[4].status === 'fulfilled') stats.value.plans = results[4].value.data?.length || 0

    // 获取课时统计（需要当前学期）
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

    // 记录失败的请求（开发环境）
    if (import.meta.env.DEV) {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(`Dashboard data fetch failed for item ${index}:`, result.reason)
        }
      })
    }
  } catch (e) { 
    if (import.meta.env.DEV) {
      console.error('Dashboard data fetch error:', e) 
    }
  }
})
</script>

<style scoped>
.dashboard-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.stat-row {
  margin-bottom: 12px;
}
.teaching-stat-card {
  border-top: 3px solid #E6A23C;
}
.semester-card {
  margin-bottom: 12px;
  flex-shrink: 0;
}

/* 介绍卡片 */
.intro-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #e8eaed;
  border-radius: 12px;
}
.intro-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
}

/* 头部区域 */
.intro-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}
.intro-title {
  margin: 0 0 4px 0;
  font-size: 20px;
  font-weight: 700;
  color: #1a1a2e;
  letter-spacing: 0.5px;
}
.intro-subtitle {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

/* 功能模块网格 */
.features-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 24px;
}
.feature-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 10px;
  border: 1px solid #f0f0f0;
  background: #fafbfc;
  transition: all 0.25s ease;
}
.feature-card:hover {
  background: #fff;
  border-color: #dcdfe6;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}
.feature-icon {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.feature-body {
  min-width: 0;
}
.feature-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 3px;
}
.feature-detail {
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}

/* 底部 */
.intro-footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
  text-align: center;
  font-size: 12px;
  color: #b0b3b8;
}
.intro-footer a {
  color: #909399;
  text-decoration: none;
  transition: color 0.2s;
}
.intro-footer a:hover {
  color: #409eff;
}
.footer-sep {
  margin: 0 8px;
  color: #dcdfe6;
}
</style>
