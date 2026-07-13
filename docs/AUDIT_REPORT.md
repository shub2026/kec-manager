# KEC 课程管理平台 — 安全审计与业务逻辑审查报告

> 审查日期：2026-07-03  
> 审查范围：`server/src`（后端全部）、`client/src`（前端路由与 API 层）  
> 审查版本：v2.17.2

> **状态更新（v1.4.1，2026-07-13）**：
> - **VULN-1**（Token 非 HttpOnly）：✅ 已修复 — v1.3.0 S-01 实现 HttpOnly Cookie 托管，refreshToken 完全交由 HttpOnly Cookie 管理
> - **VULN-2**（XSS 清洗未全覆盖）：✅ 已修复 — `sanitizeBody` 和 `sanitizeQuery` 均已在 `app.js` 中全局注册
> - **VULN-3**（缺少 CSRF 防护）：✅ 已修复 — Double Submit Cookie 模式已实现，`csrf.js` 中间件已全局挂载
> - **VULN-4**（系统重置无密码确认）：⚠️ 已添加速率限制（每用户每小时最多 3 次），密码二次确认暂未实现
> - **VULN-5 ~ VULN-9**：✅ 已处理或确认无需修改（VULN-6 生产密钥强度校验、VULN-7 废弃函数已移除、VULN-8 生产环境脱敏已实现）
> - **BIZ-1 ~ BIZ-4**：✅ 已处理 — BIZ-1 学期计算已统一为 `calcClassSemester`（v1.3.3），BIZ-2 方案匹配已统一为 `findBestMatchPlan`，BIZ-3/BIZ-4 确认当前实现正确

---

## 一、高危安全漏洞

### 🔴 VULN-1：Token 存储于 JS 可访问的 Cookie（XSS 可窃取）

**位置**：`client/src/utils/cookies.js`、`client/src/stores/auth.js`

**问题描述**：
- Access Token 和 Refresh Token 均通过 `document.cookie` 写入，**非 HttpOnly**，任何 XSS 漏洞均可直接读取。
- `cookies.js` 第 5-8 行注释已明确说明此为"过渡方案"，但生产环境仍未修复。
- `localStorage` 也存储了 `userInfo`（非敏感），但 token 本身若在 Cookie 中可被 JS 读取，则 XSS 攻击可冒充用户。

**风险等级**：🔴 高危

**修复方案**：
1. 后端登录/刷新接口改为通过 `Set-Cookie: HttpOnly; Secure; SameSite=Strict` 下发 token
2. 前端不再通过 JS 读写 token Cookie，改为仅携带 `withCredentials`
3. 若需兼容当前架构，至少确保 XSS 防护层无死角（见 VULN-2）

**影响分析**：⚠️ 涉及前端认证流程重构，影响 `auth.js` Store、`request.js` 拦截器、路由守卫。建议分期迁移。

---

### 🔴 VULN-2：XSS 清洗未覆盖所有输入入口

**位置**：`server/src/middleware/xss.js`、`server/src/middleware/validation.js`

**问题描述**：
- `sanitizeBody` 仅清洗 `req.body`，但 `req.query` 的清洗由 `sanitizeQuery` 负责。
- 经检查路由配置，**`sanitizeQuery` 未被统一注册到全局中间件**，仅部分路由可能单独使用。
- 若攻击者通过 URL 查询参数注入 XSS payload（如 `?name=<script>...`），后端日志或前端反射渲染可能触发 XSS。

**风险等级**：🔴 高危

**修复方案**：
在 `server/src/server.js` 的全局中间件注册中，确保 `sanitizeBody` 和 `sanitizeQuery` 均被注册：
```js
app.use(sanitizeBody);
app.use(sanitizeQuery);
```

**影响分析**：✅ 纯安全加固，不影响业务逻辑。但需注意：`sanitizeQuery` 对 Express 5 的只读 `req.query` 做原地修改，若某些路由依赖原始 query 值（未 XSS 清洗的），需确认。

---

### 🔴 VULN-3：导入接口缺少 CSRF 防护（Cookie 认证模式）

**位置**：`server/src/controllers/import.controller.js`、`client/src/utils/request.js`

**问题描述**：
- 前端 `request.js` 中确实读取了 `XSRF-TOKEN` Cookie 并设置为 `X-CSRF-Token` 头（第 25-28 行）。
- 但后端 **未实现 CSRF Token 生成与校验逻辑**，`import.controller.js` 也未进行 CSRF 检查。
- 若攻击者诱导已登录管理员访问恶意页面，可伪造文件上传请求。

**风险等级**：🔴 高危（针对管理员）

