#!/bin/bash

# ============================================
# KEC Manager - 架构重构回归测试脚本
# 用途：验证所有API端点在重构后功能正常
# ============================================

set -e  # 遇到错误立即退出

BASE_URL="http://localhost:3000/api"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="admin123"
VIEWER_USERNAME="viewer"
VIEWER_PASSWORD="viewer123"

echo "=========================================="
echo "KEC Manager - 架构重构回归测试"
echo "=========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试计数器
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 辅助函数：打印测试结果
print_result() {
  local test_name=$1
  local status=$2
  
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  
  if [ $status -eq 0 ]; then
    echo -e "${GREEN}✓ PASS${NC}: $test_name"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    echo -e "${RED}✗ FAIL${NC}: $test_name"
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi
}

# 等待服务器启动
echo "等待服务器启动..."
sleep 3

# 测试1：健康检查
echo ""
echo "【1. 基础健康检查】"
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
if [ "$HEALTH_STATUS" = "200" ]; then
  print_result "健康检查端点" 0
else
  print_result "健康检查端点 (HTTP $HEALTH_STATUS)" 1
fi

# 测试2：用户登录
echo ""
echo "【2. 认证模块测试】"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}")

ADMIN_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.data.accessToken')
if [ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "null" ]; then
  print_result "管理员登录" 0
else
  print_result "管理员登录" 1
  echo "错误响应: $LOGIN_RESPONSE"
  exit 1
fi

# 获取Viewer Token
VIEWER_LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$VIEWER_USERNAME\",\"password\":\"$VIEWER_PASSWORD\"}")

VIEWER_TOKEN=$(echo $VIEWER_LOGIN_RESPONSE | jq -r '.data.accessToken')
if [ -n "$VIEWER_TOKEN" ] && [ "$VIEWER_TOKEN" != "null" ]; then
  print_result "访客登录" 0
else
  print_result "访客登录" 1
fi

# 测试3：获取当前用户信息
echo ""
echo "【3. 用户信息测试】"
ME_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/auth/me")
ME_STATUS=$(echo $ME_RESPONSE | jq -r '.success')
if [ "$ME_STATUS" = "true" ]; then
  print_result "获取当前用户信息" 0
else
  print_result "获取当前用户信息" 1
fi

# 测试4：基础数据模块
echo ""
echo "【4. 基础数据模块测试】"

# 学院管理
COLLEGES_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/colleges")
COLLEGES_STATUS=$(echo $COLLEGES_RESPONSE | jq -r '.success')
if [ "$COLLEGES_STATUS" = "true" ]; then
  print_result "获取学院列表" 0
else
  print_result "获取学院列表" 1
fi

# 专业管理
MAJORS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/majors")
MAJORS_STATUS=$(echo $MAJORS_RESPONSE | jq -r '.success')
if [ "$MAJORS_STATUS" = "true" ]; then
  print_result "获取专业列表" 0
else
  print_result "获取专业列表" 1
fi

# 培养层次
LEVELS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/training-levels")
LEVELS_STATUS=$(echo $LEVELS_RESPONSE | jq -r '.success')
if [ "$LEVELS_STATUS" = "true" ]; then
  print_result "获取培养层次列表" 0
else
  print_result "获取培养层次列表" 1
fi

# 课程管理
COURSES_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/courses")
COURSES_STATUS=$(echo $COURSES_RESPONSE | jq -r '.success')
if [ "$COURSES_STATUS" = "true" ]; then
  print_result "获取课程列表" 0
else
  print_result "获取课程列表" 1
fi

# 教材管理
TEXTBOOKS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/textbooks")
TEXTBOOKS_STATUS=$(echo $TEXTBOOKS_RESPONSE | jq -r '.success')
if [ "$TEXTBOOKS_STATUS" = "true" ]; then
  print_result "获取教材列表" 0
else
  print_result "获取教材列表" 1
fi

# 测试5：班级管理模块
echo ""
echo "【5. 班级管理模块测试】"

CLASSES_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/classes?page=1&pageSize=10")
CLASSES_STATUS=$(echo $CLASSES_RESPONSE | jq -r '.success')
if [ "$CLASSES_STATUS" = "true" ]; then
  print_result "获取班级列表（分页）" 0
else
  print_result "获取班级列表（分页）" 1
fi

CLASSES_STATS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/classes/stats")
CLASSES_STATS_STATUS=$(echo $CLASSES_STATS_RESPONSE | jq -r '.success')
if [ "$CLASSES_STATS_STATUS" = "true" ]; then
  print_result "获取班级统计" 0
else
  print_result "获取班级统计" 1
fi

# 测试6：培养方案模块
echo ""
echo "【6. 培养方案模块测试】"

PLANS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/plans?page=1&pageSize=10")
PLANS_STATUS=$(echo $PLANS_RESPONSE | jq -r '.success')
if [ "$PLANS_STATUS" = "true" ]; then
  print_result "获取培养方案列表" 0
