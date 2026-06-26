# KEC Manager 前端性能诊断报告

**项目版本：** v2.12.7 | **技术栈：** Vue 3.5 + Element Plus 2.14 + Pinia 3 + Vite 5 | **诊断日期：** 2026-06-26

> **修复进度：** 18 项问题中 ✅ 已修复 12 项 | ⏳ 待后端 4 项 | ⏭️ 跳过 1 项 | — 未处理 2 项（P-10 双重刷新、P-14 预压缩）

---

## 一、构建与打包性能

### 1.1 当前配置评估

Vite 配置（`client/vite.config.js`）整体合理：使用 `unplugin-auto-import` + `unplugin-vue-components` 实现 Element Plus 按需引入，`manualChunks` 将 vue/vue-router/pinia、element-plus、axios 分离为独立 chunk，构建目标 ES2022 避免 polyfill 开销。路由全部使用动态 `import()` 实现懒加载。这些是正确的基础策略。

### 1.2 发现的问题

**【严重】`main.js` 全量引入 Element Plus CSS** ⏭️ 跳过（内部子组件样式风险）

`main.js` 第 6 行 `import 'element-plus/dist/index.css'` 加载了 Element Plus 的完整样式表（约 250KB+ minified），但项目实际只使用了约 30 个组件。auto-import resolver 只对 JS 按需引入生效，CSS 仍为全量加载。

修复方案：在 `vite.config.js` 的 `ElementPlusResolver` 中启用 `importStyle: 'sass'`（或 `'css'`），让 resolver 按实际使用的组件自动注入对应样式，移除 `main.js` 中的全量 CSS import。预期减少首屏 CSS 加载 60%-70%。不影响现有功能，但需验证自定义主题变量是否兼容。

**【一般】缺少 `@element-plus/icons-vue` 独立 chunk** ✅ 已修复

`main.js` 注册了 36 个图标组件，它们会被打入主 chunk。图标库未配置独立 `manualChunks`，影响缓存粒度。

修复方案：在 `manualChunks` 中添加 `'element-icons': ['@element-plus/icons-vue']`。图标变更频率极低，独立 chunk 可长期缓存。

**【一般】缺少预压缩配置**

项目通过 Nginx 部署（有 `nginx.conf`），但 Vite 构建未配置 gzip/brotli 预压缩。实时压缩会增加 Nginx CPU 开销，预压缩可让 Nginx 直接发送 `.gz`/`.br` 文件。

修复方案：安装 `vite-plugin-compression`，在 build 阶段生成 `.gz` 和 `.br` 文件，配合 Nginx `gzip_static on` 使用。预期首屏资源传输体积减少 60-70%。

**【建议】缺少 `optimizeDeps.include` 配置** ✅ 已修复

Vite 开发模式下自动发现依赖进行预打包，但 Element Plus 组件较多时冷启动较慢。

修复方案：在 `vite.config.js` 中添加 `optimizeDeps: { include: ['vue', 'vue-router', 'pinia', 'element-plus', 'axios'] }`，可加速开发模式冷启动约 30-50%。

**【建议】缺少打包体积分析工具**

当前无法直观了解各 chunk 的实际大小分布。

修复方案：安装 `rollup-plugin-visualizer`，配置 `build.analyze` 脚本在需要时生成可视化报告。无运行时影响，仅在手动执行时生效。

---

## 二、运行时渲染性能

### 2.1 严重问题

**【严重】多页面 el-table `:key` 绑定筛选值，导致全量 DOM 重建** ✅ 已修复

受影响文件：TeachingArrange.vue（第 192 行）、TeacherList.vue（第 92-100 行）、TextbookList.vue（第 55 行）、TeachingStatistics.vue（第 91-98 行）。

这些页面在 `el-table` 上绑定了 `:key="filterA + filterB + filterC + ..."` 的模式。每次筛选条件变化时，Vue 会销毁整个 `el-table` 组件树并重新创建，包括所有内部 DOM 节点、事件监听器和 Element Plus 内部状态。当数据量较大时（100+ 行），这会导致明显的卡顿和闪烁。

