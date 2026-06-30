# KEC Manager 前端架构审查报告

**审查范围**：`c:\Users\80330\Documents\kec-manager\client`
**技术栈**：Vue 3.5 + Vite 5 + Pinia 3 + Element Plus 2.14 + Vue Router 4（纯 JavaScript）
**审查时间**：2026-06-30

## 总体评价

项目工程化基础扎实：路由全懒加载、vendor chunk 分割、按需引入 Element Plus、依赖极简（仅 6 个生产依赖）、console 全 DEV 守卫、无密钥泄露、Prettier 统一。主要短板集中在 **API 层未完全收口**、**useCrudList 抽象不足导致 4 个核心页面重复代码**、**核心 CRUD 表单缺校验**、**错误重复弹窗**、**a11y 几乎缺失** 五类系统性问题。

---

## 一、性能与构建优化

### 1.1 路由懒加载 ✅ 优秀

- 全部 20 个业务路由均使用 `() => import()` 动态导入（[router/index.js](file:///c:/Users/80330/Documents/kec-manager/client/src/router/index.js#L10) 起）
- 路由守卫用 `Promise.all` 并行加载用户信息与系统设置（[router/index.js:204-205](file:///c:/Users/80330/Documents/kec-manager/client/src/router/index.js#L204)）

### 1.2 Vite 配置 ✅ 优秀

- `build.target: 'es2022'`、`sourcemap: false`、`chunkSizeWarningLimit: 600`（[vite.config.js:27-29](file:///c:/Users/80330/Documents/kec-manager/client/vite.config.js#L27)）
- `manualChunks` 已分割 4 个 vendor chunk：`vue-vendor`、`element-plus`、`element-icons`、`axios`（[vite.config.js:32-37](file:///c:/Users/80330/Documents/kec-manager/client/vite.config.js#L32)）
- `optimizeDeps.include` 预构建核心依赖（[vite.config.js:41-43](file:///c:/Users/80330/Documents/kec-manager/client/vite.config.js#L41)）

### 1.3 Bundle 体积 ✅ 优秀

- 生产依赖仅 6 个：vue / vue-router / pinia / axios / element-plus / @element-plus/icons-vue
- **无** moment / lodash / dayjs / echarts / xlsx 等常见大型库全量引入
- Element Plus 通过 `unplugin-vue-components` 按需引入，未全量注册（[main.js:3](file:///c:/Users/80330/Documents/kec-manager/client/src/main.js#L3) 注释明确说明）
- 中文 locale 单文件引入 `import zhCn from 'element-plus/dist/locale/zh-cn.mjs'`（[App.vue:2](file:///c:/Users/80330/Documents/kec-manager/client/src/App.vue#L2)）
- 图标按需导入 47 个（[main.js:6-53](file:///c:/Users/80330/Documents/kec-manager/client/src/main.js#L6)），替代全量注册 280+ 个

### 1.4 Pinia Store ✅ 优秀

- 仅 2 个 store（auth、settings），无冗余
- 未引入 `pinia-plugin-persistedstate`，手动持久化更可控：token 走 Cookie、userInfo 走 localStorage
- `settings.js` 内置 5 分钟内存缓存 + pending Promise 复用防重（[settings.js:10-12,52-75](file:///c:/Users/80330/Documents/kec-manager/client/src/stores/settings.js#L10)）

### 1.5 待优化项

| 优先级 | 问题 | 位置 | 建议 |
|---|---|---|---|
| 高 | 死资源未清理 | [src/assets/hero.png](file:///c:/Users/80330/Documents/kec-manager/client/src/assets)、vite.svg、vue.svg 零引用 | 删除 |
| 中 | 大组件未拆分 | TextbookList.vue (665行)、PlanList.vue (396行) 无子组件目录 | 仿 class/ 模式拆出 Table/Form/Filter 子组件 |
| 中 | 入口挂载阻塞 | [main.js:130-132](file:///c:/Users/80330/Documents/kec-manager/client/src/main.js#L130) `await initAuth()` 阻塞 mount | 改为先 mount 再异步 initAuth，让骨架先渲染 |
| 低 | CSS 旧类名映射 | [global.css:70-82](file:///c:/Users/80330/Documents/kec-manager/client/src/styles/global.css#L70) `filter-select-*` 兼容块 | grep 确认无引用后删除 |

---

## 二、用户体验与交互

### 2.1 Loading 状态 ⚠️ 良好但有改进空间

**优点**：
- 表格 `v-loading` 覆盖 16 处
- 按钮 `:loading` 防重复提交覆盖 70+ 处
- `useCrudList.silentReload` 不设 loading 避免列表闪烁（[useCrudList.js:58-67](file:///c:/Users/80330/Documents/kec-manager/client/src/composables/useCrudList.js#L58)）

**问题**：
- **完全无骨架屏**：全仓库 `el-skeleton` 0 匹配，首屏加载仅显示转圈
- [Dashboard.vue:281-308](file:///c:/Users/80330/Documents/kec-manager/client/src/views/Dashboard.vue#L281) 当 `!semester` 时 `loading=true` 已设但提前 return，用户先看转圈再看 0 数据

### 2.2 空状态 ⚠️ 文案误导

**优点**：18+ 处使用 `el-empty` 且大多带引导文案

**问题**：
- **筛选无结果文案误导**：[CourseList.vue:36-38](file:///c:/Users/80330/Documents/kec-manager/client/src/views/course/CourseList.vue#L36)、[TextbookList.vue:53-55](file:///c:/Users/80330/Documents/kec-manager/client/src/views/textbook/TextbookList.vue#L53) 等用 `filteredList` 作为 table data，当 `list` 有数据但筛选为空时，仍显示"请点击右上角新增"，实际应是"未匹配到筛选条件"
- **空状态无操作按钮**：el-empty 未使用默认插槽放置"新增"或"重置筛选"按钮

### 2.3 错误处理 ❌ 系统性：双重 toast

**优点**：
- [request.js:51-146](file:///c:/Users/80330/Documents/kec-manager/client/src/utils/request.js#L51) 拦截器区分 401/403/400/404/500/network
- 401 自动刷新 + 队列重发（`isRefreshing + failedQueue`）
- `silentError` 选项支持，[useCrudList.js:108-110](file:///c:/Users/80330/Documents/kec-manager/client/src/composables/useCrudList.js#L108) 已注释"拦截器已显示，不再重复弹"

**问题**：拦截器已统一弹窗，但多个组件 catch 内又调 `ElMessage.error`，造成重复弹窗：

| 文件 | 行号 | 问题代码 |
|---|---|---|
| [useCrudList.js](file:///c:/Users/80330/Documents/kec-manager/client/src/composables/useCrudList.js#L88) | 88 | `ElMessage.error(e?.response?.data?.message \|\| '保存失败')` |
| [AuditLog.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/system/AuditLog.vue#L356) | 356, 379 | 清空失败 + 加载失败 |
| [TeacherList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/teaching/TeacherList.vue#L639) | 639-641 | `setTimeout(..., 350)` 延迟二次弹窗，反模式 |
| [TextbookList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/textbook/TextbookList.vue#L519) | 519, 590 | 操作失败 + 批量更新失败 |
| [ChangePasswordDialog.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/components/ChangePasswordDialog.vue#L132) | 132 | 密码修改失败 |
| [Login.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/Login.vue#L145) | 145 | 登录失败 |

### 2.4 表单验证 ❌ 系统性：核心 CRUD 表单完全无校验

**优点**：3 处表单验证完整（Login、ChangePasswordDialog、UserManagement）

**问题**：以下 7 个表单仅用 `required` 视觉属性 + 手动 `if (!form.value.name)` 检查，**未绑定 rules、未调用 validate()**：

| 文件 | 表单位置 | 问题 |
|---|---|---|
| [MajorList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/major/MajorList.vue#L68) | 68-87 | 仅检查 name 非空 |
| [CollegeList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/college/CollegeList.vue#L68) | 68-87 | 同上 |
| [CourseList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/course/CourseList.vue#L87) | 87-107 | 同上 |
| [TextbookList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/textbook/TextbookList.vue#L185) | 185-240 | 定价字段无 min/precision 校验 |
| [TeacherList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/teaching/TeacherList.vue#L193) | 193-306 | 多选字段无必填校验 |
| [ClassFormDialog.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/class/components/ClassFormDialog.vue#L10) | 10-115 | 入学年份/学制/班级人数无范围校验 |
| [TrainingLevelList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/trainingLevel/TrainingLevelList.vue) | - | 同模式 |

### 2.5 防抖节流 ⚠️ 覆盖不全

**优点**：
- [CourseList.vue:156-165](file:///c:/Users/80330/Documents/kec-manager/client/src/views/course/CourseList.vue#L156) 和 [TeachingStatistics.vue:203-217](file:///c:/Users/80330/Documents/kec-manager/client/src/views/teaching/TeachingStatistics.vue#L203) 手写 200ms 防抖

**问题**：
- [TextbookList.vue:15](file:///c:/Users/80330/Documents/kec-manager/client/src/views/textbook/TextbookList.vue#L15) filterTitle 直接进 computed，无防抖
- [TeacherList.vue:16](file:///c:/Users/80330/Documents/kec-manager/client/src/views/teaching/TeacherList.vue#L16) filterName 同上
- [Layout.vue:180-195](file:///c:/Users/80330/Documents/kec-manager/client/src/components/Layout.vue#L180) resize 未节流
- 无统一 `useDebounce` composable，防抖代码在 2 处重复

### 2.6 表格交互 ⚠️ 分页不统一

**优点**：
- `row-key` 全覆盖 13 处
- `min-width` 响应式列宽 + `fixed="right"` 操作列
- 移动端操作列转下拉（[global.css:357-374](file:///c:/Users/80330/Documents/kec-manager/client/src/styles/global.css#L357)）

**问题**：
- **分页模式不统一**：AuditLog/ClassList 后端分页，UnifiedTextbookQuery 前端分页，MajorList/CollegeList/CourseList/TextbookList/TeacherList **完全无分页**（数据增长后会有问题）
- [AuditLog.vue:76](file:///c:/Users/80330/Documents/kec-manager/client/src/views/system/AuditLog.vue#L76) `sortable` 默认前端排，但数据是后端分页，跨页排序失效
- [TextbookList.vue:46-132](file:///c:/Users/80330/Documents/kec-manager/client/src/views/textbook/TextbookList.vue#L46) 13 列横向溢出，移动端无响应式列隐藏

### 2.7 可访问性 a11y ❌ 系统性缺失

- **完全无 aria-* 属性**：全仓库 0 匹配
- **图标按钮无文字 fallback**：依赖 `title` 属性（hover 才显示），屏幕阅读器感知弱
- [Layout.vue:93-96](file:///c:/Users/80330/Documents/kec-manager/client/src/components/Layout.vue#L93) collapse-icon 无 `role="button"`/`tabindex`/键盘事件
- [Dashboard.vue:39-130](file:///c:/Users/80330/Documents/kec-manager/client/src/views/Dashboard.vue#L39) stat-item 可点击 div 无 `role="button"`/`tabindex="0"`/`@keyup.enter`

### 2.8 响应式 ✅ 良好

- 完整断点体系：1440 / 992 / 768 / 480（[global.css:193-374](file:///c:/Users/80330/Documents/kec-manager/client/src/styles/global.css#L193)）
- 弹窗统一 `width="min(500px, 90vw)"`，自适应小屏
- el-row + el-col 响应式栅格

**问题**：
- 768px 以下复杂表单弹窗未真正全屏，高度溢出需拖拽
- 无超大屏处理，1920px+ 内容撑满

### 2.9 导航体验 ❌ 系统性缺失

- **完全无 NProgress 进度条**：路由切换（特别是 PlanDetail 等异步组件首次加载）无视觉反馈
- **未配置 scrollBehavior**：[router/index.js:147-150](file:///c:/Users/80330/Documents/kec-manager/client/src/router/index.js#L147) `createRouter` 缺 `scrollBehavior`，返回列表时滚动位置丢失
- **router-view 未缓存**：[Layout.vue:123](file:///c:/Users/80330/Documents/kec-manager/client/src/components/Layout.vue#L123) 无 `<keep-alive>`，列表→详情→返回时筛选/分页状态丢失

### 2.10 确认弹窗 ✅ 良好

- 删除操作全部有确认弹窗
- 危险操作用 `type="danger"`，警告用 `type="warning"`
- `useCrudList.getDeleteWarning` 支持自定义关联警告（[useCrudList.js:41-44](file:///c:/Users/80330/Documents/kec-manager/client/src/composables/useCrudList.js#L41)）

**问题**：
- 关联警告文案用橙色 `#e6a23c`，但语义是"删除将被拒绝"，应用红色 `#f56c6c`
- [settings/components/ConfirmDialog.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/settings/components/ConfirmDialog.vue) 已封装通用确认弹窗，但其他模块仍各自手写

---

## 三、代码质量与架构

### 3.1 Composable 复用 ❌ useCrudList 覆盖度低

**优点**：7 个 composable（useCrudList / useImport / useExport / useSortable / useFilterCollapse / useMatrixCalculations / useSemesters），抽象设计整体合理

**问题**：
- `useCrudList` 仅覆盖 3 个简单页面（CollegeList / MajorList / TrainingLevelList）
- 4 个复杂页面（ClassList / TextbookList / PlanList / CourseList）手工重复实现 `load` / `silentReload` / `handleSave` / `handleDelete` / `confirmDelete` 整套逻辑
- `useCrudList.handleSave`（[useCrudList.js:74-92](file:///c:/Users/80330/Documents/kec-manager/client/src/composables/useCrudList.js#L74)）直接透传 form，不支持 snake_case 字段转换，复杂页面被迫绕开
- `useCrudList.load` 不支持分页/筛选参数

### 3.2 组件拆分 ⚠️ 部分大组件未拆

**优点**：ClassList 拆出 ClassFilterBar / ClassTable / ClassFormDialog；teaching/ 拆出 6 个子组件

**问题**：
- [TextbookList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/textbook/TextbookList.vue) 665 行单文件，表格 + 4 个弹窗全内联
- [PlanList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/plan/PlanList.vue) 396 行未拆
- [CourseList.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/course/CourseList.vue) 未拆
- [TeachingArrange.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/teaching/TeachingArrange.vue) 650+ 行

### 3.3 API 层 ❌ 未完全收口

**优点**：`src/api/` 下 12 个模块，命名统一 `getXxx` / `createXxx` / `updateXxx` / `deleteXxx`

**问题一：8 个组件绕过 API 层直接调 request**

| 文件 | 行号 | 端点 |
|---|---|---|
| [UserManagement.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/system/UserManagement.vue#L232) | 232,243,288,302,337,365 | /users CRUD |
| [SystemSettings.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/settings/SystemSettings.vue#L147) | 147,171 | /settings/reset/* |
| [TeachingStatistics.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/teaching/TeachingStatistics.vue#L294) | 294,336 | /settings, /export/statistics |
| [TeachingArrange.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/teaching/TeachingArrange.vue#L638) | 638 | /export/teaching-arrange |
| [UnifiedSemesterQuery.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/query/UnifiedSemesterQuery.vue#L450) | 450 | /export/semester |
| [UnifiedTextbookQuery.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/query/UnifiedTextbookQuery.vue#L260) | 260 | /export/textbook/:id |
| [AuditLog.vue](file:///c:/Users/80330/Documents/kec-manager/client/src/views/system/AuditLog.vue#L351) | 351 | /settings/reset/audit-logs |

**问题二：缺失的 API 模块**：无 `api/user.js`、`api/auth.js`、`api/settings.js`、`api/export.js`

**问题三：死导入** [ClassList.vue:167](file:///c:/Users/80330/Documents/kec-manager/client/src/views/class/ClassList.vue#L167) `import request` 未使用

### 3.4 Pinia 使用 ❌ store 内直接发 HTTP 请求

- [auth.js](file:///c:/Users/80330/Documents/kec-manager/client/src/stores/auth.js#L4) 5 处直接调 `request`：login / logout / refreshAccessToken / fetchUserInfo / changePassword
- [settings.js](file:///c:/Users/80330/Documents/kec-manager/client/src/stores/settings.js#L3) 2 处直接调 `request`：load / save
- 按规范 store 应只编排状态，HTTP 调用应下沉到 `src/api/` 层
- [settings.js:10-12](file:///c:/Users/80330/Documents/kec-manager/client/src/stores/settings.js#L10) 模块级变量做缓存，对 Pinia DevTools 不可见

### 3.5 命名规范 ⚠️ 不一致

**问题一**：`filteredlist`（小写 l）与 `filteredList`（大写 L）混用
- [TextbookList.vue:393](file:///c:/Users/80330/Documents/kec-manager/client/src/views/textbook/TextbookList.vue#L393)、[PlanList.vue:217](file:///c:/Users/80330/Documents/kec-manager/client/src/views/plan/PlanList.vue#L217) 用 `filteredlist`
- [CourseList.vue:192](file:///c:/Users/80330/Documents/kec-manager/client/src/views/course/CourseList.vue#L192) 用 `filteredList`

**问题二**：[eslint.config.js:33](file:///c:/Users/80330/Documents/kec-manager/client/eslint.config.js#L33) 关闭 `vue/multi-word-component-names`，导致 Login.vue / Dashboard.vue / NotFound.vue 等单词组件名合法化

### 3.6 重复代码 ❌ 模式重复

`useCrudList` 仅覆盖 3 个简单页面，复杂页面的重复块：
1. **删除确认弹窗模板**：`deleteConfirmVisible` / `deleting` / `pendingDeleteRow` / `deleteWarning` / `confirmDelete` / `cancelDelete` 在 TextbookList / PlanList / ClassList 几乎逐字复制
2. **load / silentReload**：3 个页面结构完全相同
3. **handleSave 的 snake_case 转换**：3 个页面各自手写字段映射
4. **批量操作**：TextbookList 与 ClassList 的批量设置/删除逻辑高度相似

### 3.7 类型安全 ⚠️ 无 TS

- 无 TypeScript，全项目无 `.ts` 文件
- composable 有 JSDoc（[useCrudList.js:5-19](file:///c:/Users/80330/Documents/kec-manager/client/src/composables/useCrudList.js#L5) 质量较好）
- API 响应无类型契约，调用方全靠 `res?.data?.items` 猜测
- props 有运行时校验对象，无 TS 类型

### 3.8 console/error ✅ 优秀

- **无 `console.log`**：全仓库 0 匹配，无遗留调试代码
- **46 处 `console.error`/`warn` 全部包裹在 `if (import.meta.env.DEV)` 内**，生产不输出
- [main.js:61-69](file:///c:/Users/80330/Documents/kec-manager/client/src/main.js#L61) 配置全局 errorHandler / warnHandler
- 所有 async 函数均有 try/catch

### 3.9 环境变量 ✅ 良好

- 无硬编码 API 地址（[request.js:8](file:///c:/Users/80330/Documents/kec-manager/client/src/utils/request.js#L8) `baseURL: '/api'` 相对路径）
- 无暴露密钥，token 存 cookie
- **问题**：[Login.vue:102](file:///c:/Users/80330/Documents/kec-manager/client/src/views/Login.vue#L102) 引用 `VITE_DEV_ACCOUNT_HINT` 但无 `.env` 文件定义
- **问题**：`.gitignore` 未忽略 `.env`

### 3.10 ESLint/Prettier ⚠️ 规则偏松

- Prettier 配置合理
- ESLint 启用 `js.configs.recommended` + `vue.configs['flat/recommended']`
- **问题**：
  - [eslint.config.js:33-35](file:///c:/Users/80330/Documents/kec-manager/client/eslint.config.js#L33) 关闭 `vue/multi-word-component-names`、`vue/no-v-html`，`no-unused-vars` 仅 warn
  - 未配置 `no-console` / `no-debugger`
  - **无 husky / lint-staged / pre-commit 钩子**，lint 仅靠手动

---

## 四、优先级汇总

### P0 系统性问题（建议优先修复）

| # | 问题 | 影响范围 | 修复建议 |
|---|---|---|---|
| 1 | 9 处组件 catch + 拦截器双弹窗 | 全局 | 组件内 catch 不再 `ElMessage.error`，或调用 API 时传 `{ silentError: true }` 后自行控制 |
| 2 | 7 个核心 CRUD 表单无 rules 验证 | MajorList / CollegeList / CourseList / TextbookList / TeacherList / ClassFormDialog / TrainingLevelList | 为 el-form 添加 `:rules` + `ref`，handleSave 中 `await formRef.validate()` |
| 3 | 无路由进度条 + 无 scrollBehavior | 全局 | 安装 nprogress，添加 `scrollBehavior` |
| 4 | a11y 几乎缺失 | 全局 | 添加 aria-label、role="button"、tabindex、键盘事件 |
| 5 | 8 个组件绕过 API 层直接调 request | UserManagement / SystemSettings / TeachingStatistics / 等 | 创建 api/user.js、api/auth.js、api/settings.js、api/export.js |
| 6 | 2 个 store 内直接发 HTTP 请求 | auth.js、settings.js | 下沉到 api 层 |
| 7 | useCrudList 覆盖度低，4 个复杂页重复 CRUD 逻辑 | ClassList / TextbookList / PlanList / CourseList | useCrudList 增加 `transformForm` + `listParams` + 抽 `useDeleteConfirm` |

### P1 体验改进

| # | 问题 | 修复建议 |
|---|---|---|
| 8 | 筛选无结果文案误导 | 区分"无数据"与"筛选无结果"两种状态 |
| 9 | 搜索框防抖覆盖不全 | 新建 `useDebounce` composable |
| 10 | 大数据列表无后端分页 | TextbookList / TeacherList 接入后端分页 |
| 11 | 弹窗小屏未全屏 | 768px 以下 `:fullscreen="isMobile"` |
| 12 | TextbookList 665 行未拆 | 仿 class/ 模式拆出 Table/Form/Filter 子组件 |
| 13 | 死资源未清理 | 删除 src/assets/hero.png、vite.svg、vue.svg |

### P2 一致性优化

| # | 问题 | 修复建议 |
|---|---|---|
| 14 | 关联警告文案颜色用橙色 | 改为红色 `#f56c6c`，与"删除将被拒绝"语义一致 |
| 15 | ConfirmDialog 组件未复用 | 抽通用 ConfirmDialog 供所有 CRUD 页面复用 |
| 16 | 无骨架屏 | Dashboard / TeachingStatistics 引入 el-skeleton |
| 17 | resize 监听未节流 | Layout.vue 用 requestAnimationFrame 包装 |
| 18 | filteredlist/filteredList 命名不一致 | 统一为 `filteredList` |
| 19 | ESLint 规则过松，无 pre-commit 钩子 | 配置 husky + lint-staged |
| 20 | ClassList.vue:167 死 import | 删除 |
| 21 | VITE_DEV_ACCOUNT_HINT 未文档化 | 补充 .env.development.example |
| 22 | 入口挂载阻塞 | main.js 先 mount 再异步 initAuth |

---

## 五、无需改动项（已达优秀水平）

- 路由懒加载（20 处全动态导入）
- Vite manualChunks 分割
- 依赖精简（6 个生产依赖，无大型冗余库）
- Element Plus 按需引入（组件 + 样式 + 图标 + locale）
- Pinia 持久化策略（手动更可控，无需插件）
- console 全 DEV 守卫（46 处，生产 0 输出）
- 全局 errorHandler / warnHandler
- 无密钥泄露
- 响应式断点体系（1440/992/768/480）
- 表格 row-key + min-width + fixed 操作列
- 删除确认弹窗覆盖完整
- Prettier 统一格式

---

**报告生成方式**：静态代码扫描，未运行时验证。如需对某项展开深入分析或修复实施，可针对具体文件进一步处理。
