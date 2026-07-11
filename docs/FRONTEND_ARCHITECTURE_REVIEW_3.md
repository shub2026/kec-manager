# 前端架构审查报告（第三轮）

> 审查日期：2026-07-11
> 审查视角：前端架构师
> 审查范围：前后端调用链、API 层、stores/composables、视图页面、路由权限
> 审查基线：commit `5621014`（后端业务逻辑校正后）

---

## 一、总体评价

前端架构整体质量较高：

- **安全基线扎实**：token 内存化 + refreshToken HttpOnly Cookie + CSRF Token + 命名转换中间件 + XSS 清洗 + 开放重定向防护
- **request.js 封装完整**：401 刷新队列、silentError、错误分级、token 刷新并发守卫
- **命名中间件机制可靠**：camelCase ↔ snake_case 双向转换，字段映射经逐一核对全部正确
- **无孤儿调用、无方法不匹配、无重复封装**

但发现 **2 个功能 Bug**（已验证源码确认）和 **8 个值得修复的问题**，外加若干优化建议。

---

## 二、需修复的功能 Bug（已验证源码）

### Bug 1【高】`useSemesters.js` 读取 settings 用错键名，可配置学期边界月永远失效

**位置**：`client/src/composables/useSemesters.js:50`

```js
const monthSetting = store.settings?.semester_start_month?.value;  // ← snake_case 键
```

**验证**：`client/src/stores/settings.js:79` 存储 `settings.value = res.data`，而 `res.data` 经响应中间件 `snakeToCamel` 转换，键已变为 `semesterStartMonth`（驼峰）。同文件第 81 行读 `currentSemester`（驼峰）是对的，唯独第 50 行用 snake_case，导致 `monthSetting` 恒为 `undefined`，`semesterStartMonth` 始终回退默认 8。

**影响**：仅当 `currentSemester` 未配置或非法、走到 `getCurrentSemester(semesterStartMonth)` 本地回退分支时才暴露。若管理员将学期边界月改为 9，前端回退估算错位。配置完当前学期的正常场景不触发。

**修复方案**：

```js
const monthSetting = store.settings?.semesterStartMonth?.value;
```

**影响评估**：单行修改，零风险。仅影响本地回退分支的月份判断。

---

### Bug 2【高】SSE 流式读取超时被过早清除，流静默停滞时客户端无限等待

**位置**：`client/src/api/teachingArrange.js:46-48`

```js
try {
  response = await fetch(...);
} finally {
  clearTimeout(timeoutId);  // ← 响应头到达后立即清除，后续 reader.read() 无超时保护
}
// 后续 while(true) { reader.read() } 循环（第 66-95 行）无任何超时
```

**验证**：`finally` 在 `fetch` Promise resolve（响应头到达）后立即执行。后续 `reader.read()` 流式读取循环（第 66-95 行）无任何超时保护。若 SSE 流静默停滞（后端异常但未关闭连接），客户端无限等待。后端虽有 5 分钟业务超时，但后端进程挂起场景前端无法恢复。

**修复方案**：将 `clearTimeout` 移到循环结束后，或采用"每次 read 重置超时"的 idle 超时机制（推荐，因 SSE 可能耗时较长）：

```js
const controller = new AbortController();
const timeoutMs = options.timeout || 7 * 60 * 1000;
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

try {
  response = await fetch(`/api${url}`, { /* ... */ signal: controller.signal });
  if (!response.ok) { /* ... */ }
  const reader = response.body.getReader();
  // ... while 循环读取
  return finalResult;
} finally {
  clearTimeout(timeoutId);
}
```

**影响评估**：修改超时作用域，不影响正常排课流程。仅增加异常场景的自动恢复能力。

---

## 三、需修复的其他问题

### 问题 3【中】`useFilterLinkage.getIntersectedOptions` 缺 null 守卫，潜在 TypeError 崩溃

**位置**：`client/src/components/filter/composables/useFilterLinkage.js:104-115`

`getIntersectedOptions` 对 `relationData` 为 undefined 无守卫，`relationData[String(parentValue)]` 会抛 TypeError。对比同文件 `getFilteredOptions`（第 55 行有 `if (!relationData) return allOptions;`）防护不对称。

**修复方案**：补 null 守卫，与 `getFilteredOptions` 对齐。

**影响评估**：仅增加防御，零行为变化。

---

