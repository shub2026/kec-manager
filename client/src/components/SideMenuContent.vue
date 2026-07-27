<template>
  <!-- 侧边栏菜单内容（桌面 aside 与窄屏抽屉复用同一份） -->
  <!-- 首页概览（所有用户可见） -->
  <el-menu-item index="/dashboard">
    <el-icon><HomeFilled /></el-icon>
    <template #title>首页概览</template>
  </el-menu-item>

  <!-- 管理员菜单 -->
  <template v-if="authStore.isAdmin">
    <el-sub-menu index="basic">
      <template #title>
        <el-icon><Grid /></el-icon>
        <span>基础数据</span>
      </template>
      <el-menu-item index="/training-levels">培养层次</el-menu-item>
      <el-menu-item index="/majors">专业管理</el-menu-item>
      <el-menu-item index="/colleges">学院管理</el-menu-item>
      <el-menu-item index="/courses">课程管理</el-menu-item>
      <el-menu-item index="/textbooks">教材管理</el-menu-item>
      <el-menu-item index="/classes">班级管理</el-menu-item>
    </el-sub-menu>
    <el-menu-item index="/plans">
      <el-icon><Document /></el-icon>
      <template #title>培养方案</template>
    </el-menu-item>

    <!-- 教学安排模块 -->
    <el-sub-menu index="teaching">
      <template #title>
        <el-icon><Calendar /></el-icon>
        <span>教学安排</span>
      </template>
      <el-menu-item index="/teaching/teachers">教师信息</el-menu-item>
      <el-menu-item index="/teaching/arrange">教学安排</el-menu-item>
      <el-menu-item index="/teaching/statistics">课时统计</el-menu-item>
    </el-sub-menu>

    <!-- 系统管理菜单（超级管理员专属） -->
    <template v-if="authStore.userInfo?.role === 'super_admin'">
      <el-sub-menu index="system">
        <template #title>
          <el-icon><Tools /></el-icon>
          <span>系统管理</span>
        </template>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <template #title>系统设置</template>
        </el-menu-item>
        <el-menu-item index="/users">
          <el-icon><UserFilled /></el-icon>
          <template #title>用户管理</template>
        </el-menu-item>
        <el-menu-item index="/audit-logs">
          <el-icon><DocumentChecked /></el-icon>
          <template #title>操作日志</template>
        </el-menu-item>
      </el-sub-menu>
    </template>
  </template>

  <!-- 查询报表（所有用户可见） -->
  <el-sub-menu index="query">
    <template #title>
      <el-icon><DataAnalysis /></el-icon>
      <span>查询报表</span>
    </template>
    <el-menu-item index="/query/plan">方案查询</el-menu-item>
    <el-menu-item index="/query/semester">开课查询</el-menu-item>
    <el-menu-item index="/query/textbook">教材查询</el-menu-item>
  </el-sub-menu>
</template>

<script setup>
import { useAuthStore } from '../stores/auth';
const authStore = useAuthStore();
</script>