这个 `:key` 最初是为了解决 Element Plus el-table 不响应 computed ref 数组变化的问题（见 MEMORY 记录），但代价过于高昂。

修复方案：移除 `:key` 绑定，改为在数据源上使用 `shallowRef` 或手动触发更新。具体做法：将 `filteredClassList` / `filteredlist` 改为 `shallowRef`，在筛选变化时赋值一个新的数组引用 `filteredlist.value = [...result]`，这样 el-table 能检测到数据变化而不需要重建。预期筛选切换延迟从 200-500ms 降至 30-80ms。需逐个页面验证排序状态是否正确重置。

**【严重】所有列表页无服务端分页，全量数据加载到前端** ⏳ 待后端

受影响文件：TeacherList.vue、CourseList.vue、PlanList.vue、TextbookList.vue、CollegeList.vue、MajorList.vue、TrainingLevelList.vue、TeachingArrange.vue、TeachingStatistics.vue。

除 ClassList.vue（有服务端分页）和 AuditLog.vue（有服务端分页）外，其余所有列表页均在前端一次性加载全部数据，用 computed 做客户端筛选。当前数据量较小时可行，但随着教师、课程、教材数量增长到数百条以上，DOM 节点数和内存占用将线性增长。

修复方案：优先为 TeacherList、CourseList、TextbookList 添加服务端分页（参考 ClassList 的实现），保留客户端筛选作为补充。短期可在 el-table 上添加 `max-height` 配合 Element Plus 的虚拟滚动能力（`el-table-v2`）缓解 DOM 压力。这是渐进式改造，需后端配合提供分页接口。

**【严重】CourseMatrix `applyGlobalWeeks` 触发大量并发请求** ⏳ 待后端

CourseMatrix.vue 第 213-235 行，"统一设置周数"功能使用 `Promise.allSettled` 对所有课程的所有学期记录同时发起 API 请求。一个典型培养方案（30 课程 × 6 学期 = 180 条记录）会产生 180 个并发 HTTP 请求，远超浏览器 6 连接/域名的限制，大概率触发 SQLite 写锁冲突。

修复方案：添加并发控制（如 `p-limit(5)` 限制同时 5 个请求），或更好的方式是新增一个批量更新 API 端点 `PUT /api/plans/:id/batch-semesters`，一次请求完成所有更新。预期从超时/锁冲突变为 2-3 秒内完成。需要后端配合。

### 2.2 一般问题

**【一般】TeachingArrange.vue 是项目最大单文件（1610 行），包含 443 行全局 CSS** ✅ 已修复（CSS 合并为 scoped）

该文件超过 25% 是 `<style>` 代码，其中约 310 行（第 1299-1609 行）为非 scoped 的全局样式，类名如 `.result-card`、`.stat-item` 等通用名称会污染其他组件。

修复方案：将 dialog 相关样式移入 `<style scoped>` 或使用更具特异性的类名前缀（如 `.teaching-arrange-result-card`）。将组件拆分为 `ArrangeResultDialog.vue`、`BatchResultDialog.vue` 等子组件。不影响功能，降低样式冲突风险。

**【一般】多个列表页筛选文本输入无 debounce** ✅ 已修复

受影响文件：CourseList.vue（第 11 行）、TeachingStatistics.vue（第 11 行）。

用户在搜索框输入时，每次按键都会触发 computed 重新计算和 el-table 重渲染。在数据量大时会产生可感知的输入延迟。

修复方案：使用 `@vueuse/core` 的 `useDebounce` 或手动实现 200ms 防抖。将 `filterName` 拆分为 `inputName`（绑定输入框）和 `filterName`（debounced 后用于筛选）。

**【一般】ClassList.vue 每次分页加载都重新获取 9 个关联关系映射** ✅ 已修复