### 问题 4【中】`useSortable` 双请求部分失败导致 UI 与服务端不一致

**位置**：`client/src/composables/useSortable.js:44-54`

`Promise.all([updateFn(a), updateFn(b)])` 两个独立请求，若一个成功一个失败，`Promise.all` 抛错进入 catch，**跳过 `reloadFn()`**，本地列表与服务端实际（已部分变更）不一致，且仍提示"数据已过时"。

**修复方案**：catch 块中仍调用 `reloadFn()` 回滚到服务端真实状态：

```js
catch (e) {
  await reloadFn?.();  // 回滚到服务端真实状态
  ElMessage.error(...);
}
```

**影响评估**：catch 路径新增一次 reload 调用，仅在失败时触发，正常流程零影响。

---

### 问题 5【中】`useExport` blob 响应失败时后端真实错误消息丢失

**位置**：`client/src/utils/request.js:143` + `client/src/composables/useExport.js:21-47`

`responseType: 'blob'` 的请求失败时，`error.response.data` 是 Blob（无 `message` 属性），`error.response.data?.message` 为 undefined，回退到通用文案"请求参数错误"，后端真实错误（如"无数据可导出"）丢失。

**修复方案**：在 request.js 错误拦截器中，对 blob 响应尝试读取为 JSON：

```js
let rawMsg = error.response.data?.message;
if (error.response.data instanceof Blob) {
  try {
    const text = await error.response.data.text();
    rawMsg = JSON.parse(text)?.message;
  } catch (_) { /* 非 JSON 忽略 */ }
}
```

**影响评估**：仅影响 blob 请求的错误路径，增加一次异步读取。正常成功路径零影响。

---

### 问题 6【中】`useImport` 失败时双重错误提示

**位置**：`client/src/composables/useImport.js:387-392`

`confirmImport` 的 catch 调 `onImportError` 弹 `ElMessage.error('导入失败...')`，但 request 拦截器已对该 4xx/5xx 弹过一次（未设 `silentError`），用户看到两条错误 toast。

**修复方案**：导入请求加 `silentError: true`，由 `onImportError` 统一展示。

**影响评估**：仅改变错误提示来源，减少一条重复 toast。

---

### 问题 7【中】`ClassTable.vue` 重复实现后端 grade 公式且硬编码边界月

**位置**：`client/src/views/class/components/ClassTable.vue:162-189`

第 177 行 `grade = startYear - row.enrollmentYear + 1` 与后端 `calcClassSemester` 完全相同；第 174 行降级路径硬编码 `month >= 8`，未读 `semesterStartMonth` 配置；第 182 行 `durationYears || 99` 与后端"返回 null"语义不同。

**影响**：仅用于展示年级列，真正的在读过滤由后端完成。但若后端公式演进（如改用 `semesterStartMonth`），前端会不一致。

**修复方案**：让后端 `getClasses` 返回 `grade` 字段（已有 `calcClassSemester` 计算），前端直接展示，移除重复公式。

**影响评估**：需后端配合新增返回字段，前端删除本地公式。中等改动。

---

### 问题 8【中】跨标签页状态不同步（auth/settings）

**位置**：`client/src/stores/auth.js` + `client/src/stores/settings.js`

全仓库无 `window.addEventListener('storage', ...)`。标签页 A 登出后，标签页 B 的内存 token/userInfo 仍存在，继续展示已登出用户界面直到下次 API 401。settings 同理，5 分钟内为旧值。

**修复方案**：在 auth store 和 settings store 注册 `storage` 事件监听，检测 `loggedIn`/`userInfo` key 变化时同步状态或触发 reload。

**影响评估**：新增全局事件监听，仅在多标签页场景触发。需注意移除监听避免内存泄漏。

---

### 问题 9【低】`types.js` 类型定义与后端实际返回严重不符

**位置**：`client/src/api/types.js:261-270`

`DashboardStats` 定义 `trainingPlans/teachers/activeClasses`，后端实际返回 `plans/teachingTeachers`（无 `teachers/activeClasses`）。`AutoArrangeInput`/`BatchAutoArrangeInput` 缺失必填的 `mode` 字段。多个实体类型缺失统计字段。

**影响**：纯 JSDoc 类型注解，不影响运行时。但会误导开发者，且若启用 TS 检查会报错。

**修复方案**：按后端实际返回结构更新类型定义。

