@echo off
chcp 65001 >nul
REM KEC 课程管理平台 - Windows 开发环境启动脚本

echo ======================================
echo   KEC 课程管理平台 - 开发测试启动
echo ======================================
echo.

REM 检查 Node.js 版本
echo 检查 Node.js 版本...
node --version
echo.

REM 进入项目根目录
cd /d "%~dp0"
echo 当前目录: %CD%
echo.

REM 重置数据库
echo 步骤 1/3: 重置数据库...
cd server
npm run db:reset
if errorlevel 1 (
    echo [错误] 数据库重置失败!
    pause
    exit /b 1
)
echo.

REM 返回根目录
cd ..

echo 步骤 2/3: 准备启动开发服务器...
echo 后端服务器: http://localhost:3000
echo 前端应用: http://localhost:5173
echo.
echo 步骤 3/3: 启动服务...
echo.
echo ======================================
echo   登录信息
echo ======================================
echo   用户名: admin
echo   密码: admin@123456
echo   角色: super_admin
echo ======================================
echo.

REM 使用 concurrently 同时启动前后端
call npm run dev
