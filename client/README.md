# KEC 课程管理平台 - 前端

KEC (Knowledge Education Course) 前端，基于 Vue 3 + Element Plus + Pinia + Vite 构建。

## 技术栈

- **Vue 3.5** + `<script setup>` SFC
- **Element Plus 2.14** UI 组件库
- **Pinia 3** 状态管理
- **Vite 6** 构建工具
- **Axios** HTTP 请求
- **Vue Router 4** 路由管理

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（端口 5173）
npm run dev

# 生产构建
npm run build

# 代码格式化
npm run format

# ESLint 检查并修复
npm run lint
```

> 开发时后端默认运行在 `localhost:3002`，Vite 代理已配置转发 `/api` 请求。

## 项目结构

```
src/
├── api/            # API 接口模块
├── assets/         # 静态资源
├── components/     # 共享组件（Layout、CourseMatrix 等）
├── composables/    # 可复用逻辑（useCrudList、useSortable 等）
├── router/         # 路由配置 + 导航守卫
├── stores/         # Pinia 状态管理
├── styles/         # 全局样式
├── utils/          # 工具函数（request、download、cache 等）
├── views/          # 页面组件
└── main.js         # 应用入口
```