**影响评估**：仅修改注释/类型定义，零运行时影响。

---

## 四、优化建议（不阻塞，可按迭代节奏收敛）

| 位置 | 问题 | 建议 |
|---|---|---|
| `client/src/router/index.js:225-239` | 权限警告 `permissionWarning` 仅在 Layout `onMounted` 读取，已在 `/dashboard` 时访问受限路由不触发 | 改用 watch 或全局状态（Pinia/事件总线）传递警告 |
| `client/src/views/Dashboard.vue:278-279,308-310` | `fetchStats`/`fetchInsights` 失败仅 console.error，无用户可见提示 | 添加 `ElMessage.error` 或错误状态展示 |
| `client/src/views/Dashboard.vue:289-311` | 洞察区域无独立 loading 状态 | 为洞察区域添加独立 loading |
| `client/src/views/query/UnifiedSemesterQuery.vue:446-455` | `goToCurrentSemester` 学期值变化触发 `@change` + 显式调用，导致 `load()` 调用两次 | 移除显式调用或加防重入 |
| `client/src/views/class/ClassList.vue:516-517` | `batchDeleteClasses` 未用 silent，失败时拦截器 + catch 双弹窗 | 添加 silent 选项 |
| `client/src/composables/useCourseMatrixEditing.js` | 编辑保存请求体 camelCase/snake_case 混用（功能正确，经中间件转换） | 统一为 camelCase |
| `client/src/composables/useCourseMatrixEditing.js:83` | 仅取 `planTextbooks[0]`，多教材关联会被 REPLACE 语义静默删除 | 确认业务是否支持多教材，若支持需前端适配 |
| `client/src/composables/useDebounce.js:9-34` | `useDebouncedRef` 返回非真正 Ref，且全仓库未使用（死代码） | 删除 |
| 后端 3 个死接口 | `POST /auth/download-token`、`POST /settings/initialize`、`GET /export/semester` 前端从未调用 | 确认是否保留，否则删除 |

---

## 五、API 层审查详情

### 5.1 命名中间件机制确认

后端 `server/src/app.js:119-120` 全局挂载两个中间件：

- `convertRequestNaming`（`naming.middleware.js:50-80`）：将 `req.body` 和 `req.query` 的 camelCase 键递归转为 snake_case
- `convertResponseNaming`（`naming.middleware.js:86-117`）：拦截 `res.json`，对 `data` 字段递归执行 `snakeToCamel`

`success()` 工具（`response.js:1-3`）将数据包装为 `{ success, message, data }`，响应中间件只对 `data` 字段的值做 snake→camel 转换，顶层键 `success/message/data` 不变。

**结论**：前端应统一使用 camelCase 发送请求（body + query），由中间件转 snake_case；后端返回的 snake_case 由中间件转 camelCase 给前端。`types.js:5-8` 也明确声明了这一约定。

### 5.2 字段命名一致性问题

以下三处批量更新接口的 JSDoc 显式声明 snake_case，违反约定（功能不受影响，因 `camelToSnake` 对已是 snake_case 的键不做改变）：

| 文件 | 行号 | 问题 |
|------|------|------|
| `client/src/api/class.js` | 44 | `@param {object} updates - 要更新的字段（snake_case）` |
| `client/src/api/textbook.js` | 44 | `@param {object} updates - 要更新的字段（snake_case）` |
| `client/src/api/plan.js` | 116-117 | `@param {Array<{id: number, sort_order: number}>} items` |

### 5.3 后端死接口（前端从未调用）

| 后端接口 | 路由文件:行号 | 说明 |
|---------|-------------|------|
| `POST /auth/download-token` | `auth.routes.js:257` | 全前端无任何调用 |
| `POST /settings/initialize` | `settings.routes.js:45` | 全前端无任何调用 |
| `GET /export/semester` | `export.routes.js:43` | 前端只用 POST 版本 |

### 5.4 接口对应关系核查结论

- **孤儿调用（前端调用了但后端没定义）**：未发现
- **HTTP 方法不匹配**：未发现
- **参数传递方式不匹配**：未发现
- **前端重复封装同一后端接口**：未发现

### 5.5 types.js 类型定义主要问题