**修复方案**：
1. 后端登录成功后生成 CSRF Token 存入 Cookie（`XSRF-TOKEN`）
2. 后端新增 CSRF 中间件，校验 `X-CSRF-Token` 头与 Cookie 值是否匹配
3. 注意：`/api/auth/login` 本身不需要 CSRF 防护（因为不需要已认证状态）

**影响分析**：⚠️ 影响所有状态修改接口（POST/PUT/DELETE）。需确保前端自动携带 CSRF Token。

---

### 🔴 VULN-4：系统重置接口缺少二次确认防护

**位置**：`server/src/controllers/settings.controller.js` 第 180-233 行 `resetSystem`

**问题描述**：
- `resetSystem` 仅通过 `validateReset` 校验请求体中是否有 `confirm: 'DELETE'`。
- 但该接口**未校验用户密码**，仅依赖 JWT 令牌。若令牌泄露（如 XSS 窃取），攻击者可一键清空全部业务数据。
- 对比：`changePassword` 要求提供 `old_password`，但 `resetSystem` 无此要求。

**风险等级**：🔴 高危

**修复方案**：
1. 系统重置接口额外要求提供当前用户密码（`current_password` 字段）
2. 或在超级管理员操作前要求重新输入密码（类似 `changePassword` 逻辑）

**影响分析**：✅ 仅影响系统重置流程，不影响其他接口。前端需新增确认弹窗。

---

## 二、中危安全漏洞

### 🟡 VULN-5：文件上传目录可被猜测访问

**位置**：`server/src/controllers/import-shared.js` 第 51 行

**问题描述**：
- `multer` 将上传文件存入 `uploads/` 目录（项目根目录下）
- 若 Nginx/Express 静态文件中间件配置了 `express.static('uploads')`，攻击者可直接访问上传的 Excel 文件
- 即使无静态文件服务，文件名若可被猜测，仍存在信息泄露风险

**风险等级**：🟡 中危

**修复方案**：
1. 将 `uploads/` 目录移出 Web 根目录，或通过动态文件路径（UUID 命名）存储
2. 确保 `server.js` 中无 `express.static('uploads')` 配置

**影响分析**：✅ 不涉及业务逻辑变更，仅调整文件存储位置。

---

### 🟡 VULN-6：JWT 密钥强度不足（开发环境警告）

**位置**：`server/src/server.js`（启动警告）

**问题描述**：
- 启动时出现警告：`JWT_SECRET 强度不足（少于32字符或为占位符）`
- 开发环境使用弱密钥，若生产环境 `.env` 未正确配置，攻击者可伪造 JWT Token

**风险等级**：🟡 中危（取决于生产环境配置）

**修复方案**：
1. 生产环境部署脚本（`deploy.sh`）中强制生成随机 64 位 hex 密钥
2. 在 `auth.config.js` 中增加启动时密钥强度校验，弱密钥在生产环境直接拒绝启动（当前仅 warn）

**影响分析**：✅ 不涉及代码逻辑变更，仅配置加固。

---

### 🟡 VULN-7：学期解析函数存在重复实现

**位置**：`server/src/services/settings.service.js`（已废弃的 `parseSemesterString`）、`server/src/services/semester.service.js`（`parseSemester`）

**问题描述**：
- `settings.service.js` 中 `parseSemesterString` 标记为 `@deprecated`，但仍被部分文件引用
- 两套实现若行为不一致，可能导致某些接口学期解析错误
- 当前 `parseSemester` 已做了严格校验（整数部分检查、年份范围），但需确认所有调用方已迁移

**风险等级**：🟡 中危（逻辑一致性风险）

**修复方案**：
1. 全局搜索 `parseSemesterString` 调用，统一迁移至 `parseSemester`
2. 彻底删除 `settings.service.js` 中的废弃实现

**影响分析**：⚠️ 需确认所有调用方已兼容新返回结构（`null` vs `{success, data}`）。

---

## 三、低危安全漏洞

### 🟢 VULN-8：错误响应中可能存在敏感信息泄露（开发模式）

**位置**：`server/src/middleware/error.js` 第 69-72 行

**问题描述**：
- 开发环境下，错误响应返回 `err.message`（原始错误信息）
- 若某些错误对象包含 SQL 片段、文件路径等，可能泄露系统信息
- 当前 `errorHandler` 已做了生产环境脱敏处理（`isProduction` 判断），但开发环境仍可能泄露

**风险等级**：🟢 低危

**修复方案**：
开发环境下可保留详细错误，但确保生产构建（`NODE_ENV=production`）时不会泄露敏感信息。当前实现已正确处理，此为防御性建议。

**影响分析**：✅ 不影响业务逻辑。

---

### 🟢 VULN-9：前端路由守卫中 `sessionStorage` 存储权限警告

**位置**：`client/src/router/index.js` 第 228 行、第 239 行

