#!/bin/bash

# KEC 课程管理平台 - 开发环境启动脚本
# 用于重置系统并启动开发测试

# 设置 UTF-8 编码（确保中文正常显示）
export LANG=en_US.UTF-8

echo "======================================"
echo "  KEC 课程管理平台 - 开发测试启动"
echo "======================================"
echo ""

# 检查 Node.js 版本
echo "检查 Node.js 版本..."
node --version
echo ""

# 进入项目根目录
cd "$(dirname "$0")" || exit 1
echo "当前目录: $(pwd)"
echo ""

# 重置数据库
echo "步骤 1/3: 重置数据库..."
cd server
npm run db:reset
if [ $? -ne 0 ]; then
    echo "❌ 数据库重置失败!"
    exit 1
fi
echo ""

# 返回根目录
cd ..

# 启动开发服务器
echo "步骤 2/3: 启动开发服务器..."
echo "后端服务器: http://localhost:3000"
echo "前端应用: http://localhost:5173"
echo ""
echo "步骤 3/3: 等待服务启动..."
echo ""
echo "======================================"
echo "  登录信息"
echo "======================================"
echo "  用户名: admin"
echo "  密码: admin@123456"
echo "  角色: super_admin"
echo "======================================"
echo ""

# 使用 concurrently 同时启动前后端
npm run dev
