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
    
    <el-card class="intro-card">
      <template #header>
        <div class="card-header">
          <span class="title">KEC 课程管理平台</span>
          <el-tag type="success" size="small">v{{ version }}</el-tag>
        </div>
      </template>
      <div class="intro-content">
        <p class="intro-text">
          KEC（Knowledge Education Course）课程管理平台是一套专为中小型教育机构设计的独立教学管理系统。
          平台提供从基础数据管理、班级编排、培养方案制定到教材调配的完整业务流程支持，帮助教务人员高效管理教学资源。
        </p>
        <el-divider />
        <el-row :gutter="20">
          <el-col :span="6">
            <div class="feature-item">
              <el-icon :size="24" color="#409EFF"><OfficeBuilding /></el-icon>
              <div class="feature-title">基础数据管理</div>
              <div class="feature-desc">学院、专业、培养层次三级管理体系</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="feature-item">
              <el-icon :size="24" color="#67C23A"><UserFilled /></el-icon>
              <div class="feature-title">班级与课程管理</div>
              <div class="feature-desc">智能年级推算，批量导入导出</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="feature-item">
              <el-icon :size="24" color="#E6A23C"><Document /></el-icon>
              <div class="feature-title">培养方案</div>
              <div class="feature-desc">可视化课程矩阵，多版本管理</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="feature-item">
              <el-icon :size="24" color="#F56C6C"><DataAnalysis /></el-icon>
              <div class="feature-title">查询与统计</div>
              <div class="feature-desc">开课查询、教材统计、审计日志</div>
            </div>
          </el-col>
        </el-row>
        
        <el-divider />
        <div class="copyright-footer">
          <p class="footer-line">
            <span>KEC 课程管理平台</span>
            <span class="footer-dot">·</span>
            <span>v{{ version }}</span>
            <span class="footer-dot">·</span>
            <span>Vue3 + Express5 + SQLite</span>
          </p>
          <p class="footer-line">
            <span>Copyright © 2026 Sntip.cn</span>
            <span class="footer-dot">·</span>
            <a href="mailto:Yangshubin@ztzyxy.cn">Yangshubin@ztzyxy.cn</a>
          </p>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { OfficeBuilding, UserFilled, Document, DataAnalysis, Message } from '@element-plus/icons-vue'
import { getMajors } from '../api/major'
import { getCourses } from '../api/course'
import { getTextbooks } from '../api/textbook'
import { getClassStats } from '../api/class'
import { getPlans } from '../api/plan'
import { getWithCache } from '../utils/cache'

const settingsStore = useSettingsStore()
const semesterLabel = computed(() => settingsStore.semesterLabel)
const stats = ref({ majors: 0, courses: 0, classes: 0, textbooks: 0, plans: 0, totalStudents: 0 })
const version = __APP_VERSION__

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
.semester-card {
  margin-bottom: 12px;
  flex-shrink: 0;
}
.intro-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.intro-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.intro-content {
  padding: 4px 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.title {
  font-size: 18px;
  font-weight: bold;
}
.intro-text {
  line-height: 1.6;
  color: #606266;
  font-size: 13px;
  margin: 0 0 8px 0;
}
.feature-item {
  text-align: center;
  padding: 10px 8px;
  border-radius: 8px;
  background-color: #f5f7fa;
  transition: all 0.3s;
}
.feature-item:hover {
  background-color: #ecf5ff;
  transform: translateY(-2px);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}
.feature-title {
  font-weight: bold;
  margin-top: 6px;
  color: #303133;
  font-size: 13px;
}
.feature-desc {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.4;
}
.intro-content :deep(.el-divider) {
  margin: 10px 0;
}
.copyright-footer {
  text-align: center;
  padding: 8px 0 0;
  color: #909399;
  font-size: 13px;
  line-height: 1.6;
  margin-top: auto;
}
.footer-line {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.footer-line:last-child {
  font-size: 12px;
  color: #b0b3b8;
}
.footer-dot {
  color: #c0c4cc;
}
.copyright-footer a {
  color: #909399;
  text-decoration: none;
}
.copyright-footer a:hover {
  color: #409eff;
}
</style>