| 类型 | 位置 | 问题 |
|------|------|------|
| `DashboardStats` | `types.js:261-270` | 字段名/字段集与后端严重不符（`trainingPlans`≠`plans`，多出 `teachers/activeClasses`，缺失 `teachingTeachers/totalWeeklyHours/semester`） |
| `AutoArrangeInput` | `types.js:246` | 缺失必填的 `mode` 字段，后端 `validateAutoArrange` 会 400 拒绝 |
| `BatchAutoArrangeInput` | `types.js:247` | 缺失必填的 `mode` 字段 |
| `Teacher`/`TeacherInput` | `types.js:207-231` | 缺失 `affiliatedCollege/courseList/collegeList/trainingLevelList/assignmentCount` 及输入的 `courseIds/collegeIds/trainingLevelIds` |
| `Plan`/`PlanInput` | `types.js:157-176` | 缺失 `status/courseCount/classCount` 等统计字段及 `sortOrder/status` 输入字段 |
| `Class` | `types.js:70-82` | 缺失 `matchedPlanName/matchedPlanType/planMatchWarning` 及嵌套关系 |
| `CourseListParams` | `types.js:121` | JSDoc 语法错误，末尾多一个 `}` |

---

## 六、stores / composables 审查详情

### 6.1 stores/auth.js

- **token 持久化（安全）**：`token` 仅存内存 `ref('')`，`refreshToken` 交由后端 HttpOnly Cookie，`userInfo`（非敏感）存 localStorage。安全模型合理。
- **刷新并发守卫**：`refreshAccessToken()` 用 `_refreshPromise` 复用避免多次刷新；`request.js` 另有 `isRefreshing` + `failedQueue` 对 401 请求排队重放。两层守卫配合，无死循环。
- **冗余刷新层**：`fetchUserInfo()`（`auth.js:149-171`）在 401 时自身再调 `refreshAccessToken()` 并重试，与 request 拦截器的 401 刷新叠加，对 `/auth/me` 可能触发 2~3 次刷新（有界，非无限循环）。
- **路由守卫"主动刷新"几乎为死代码**：`router/index.js:187` 条件 `(!authStore.token || isTokenExpired(token)) && !authStore.userInfo`，因 store 构造时已从 localStorage 恢复 `userInfo`，`!authStore.userInfo` 恒为 false，该分支永不进入。
- **多标签页不同步**：无 `storage` 事件监听，标签页 A 登出后 B 仍展示已登出用户界面。

### 6.2 stores/settings.js

- **缓存机制**：5 分钟 TTL + `_pendingPromise` 复用，`force` 刷新时清空 pending 与 `_lastLoadTime`。配合正确。
- **与后端同步**：`save()` 调用 `updateSettings` 后立即 `load(true)` 强制刷新，后端 `invalidateSemesterCache()` 清服务端缓存。
- **错误吞噬**：`load()` 内部 `.catch` 仅 `console.error` 并 resolve 为 `undefined`，调用方无法区分"加载成功但空"与"加载失败"。
- **学期标签格式不一致**：`settings.js:29-34` 产出 `"2026年春季(第2学期)"`，`useSemesters.js:21-22` 产出 `"2025-2026学年 秋季(第1学期)"`。

### 6.3 useSemesters.js 与后端学期公式一致性

- `useSemesters.js` 本身未重复 `calcClassSemester` 的 grade 公式。
- **`ClassTable.vue:162-189` 重复实现 grade 公式**（第 177 行），降级路径硬编码 `month>=8`（第 174 行）未读 `semester_start_month` 配置。
- **BUG**：`useSemesters.js:50` 读取 `store.settings?.semester_start_month?.value` 用 snake_case 键，经响应中间件转换后实际键为 `semesterStartMonth`，导致可配置学期边界月永远读不到（见 Bug 1）。

### 6.4 课程矩阵 composables

- **单元格结构与字段映射**：经中间件转换后一致，`startSemester/endSemester/weeklyHours/weeksPerSemester/planCourseSemesters/planTextbooks` 等访问对齐。
- **编辑保存字段映射**：功能正确，但 camelCase/snake_case 混用（`createSemester`/`updatePlanCourse` 用 snake_case，`updateSemester`/`setSemesterTextbook`/`batchUpdateSemesterWeeks` 用 camelCase）。
- **教材 REPLACE 语义**：前端"单教材"模型与后端"替换"语义匹配。但前端仅取 `planTextbooks[0]`（`editing.js:83`），若库中存在多教材关联，保存会静默删除其余教材。
- **`buildSemesterWeeks` 丢失按学期差异**（`useCourseMatrixData.js:41-51`）：仅取 `planSemesters[0].weeksCount` 填充统一数组，因 `calcTotalHours` 优先用 `sem.weeksCount`，实际合计不受影响，但 `semesterWeeks` 语义误导。