ClassList.vue 第 217-255 行，每次调用 `getClasses()` 分页加载时，响应中包含并更新 9 个关联关系映射（collegeMajorRelation、collegeLevelRelation 等）。这些是结构性参考数据，极少变化，不应随每次分页刷新。

修复方案：将关联数据提取到 `loadBaseData()` 中仅加载一次，或设置较长的缓存 TTL。预期每次翻页减少约 30-50% 的响应数据量和处理时间。

**【一般】ClassList 批量操作使用串行/无限制并行 HTTP 请求** ⏳ 待后端

ClassList.vue 第 477-479 行批量设置使用 `for...of` 串行 `await`，选 50 个班级就是 50 次串行请求。第 408 行批量删除使用无限制 `Promise.all`。TextbookList.vue 第 481、502 行有同样的问题。

修复方案：后端新增批量操作端点 `POST /api/classes/batch-set`、`POST /api/classes/batch-delete`，前端改为单次请求。预期批量操作耗时从 N×100ms 降至 200-500ms。需要后端配合。

**【一般】Dashboard.vue 为显示计数而全量加载实体列表** ⏳ 待后端

Dashboard.vue 第 367-409 行，获取 majors、courses、plans、textbooks 的完整列表，仅为计算 `.length` 和 `.filter(t => t.isActive).length`。随着数据增长，这会传输数百 KB 到数 MB 的不必要数据。

修复方案：后端新增 `GET /api/dashboard/stats` 端点，返回各实体计数。预期 Dashboard 加载时间从 1-3 秒降至 200-500ms。需要后端配合。

### 2.3 建议

**【建议】CalcGrade/calcAge 等函数在模板中每行重复调用**

ClassTable.vue 第 36-37 行 `calcGrade(row)` 在 v-if 和插值中各调用一次，TeacherList.vue 第 528 行 `calcAge` 每行创建 `new Date()`。

修复方案：将 `calcGrade` 结果存入行数据的计算字段，或在 computed 中构建一个 `gradeMap`。`calcAge` 中的当前日期应提取为函数外常量。

**【建议】PlanList.vue 的 `filteredlist` 是 ref 而非 computed** ✅ 已修复

PlanList.vue 第 187 行使用普通 `ref` 手动维护 `filteredlist`，而 TeacherList 和 TextbookList 使用 computed。这种不一致增加了数据不同步的风险。

修复方案：统一改为 computed 模式，与其他列表页保持一致。

---

## 三、状态管理效率

### 3.1 当前评估

项目仅使用 2 个 Pinia store（auth、settings），均使用 Composition API 风格（`setup` 函数），状态划分清晰。auth store 管理认证/授权，settings store 管理系统配置，职责单一。这是一个好的设计。

### 3.2 发现的问题

**【一般】auth store 中 `isLoggedIn` computed 依赖 `Date.now()` 导致状态可能过时** ✅ 已修复

`auth.js` 第 87-93 行，`isLoggedIn` 是一个 computed 属性，内部调用 `isTokenExpired()` 使用 `Date.now()` 判断过期。但 Vue 的 computed 只在响应式依赖（`token`、`refreshToken`）变化时重新求值，不会因时间流逝而自动更新。这意味着 token 过期后 `isLoggedIn` 仍可能返回 `true`，直到其他操作触发重新求值。

路由守卫通过直接调用 `isTokenExpired()` 补偿了这个问题，但模板中如果直接使用 `authStore.isLoggedIn` 仍可能显示过时状态。

修复方案：不依赖 computed 做过期判断。在需要展示登录状态的地方直接调用 `isTokenExpired()` 方法，或在 auth store 中启动一个每分钟触发的定时器强制更新。

**【一般】Token 刷新逻辑仅在 auth store 内实现，未集成到 Axios 拦截器**

`request.js` 已有 401 拦截和 token 刷新队列机制，但 auth store 的 `fetchUserInfo` 也独立实现了刷新+重试逻辑（第 126-148 行）。两套刷新逻辑并行存在，可能在竞态场景下产生冲突（如两个地方同时发起 refresh 请求）。