**问题描述**：
- 权限不足时，通过 `sessionStorage.setItem('permissionWarning', ...)` 存储警告消息
- `sessionStorage` 可被同一 Tab 内的 JS 访问，若存在 XSS 漏洞，攻击者可读取
- 但此为低风险，因为警告消息本身非敏感信息

**风险等级**：🟢 低危

**修复方案**：
改为通过 Pinia Store 或 `router.app.config.globalProperties` 传递警告消息，避免 `sessionStorage`。

**影响分析**：✅ 仅影响前端警告消息展示逻辑。

---

## 四、业务逻辑问题

### 📊 BIZ-1：学期计算逻辑存在两套实现，结果可能不一致

**位置**：
- `server/src/controllers/class.controller.js` 第 10-26 行 `calculateClassStatus`
- `server/src/services/semester.service.js` 第 86-95 行 `calcClassSemester`

**问题描述**：
- `calculateClassStatus`（旧实现）直接计算 `grade = startYear - enrollmentYear + 1`，返回 `'active'` 或 `'graduated'`
- `calcClassSemester`（新实现）计算 `currentSemesterNum = (grade - 1) * 2 + semesterIndex`，并返回 `{grade, currentSemesterNum}`
- `class.controller.js` 的 `listClasses` 使用了 `calculateClassStatus`，而 `query.controller.js` 使用了 `calcClassSemester`
- 若两套实现对于边界情况（如 `grade < 1` 或 `grade > durationYears`）处理不一致，会导致班级状态显示错误

**当前状态**：
- `calcClassSemester` 已有越界检查（`grade < 1 || grade > durationYears` 返回 `null`）
- `calculateClassStatus` 无显式越界检查，仅依赖 `grade <= durationYears` 判断

**修复方案**：
统一使用 `calcClassSemester` 计算班级状态，`calculateClassStatus` 标记为 `@deprecated` 并逐步迁移。

**影响分析**：⚠️ 影响班级列表的状态展示、查询模块的班级过滤。需全面回归测试。

---

### 📊 BIZ-2：培养方案匹配逻辑在多处重复实现

**位置**：
- `server/src/services/plan.service.js`：`findBestMatchPlan`、`isClassMatchPlan`
- `server/src/controllers/plan/plan.controller.js`：`listPlans` 中的匹配逻辑
- `server/src/controllers/query.controller.js`：查询模块中的匹配逻辑

**问题描述**：
- `findBestMatchPlan` 已实现统一的三级匹配优先级（自定义方案 > 专业匹配 > 层次匹配）
- 但 `plan.controller.js` 的 `listPlans` 中，统计 `matchedCountMap` 时使用了双重循环（`for (const plan of plans) { if (isClassMatchPlan(cls, plan)) ... }`），性能较差（O(n*m)）
- 查询模块中的匹配逻辑已正确使用 `findBestMatchPlan`，但需确认所有入口均一致

**当前状态**：
代码注释显示已进行过多轮修复（如 `S-05 修复`、`M-4 修复`），当前实现已基本统一。

**修复方案**：
无需修改逻辑，但建议在 `plan.service.js` 中导出标准化函数后，全局搜索并确保无重复实现。

**影响分析**：✅ 当前逻辑已正确，此为代码质量优化。

---

### 📊 BIZ-3：排课模块中 `weekly_hours` 为 `Float` 类型，但校验规则限制为整数

**位置**：
- `server/prisma/schema.prisma` 第 109 行：`weekly_hours Float`
- `server/src/middleware/validation.js` 第 529 行：`isFloat({ min: 0, max: 40 })`

**问题描述**：
- 数据库字段为 `Float`（支持小数如 1.5、2.5），但校验规则使用 `isFloat`
- `isFloat` 允许小数，但前端表单可能限制为整数输入
- 业务上确实存在 0.5 倍数课时（如 2.5 课时），需确认前端是否支持

**当前状态**：
`schema.prisma` 注释已说明 `Float` 类型的原因（`业务上通常为 0.5 倍数，SQLite REAL 精度足够`）。

**修复方案**：
1. 确认前端课时输入是否支持小数（如 `el-input-number :step="0.5"`）
2. 若不支持，需统一为 integer 或添加前端校验

**影响分析**：⚠️ 影响排课模块的课时输入。若需支持小数，前端和导出逻辑均需调整。

---

### 📊 BIZ-4：自动排课算法中的教师课时容量校验

**位置**：`server/src/services/teaching-arrange.service.js`（需进一步审查）

**问题描述**：
- `teaching-arrange.controller.js` 第 238-254 行实现了非阻塞工作量警告（检查教师当前学期总课时是否超阈值）
- 但此警告在**排课完成后**才检查，若自动排课算法未严格执行容量约束，可能产生超量排课
- 需深入审查 `autoArrange` 和 `batchAutoArrange` 中的容量约束逻辑