### 6.5 其他 composables

- **useCrudList**：无分页/排序状态（仅被 College/TrainingLevel/Major 使用），`load()` 无请求取消或序号比对，潜在竞态（当前触发概率低）。
- **useExport**：blob 错误处理缺陷（见问题 5）。
- **useImport**：`AbortController` 取消能力到位，"上传进度"为伪进度（自建 DOM 遮罩未用 axios `onUploadProgress`），双重错误提示（见问题 6）。
- **useFilterLinkage**：级联清理正确，但 `getIntersectedOptions` 缺 null 守卫（见问题 3）。
- **useDebounce**：`useDebouncedRef` 返回非真正 Ref 且全仓库未使用（死代码）；`useDebounceFn` 实现正确。
- **useCountUp**：`immediate` 首帧不触发动画，`easingFns[easing]` 无未知名回退会 TypeError。
- **useResponsive**：模块级共享 ref + 引用计数，设计正确。

---

## 七、视图页面与路由审查详情

### 7.1 router/index.js

- **角色判断**：系统存在 `admin`/`super_admin`/`viewer` 三种角色（无 `teacher` 角色）。`requiresAdmin` 校验 `admin || super_admin`，`requiresSuperAdmin` 校验 `super_admin`，逻辑正确。
- **路由懒加载**：所有页面组件均使用 dynamic import，`Layout` 为静态导入（合理）。
- **登录重定向**：守卫传递 redirect，`Login.vue` 做开放重定向防护（`startsWith('/') && !startsWith('//')`），安全正确。
- **权限警告不显示 bug**：`permissionWarning` 仅在 Layout `onMounted` 读取，用户已在 `/dashboard` 时访问受限路由，重定向到同路由是 no-op，Layout 不重新挂载，警告永不展示。

### 7.2 views/Dashboard.vue

- **字段映射**：`plans`/`teachingTeachers`/`majors`/`courses`/`classes`/`textbooks`/`totalStudents`/`totalWeeklyHours` 全部正确对应后端返回。
- **状态处理**：有 skeleton loading，但 `fetchStats`/`fetchInsights` 失败仅 `console.error` 无用户提示；洞察区域无独立 loading。
- **sparkline**：为 `Math.sin` 生成的 mock 趋势数据，非真实历史。

### 7.3 views/teaching/TeachingArrange.vue

- **排课流程**：单课程/批量排课均通过 SSE 调用，预览模式确认后以 `preview: false` 重新执行。
- **并发控制**：`arranging`/`batchArranging` 分离标志，进度弹窗 `close-on-click-modal=false`、`show-close=false`，footer 仅 `finished` 时显示关闭按钮。
- **SSE 超时 bug**：见 Bug 2。
- **单/批量无交叉状态检查**：`handleAutoArrange`/`handleBatchAutoArrange` 开确认弹窗前不检查对方状态标志（模态弹窗实践中阻止并发，但非显式）。

### 7.4 views/query/UnifiedSemesterQuery.vue 和 UnifiedTextbookQuery.vue

- **筛选与分页**：参数传递与后端 naming 中间件对接正确。
- **字段映射**：`enrollmentYear`/`studentCount`/`courseName`/`weeklyHours` 等全部正确。
- **客户端分页**：`UnifiedTextbookQuery` 对 `detail.value.classes` 做客户端切片，正确。
- **`goToCurrentSemester` 双重加载**：学期值变化触发 `@change` + 显式 `resetPaginationAndLoad`，导致 `load()` 调用两次（第二次命中缓存）。

### 7.5 views/class/ClassList.vue 及子组件

- **方案匹配展示**：`matchedPlanName`/`matchedPlanType`/`planMatchWarning` 三个字段正确读取后端返回。
- **分页参数**：`pagination = { page: 1, pageSize: 20, total: 0 }`，`el-pagination` 配置正确。
- **筛选联动**：9 种关联关系从后端首次加载响应提取，`_relationsLoaded` 标志确保仅加载一次。
- **批量删除双弹窗**：`batchDeleteClasses` 未用 silent，失败时拦截器 + catch 双弹窗（`closeAll` 部分缓解）。

