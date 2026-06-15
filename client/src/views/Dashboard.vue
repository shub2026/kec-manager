<template>
  <div>
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
          <p>Copyright © 2026 Sntip.cn &nbsp; Yangshubin@ztzyxy.cn &nbsp; <a href="https://gitee.com/shub77/kec-manager" target="_blank" class="github-icon-link"><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a></p>
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
    
    const [majorsRes, coursesRes, textbooksRes, classStatsRes, plansRes] = await Promise.all([
      getWithCache(() => getMajors(), 'dashboard:majors', CACHE_TTL),
      getWithCache(() => getCourses(), 'dashboard:courses', CACHE_TTL),
      getWithCache(() => getTextbooks(), 'dashboard:textbooks', CACHE_TTL),
      getWithCache(() => getClassStats(), 'dashboard:classStats', CACHE_TTL),
      getWithCache(() => getPlans(), 'dashboard:plans', CACHE_TTL),
    ])
    
    stats.value.majors = majorsRes.data?.length || 0
    stats.value.courses = coursesRes.data?.length || 0
    stats.value.textbooks = (textbooksRes.data || []).filter(t => t.isActive).length
    
    // 在读班级数和在读学生数（已排除离校和已毕业）
    stats.value.classes = classStatsRes.data?.totalClasses || 0
    stats.value.plans = plansRes.data?.length || 0
    stats.value.totalStudents = classStatsRes.data?.totalStudents || 0
  } catch (e) { 
    console.error('Dashboard data fetch error:', e) 
  }
})
</script>

<style scoped>
.stat-row {
  margin-bottom: 20px;
}
.semester-card {
  margin-bottom: 20px;
}
.intro-card {
  margin-bottom: 20px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.title {
  font-size: 18px;
  font-weight: bold;
}
.intro-content {
  padding: 10px 0;
}
.intro-text {
  line-height: 1.8;
  color: #606266;
  font-size: 14px;
  margin: 0 0 15px 0;
}
.feature-item {
  text-align: center;
  padding: 15px 10px;
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
  margin-top: 10px;
  color: #303133;
  font-size: 14px;
}
.feature-desc {
  color: #909399;
  font-size: 12px;
  margin-top: 5px;
  line-height: 1.5;
}
.copyright-footer {
  text-align: center;
  padding: 16px 0 8px;
  color: #909399;
  font-size: 13px;
  line-height: 1.6;
}
.copyright-footer a {
  color: #909399;
  text-decoration: none;
}
.copyright-footer a:hover {
  color: #409eff;
  text-decoration: underline;
}
.github-icon-link {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}
.github-icon-link svg {
  transition: color 0.2s;
}
.github-icon-link:hover svg {
  color: #409eff;
}
</style>