**修复方案**：
深入审查 `server/src/services/teaching-arrange.service.js` 中的 `autoArrange` 函数，确认：
1. 教师标准课时（`default_weekly_hours`）和满载课时是否正确加载
2. 排课时是否实时检查并拒绝超量分配
3. 若算法允许超量，需在前端明确提示

**影响分析**：⚠️ 影响排课结果的正确性。若算法有 bug，需修复并重新测试排课结果。

---

## 五、数据一致性问题

### 📋 DATA-1：班级删除时排课记录的处理

**位置**：`server/src/controllers/class.controller.js` 第 423-481 行 `deleteClass`

**问题描述**：
- 当前实现：删除班级前检查是否存在排课记录（`teaching_assignments`），若存在则拒绝删除（返回错误消息）
- 但 `updateClass` 中，若班级标记为离校（`is_left_school = true`），会**自动级联删除**当前及未来学期的排课记录（第 380-385 行）
- 这两种行为可能让用户困惑：为什么"标记离校"会删除排课记录，但"删除班级"却拒绝？

**当前状态**：
代码注释说明此为 `H-3` 修复（`删除前检查排课记录，为 schema Cascade→Restrict 做准备`）。

**修复方案**：
1. 若业务上允许删除班级时同步删除排课记录，可在 `deleteClass` 中增加事务删除（类似 `updateClass` 的逻辑）
2. 若不允许，则保持当前行为，但需在前端明确提示用户需先手动删除排课记录

**影响分析**：⚠️ 影响班级删除流程。需与业务方确认预期行为。

---

### 📋 DATA-2：培养方案删除时的级联行为

**位置**：`server/src/controllers/plan/plan.controller.js` 第 322-395 行 `deletePlan`

**问题描述**：
- 删除培养方案时，将 `custom_plan_id` 直接引用的班级的 `custom_plan_id` 置 `null`（事务内）
- `plan_courses`、`plan_course_semesters`、`plan_textbooks` 通过 schema `onDelete: Cascade` 自动级联删除
- 但**按专业/层次匹配**的班级在删除方案后自然不再匹配该方案，此行为是否符合业务预期？

**当前状态**：
代码注释已详细说明行为变更（`应需求：已关联班级的方案允许删除`）。

**修复方案**：
无需修改，但建议在前端删除确认弹窗中，明确展示：
1. 将被解除关联的班级数（`unlinkedCount`）
2. 将被级联删除的子记录数（`cascaded_plan_courses` 等）

**影响分析**：✅ 当前实现已符合需求，仅需优化前端提示。

---

## 六、修复优先级与实施建议

### 优先级排序

| 编号 | 问题 | 风险等级 | 修复难度 | 建议优先级 |
|-----|------|---------|---------|-----------|
| VULN-1 | Token 非 HttpOnly | 🔴 高危 | 高 | **P0** |
| VULN-2 | XSS 清洗未全覆盖 | 🔴 高危 | 低 | **P0** |
| VULN-3 | 缺少 CSRF 防护 | 🔴 高危 | 中 | **P1** |
| VULN-4 | 系统重置无密码确认 | 🔴 高危 | 低 | **P1** |
| VULN-5 | 上传目录可访问 | 🟡 中危 | 低 | **P2** |
| VULN-6 | JWT 密钥强度 | 🟡 中危 | 低 | **P2** |
| BIZ-1 | 学期计算逻辑重复 | 📊 业务 | 中 | **P2** |
| BIZ-3 | 课时小数支持 | 📊 业务 | 中 | **P3** |
| BIZ-4 | 排课容量校验 | 📊 业务 | 高 | **P1** |

---

## 七、总结

### 安全性
项目已实施了多项安全防护（XSS 中间件、JWT 黑名单、密码 bcrypt 加密、权限中间件等），但仍有若干高危漏洞需优先修复（**Token 存储安全、XSS 全覆盖、CSRF 防护**）。

### 业务逻辑
学期计算、培养方案匹配等核心逻辑经过多轮修复，当前实现已基本正确。但**存在重复实现**（学期计算、方案匹配），建议统一收敛至 `semester.service.js` 和 `plan.service.js`。

### 数据一致性
级联删除逻辑已通过事务保证原子性，且审计日志记录了关键操作。需注意**班级删除与标记离校的行为差异**，建议与业务方确认预期。

### 下一步行动
1. **立即修复**（P0）：Token HttpOnly、XSS 全覆盖
2. **短期修复**（P1）：CSRF 防护、系统重置确认、排课容量审查
3. **长期优化**（P2-P3）：统一重复实现、上传目录安全、前端课时输入支持小数

---

*本报告基于静态代码审查，建议配合单元测试、集成测试与手动测试验证修复效果。*