### 7.6 views/plan/PlanList.vue 和 PlanDetail.vue

- **删除守卫前端提示**：读取 `customLinkedClassCount`/`matchedClassCount` 生成提示，完整。
- **PlanList load() 无 catch**：仅 `try...finally`，失败时依赖 request 拦截器弹窗。
- **刷新标志机制**：`sessionStorage.setItem('planListNeedsRefresh', 'true')` + `consumeRefreshFlag` + `onActivated` 中 `silentReload`，完整。

### 7.7 App.vue 和 main.js

- **全局错误处理**：四层错误捕获（`errorHandler`/`warnHandler`/`unhandledrejection`/`error`），均仅 DEV 环境输出。
- **初始化顺序**：先 `await authStore.initAuth()` 再挂载，确保路由守卫依赖的认证状态已初始化。
- **无问题**。

---

## 八、问题汇总表

### 功能 Bug

| 编号 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| Bug 1 | `client/src/composables/useSemesters.js:50` | 读取 settings 用 snake_case 键 `semester_start_month`，经响应中间件转换后实际键为 `semesterStartMonth`，导致可配置学期边界月永远读不到 | 高 |
| Bug 2 | `client/src/api/teachingArrange.js:46-48` | SSE 超时 `clearTimeout` 在响应头到达后立即执行，后续 `reader.read()` 循环无超时保护，流静默停滞时客户端无限等待 | 高 |

### 需修复的问题

| 编号 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| 3 | `client/src/components/filter/composables/useFilterLinkage.js:104-115` | `getIntersectedOptions` 对 `relationData` 为 undefined 无守卫，会抛 TypeError | 中 |
| 4 | `client/src/composables/useSortable.js:44-54` | `Promise.all` 双请求部分失败时跳过 `reloadFn`，本地列表与服务端不一致 | 中 |
| 5 | `client/src/utils/request.js:143` | blob 响应失败时 `error.response.data?.message` 为 undefined，后端真实错误丢失 | 中 |
| 6 | `client/src/composables/useImport.js:387-392` | 导入失败时 request 拦截器 + `onImportError` 双重弹窗 | 中 |
| 7 | `client/src/views/class/components/ClassTable.vue:162-189` | 重复实现后端 grade 公式且硬编码边界月 `month>=8` | 中 |
| 8 | `client/src/stores/auth.js` + `stores/settings.js` | 无 `storage` 事件监听，多标签页登出/登录不同步 | 中 |
| 9 | `client/src/api/types.js:261-270` | `DashboardStats` 等类型定义与后端实际返回严重不符 | 低 |

### 优化建议

| 位置 | 问题 |
|---|---|
| `client/src/router/index.js:225-239` | 权限警告不显示（已在 `/dashboard` 时访问受限路由） |
| `client/src/views/Dashboard.vue:278-279,308-310` | 加载失败无用户可见提示 |
| `client/src/views/Dashboard.vue:289-311` | 洞察区域无独立 loading |
| `client/src/views/query/UnifiedSemesterQuery.vue:446-455` | `goToCurrentSemester` 双重加载 |
| `client/src/views/class/ClassList.vue:516-517` | 批量删除未用 silent 选项 |
| `client/src/composables/useCourseMatrixEditing.js` | 请求体 camelCase/snake_case 混用 |
| `client/src/composables/useCourseMatrixEditing.js:83` | 仅取 `planTextbooks[0]`，多教材会被静默删除 |
| `client/src/composables/useDebounce.js:9-34` | `useDebouncedRef` 死代码 |
| 后端 3 个死接口 | `POST /auth/download-token`、`POST /settings/initialize`、`GET /export/semester` |

---

## 九、修复优先级建议

**建议优先修复 Bug 1、2 和问题 3-6（共 6 项）**，理由：

1. Bug 1、2 是确定的逻辑缺陷，虽触发场景非高频，但一旦触发体验差（学期边界月失效、SSE 卡死无恢复）。修复成本极低。
2. 问题 3-6 集中在错误处理与防御性编程，修复后能显著提升异常场景健壮性，且都是低风险改动。
3. 问题 7-9 及优化建议属于工程优化，不影响当前功能正确性，可在后续迭代中按需处理。
4. 跨标签页同步（问题 8）是公共机器场景的真实风险，若部署环境为教师个人 PC，优先级可降为中低。