else
  print_result "获取培养方案列表" 1
fi

# 测试7：查询统计模块（重构重点）
echo ""
echo "【7. 查询统计模块测试（重构重点）】"

# 当前学期开课查询
SEMESTER_QUERY_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/query/semester?page=1&pageSize=5")
SEMESTER_QUERY_STATUS=$(echo $SEMESTER_QUERY_RESPONSE | jq -r '.success')
if [ "$SEMESTER_QUERY_STATUS" = "true" ]; then
  print_result "当前学期开课查询" 0
else
  # 可能是未设置学期，这是预期的
  SEMESTER_MSG=$(echo $SEMESTER_QUERY_RESPONSE | jq -r '.message')
  if [[ "$SEMESTER_MSG" == *"请先设置当前学期"* ]]; then
    print_result "当前学期开课查询（未设置学期-预期行为）" 0
  else
    print_result "当前学期开课查询" 1
    echo "响应: $SEMESTER_QUERY_RESPONSE"
  fi
fi

# 教材使用情况概览
TEXTBOOKS_USAGE_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/query/textbooks")
TEXTBOOKS_USAGE_STATUS=$(echo $TEXTBOOKS_USAGE_RESPONSE | jq -r '.success')
if [ "$TEXTBOOKS_USAGE_STATUS" = "true" ]; then
  print_result "教材使用情况概览" 0
else
  TEXTBOOKS_USAGE_MSG=$(echo $TEXTBOOKS_USAGE_RESPONSE | jq -r '.message')
  if [[ "$TEXTBOOKS_USAGE_MSG" == *"请先设置当前学期"* ]]; then
    print_result "教材使用情况概览（未设置学期-预期行为）" 0
  else
    print_result "教材使用情况概览" 1
  fi
fi

# 测试8：系统设置模块
echo ""
echo "【8. 系统设置模块测试】"

SETTINGS_RESPONSE=$(curl -s "$BASE_URL/settings")
SETTINGS_STATUS=$(echo $SETTINGS_RESPONSE | jq -r '.success')
if [ "$SETTINGS_STATUS" = "true" ]; then
  print_result "获取系统设置（公开）" 0
else
  print_result "获取系统设置（公开）" 1
fi

# 测试9：审计日志模块（重构重点，需要super_admin）
echo ""
echo "【9. 审计日志模块测试（重构重点）】"

AUDIT_LOGS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/audit/logs?page=1&pageSize=5")
AUDIT_LOGS_STATUS=$(echo $AUDIT_LOGS_RESPONSE | jq -r '.success')
# super_admin才能访问，admin应该被拒绝
if [ "$AUDIT_LOGS_STATUS" = "false" ]; then
  print_result "审计日志权限控制（admin应被拒绝）" 0
else
  print_result "审计日志权限控制" 1
fi

# 测试10：用户管理模块
echo ""
echo "【10. 用户管理模块测试】"

USERS_RESPONSE=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/users")
USERS_STATUS=$(echo $USERS_RESPONSE | jq -r '.success')
if [ "$USERS_STATUS" = "true" ]; then
  print_result "获取用户列表" 0
else
  print_result "获取用户列表" 1
fi

# 测试11：权限控制测试
echo ""
echo "【11. 权限控制测试】"

# Viewer尝试创建用户（应该失败）
CREATE_USER_RESPONSE=$(curl -s -X POST "$BASE_URL/users" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"test\",\"password\":\"test123\",\"role\":\"viewer\"}")

CREATE_USER_STATUS=$(echo $CREATE_USER_RESPONSE | jq -r '.success')
if [ "$CREATE_USER_STATUS" = "false" ]; then
  print_result "访客权限限制（不能创建用户）" 0
else
  print_result "访客权限限制" 1
fi

# 测试12：Token刷新
echo ""
echo "【12. Token刷新测试】"

REFRESH_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$(echo $LOGIN_RESPONSE | jq -r '.data.refreshToken')\"}")

REFRESH_STATUS=$(echo $REFRESH_RESPONSE | jq -r '.success')
if [ "$REFRESH_STATUS" = "true" ]; then
  print_result "Token刷新" 0
else
  print_result "Token刷新" 1
fi

# 输出测试总结
echo ""
echo "=========================================="
echo "测试总结"
echo "=========================================="
echo -e "总测试数: ${TOTAL_TESTS}"
echo -e "${GREEN}通过: ${PASSED_TESTS}${NC}"
echo -e "${RED}失败: ${FAILED_TESTS}${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
  echo -e "${GREEN}✓ 所有测试通过！架构重构成功！${NC}"
  exit 0
else
  echo -e "${RED}✗ 存在失败的测试，请检查上述错误${NC}"
  exit 1
fi