修复方案：统一 token 刷新入口，让 auth store 的 `fetchUserInfo` 也通过 Axios 拦截器处理 401，移除 store 内的独立重试逻辑。

**【建议】路由守卫中 `useAuthStore()` 在 `redirect` 函数内调用**

`router/index.js` 第 17 行在路由 `redirect` 回调中调用 `useAuthStore()`。虽然在当前配置下可以正常工作（Pinia 先于 Router 安装），但这种模式在 Pinia 实例尚未就绪的极端场景下可能脆弱。

修复方案：将 redirect 逻辑移到 `beforeEach` 守卫中处理，避免在 redirect 回调中依赖 store。

---

## 四、组件库使用规范

### 4.1 Element Plus 引入方式

JS 层面通过 auto-import resolver 按需引入，这是正确的做法。但 CSS 全量引入（见第一节）抵消了 JS 按需引入的部分收益。

图标注册方面，`main.js` 选择性地注册了 36 个图标而非全量导入 280+ 个，这是良好的优化。

### 4.2 发现的问题

**【一般】el-upload 组件重复实现导入逻辑** ✅ 已修复（提取为 useImport composable）

TeacherList.vue 和 TextbookList.vue 的导入流程（beforeImport → confirmImport → onImportSuccess → onImportError）代码高度相似，但未提取为共享 composable。CourseList 也有类似的导入流程。

修复方案：创建 `useImport` composable，封装确认弹窗、上传配置、成功/失败回调的通用逻辑。预期减少约 150 行重复代码。

**【建议】ChangePasswordDialog 未使用异步组件** ✅ 已修复

Layout.vue 第 141 行直接 import ChangePasswordDialog，但该组件仅在用户点击"修改密码"时才显示。

修复方案：使用 `defineAsyncComponent(() => import('./ChangePasswordDialog.vue'))` 延迟加载。预期首屏 JS 减少约 5-10KB。

---

## 五、全栈协作建议

### 5.1 需要后端配合的优化项

| 优先级 | 建议 | 预期收益 | 影响范围 |
|:---:|------|---------|---------|
| 高 | 新增 `GET /api/dashboard/stats` 计数端点 | Dashboard 加载提速 5-10x | Dashboard.vue |
| 高 | 为 Teacher/Course/Textbook 列表提供服务端分页+筛选接口 | 解决大数据量下的渲染瓶颈 | 4 个列表页 |
| 高 | 新增批量操作端点（batch-set, batch-delete） | 批量操作从分钟级降至秒级 | ClassList, TextbookList |
| 中 | CourseMatrix 批量更新学期周数的单一端点 | 避免 180+ 并发请求 | CourseMatrix.vue |
| 低 | 列表接口返回精简字段（列表模式 vs 详情模式） | 减少传输体积 | 所有列表页 |

### 5.2 前端可自行优化的请求模式

**请求去重：** `cache.js` 的 `getWithCache` 未处理并发请求去重——两个组件同时请求同一 key 时会发两次网络请求。建议添加 pending promise 队列，相同 key 的并发请求复用同一个 promise。

**请求时机：** TeacherList、PlanList、TextbookList 每次 `onMounted` 都重新获取全部数据（5+ API 调用），无跨导航缓存。可结合 `cache.js` 对基础数据（majors、colleges、trainingLevels）设置 5 分钟缓存，减少重复请求。

---

## 六、用户体验观察

### 6.1 发现的问题

**【一般】initAuth 阻塞应用挂载，无加载指示器** ✅ 已修复

`main.js` 第 103-113 行，应用在所有认证初始化完成前不会挂载。如果网络延迟较高（如 token 刷新需要服务端往返），用户看到的是空白页面。

修复方案：在 `index.html` 中添加一个纯 CSS 的加载 spinner，或在 `initAuth` 期间挂载一个轻量的 loading 骨架屏。

**【一般】Dashboard 统计卡片无骨架屏/加载态**

Dashboard.vue 使用单一 `v-loading` 遮罩覆盖整个卡片区域，加载期间用户看到的是空白网格而非骨架占位。

修复方案：为每个统计卡片使用 `el-skeleton` 组件，提供数字+标题的骨架占位，改善感知加载速度。

**【一般】导出操作无进度反馈** ✅ 已修复（ElLoading 遮罩）

`useExport.js` 的导出功能在请求期间无 loading 指示。大数据集导出可能需要数秒，用户无视觉反馈。

修复方案：在导出请求期间显示一个全局 `ElLoading` 遮罩或进度条。

**【建议】`el-popconfirm` vs `ElMessageBox.confirm` 不一致**

`useCrudList.js` 使用模态弹窗 `ElMessageBox.confirm` 确认删除，而 TeacherList、TextbookList 等直接使用行内 `el-popconfirm`。两种确认方式混用造成体验不统一。

修复方案：统一使用 `el-popconfirm` 行内确认，减少模态弹窗对操作流程的打断感。

---

## 附录：修复优先级总览

| 级别 | 编号 | 问题 | 文件 | 需后端 | 状态 |
|:---:|:---:|------|------|:---:|:---:|
| 严重 | P-01 | el-table `:key` 全量重建 | 4 个页面 | 否 | ✅ 已修复 |
| 严重 | P-02 | 全量数据无服务端分页 | 9 个列表页 | 是 | ⏳ 待后端 |
| 严重 | P-03 | CourseMatrix 180+ 并发请求 | CourseMatrix.vue | 是 | ⏳ 待后端 |
| 严重 | P-04 | Element Plus CSS 全量引入 | main.js | 否 | ⏭️ 跳过* |
| 一般 | P-05 | 批量操作串行/无限制并行请求 | ClassList, TextbookList | 是 | ⏳ 待后端 |
| 一般 | P-06 | Dashboard 全量加载仅为计数 | Dashboard.vue | 是 | ⏳ 待后端 |
| 一般 | P-07 | 筛选文本无 debounce | 2 个页面 | 否 | ✅ 已修复 |
| 一般 | P-08 | ClassList 分页时重复刷新关联数据 | ClassList.vue | 否 | ✅ 已修复 |
| 一般 | P-09 | auth store isLoggedIn 时间依赖 | auth.js | 否 | ✅ 已修复 |
| 一般 | P-10 | 双重 token 刷新逻辑 | auth.js + request.js | 否 | — 未处理 |
| 一般 | P-11 | 导入逻辑重复 | 3 个列表页 | 否 | ✅ 已修复 |
| 一般 | P-12 | initAuth 阻塞挂载无 loading | main.js | 否 | ✅ 已修复 |
| 一般 | P-13 | TeachingArrange 1610 行+全局 CSS | TeachingArrange.vue | 否 | ✅ 已修复 |
| 建议 | P-14 | 缺少预压缩配置 | vite.config.js | 否 | — 未处理 |
| 建议 | P-15 | icons 未独立 chunk | vite.config.js | 否 | ✅ 已修复 |
| 建议 | P-16 | ChangePasswordDialog 未异步加载 | Layout.vue | 否 | ✅ 已修复 |
| 建议 | P-17 | PlanList filteredlist 应改 computed | PlanList.vue | 否 | ✅ 已修复 |
| 建议 | P-18 | 导出无进度反馈 | useExport.js | 否 | ✅ 已修复 |

**P-04 跳过说明：** 启用 `importStyle: 'sass'` 按需引入 CSS 后，el-scrollbar、el-overlay 等内部子组件样式可能丢失，风险大于收益，暂保留全量引入。

**附：额外修复项（诊断报告外）**

- `vite.config.js`：添加 `optimizeDeps.include` 预构建常用依赖，加速开发冷启动
- `ClassList.vue`：批量操作中 `handleBatchSet` 保持不变（需后端批量端点配合）
