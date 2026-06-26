# 变更日志

所有重要的项目更改都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本控制遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.13.2] - 2026-06-26

### 功能增强

- **教师导入自动创建关联基础数据**：导入教师时，Excel 中的归属学院、任课学院、任课层次如果不存在，将自动创建（与班级导入行为一致），不再静默丢弃。自动创建的记录会标记描述"由教师导入自动创建"
- **首页数据概览基于当前学期**：新增 `GET /api/dashboard/stats` 统一接口，8 项统计数据（专业、课程、班级、教材、方案、学生、教师、周课时）均按当前学期维度计算，其中课程数量为实际排课课程数。前端从 6 次独立 API 调用合并为单次请求

### 代码质量

- Prettier 全量格式化（前后端）

---

## [2.12.4] - 2026-06-25

### 架构审计修复（15项安全漏洞 + 业务逻辑修复）

#### 高危（HIGH）
- **S-01** 删除学院/层次前增加教师排课偏好、培养方案、教师所属关联检查，防止 `onDelete: Cascade` 静默清除数据
- **S-02** 排课置换算法 `trySwapOne` 对教师 T 和 T2 均增加学院/层次资格校验，防止绕过业务规则
- **S-03** `getClassesWithCourse` 年级筛选改为范围匹配，修复多学制场景下漏排问题
- **S-04** `parseSemesterString` 增加学期索引范围（1-2）、年份连续性、年份区间校验

#### 中危（MEDIUM）
- **S-05** `listPlans` 班级计数改用 `findBestMatchPlan` 优先级语义（自定义>专业>层次），消除重复计数
- **S-06** `deleteMajor` 增加培养方案前置检查，防止 `onDelete: SetNull` 静默破坏方案匹配
- **S-07** 教师导入时空列不再清除现有排课学院/层次偏好
- **S-08** 课程导入已有课程仅在 Excel 显式指定类型时才更新，防止默认值覆盖

#### 低危（LOW）
- **S-11** `resetBasic`/`resetColleges`/`resetLevels` 显式删除教师排课偏好表，替代依赖级联隐式清除
- **S-12** 下载令牌路径补充用户激活状态校验，与 Bearer Token 路径一致
- **S-13** 批量排课预览增加 `globalTextbookMap` 跨课程累计教材负载，提升教材内聚分析准确性
- **S-14** 班级导入 catch 块重置计数器，防止事务回滚后报告不准确
- **S-09/S-10** 并发锁和排序竞态添加文档注释，标注单进程限制

## [2.12.3] - 2026-06-24

### 安全修复（全盘代码审查后批量修复）

- **C-1 密码字段 XSS 清洗致永久锁死（CRITICAL）**：`xss.js` 新增 `SKIP_SANITIZE_KEYS` 白名单（password/old_password/new_password 等），密码字段跳过 XSS 清洗。此前修改密码时含 `<>` 字符的密码会被篡改，导致 bcrypt 比对永久失败，用户无法登录
- **H-1 备份文件残留**：删除 `teaching-arrange.service.js.bak-20260620-185807`，`.gitignore` 新增 `*.bak` / `*.bak-*` 规则
- **H-2 密码策略不一致**：`validation.js` 的 `validateChangePassword` 正则改为与 `validateUser` 一致的严格字符集 `[A-Za-z\d@$!%*?&]{8,128}`
- **H-4 sanitizeBody 未全局应用**：`app.js` 在 `express.json` 之后全局挂载 `sanitizeBody`，密码字段在中间件内自动跳过，消除各路由手动添加的遗漏风险
- **H-5 querySemester 分页无上限**：`query.controller.js` 的 `pageSizeNum` 强制 `Math.min(Math.max(n, 1), 100)`，防止 `?pageSize=999999` 致 OOM

### 数据一致性修复

- **M-2 updateClass 级联删除非事务**：班级更新与排课记录删除包入 `prisma.$transaction`，保证原子性，避免删排课失败时数据不一致
- **M-7 重置接口无速率限制**：`settings.routes.js` 新增 `resetLimiter`（每用户每小时最多 3 次），应用到所有 `/reset/*` 路由，防止账号被盗后瞬间清空全部数据
- **M-8 validatePagination 参数被忽略**：`pagination.js` 的 `validatePagination(maxPageSize=100)` 接受参数，动态设置 `isInt` 的 max 上限

### 前端代码质量修复

- **P1 main.js errorHandler**：`console.error` 加 `import.meta.env.DEV` 守卫，生产环境零控制台输出泄露
- **P2 useCrudList handleSave 缺 catch**：API 异常时展示 `ElMessage.error` 用户提示
- **P2 settings.js / useSortable.js / useExport.js**：`console.error` 统一为单行 DEV 守卫格式
- **P3 download.js downloadBlob**：`a.click()` 包入 `try-finally`，异常时也能清理 DOM 节点和 ObjectURL

---

## [2.12.2] - 2026-06-24

### Bug 修复

- **命名转换中间件数组处理修复**：`naming.js` 的 `snakeToCamel` / `camelToSnake` 将 `Array.isArray` 检查移至构造函数守卫之前，修复嵌套对象数组（如 courses、textbooks）内字段未被转换的问题。此前 `weekly_hours`、`course_id` 等字段在数组内保持 snake_case，导致前端 `weeklyHours` 为 undefined，周课时合计显示 NaN
- **教材定价乱码修复**：`naming.js` 两个转换函数添加 `constructor !== Object` 守卫，跳过 Prisma Decimal 等类实例，避免递归展开内部属性 `{s,e,d}` 导致乱码

### 导出接口对齐

- **教师导出**：标签对齐前端（"任课学院"→"意向学院"，"任课层次"→"意向层次"，"教师姓名"→"姓名"），列顺序与 TeacherList.vue 一致
- **课时统计导出**：标签对齐前端（"教师姓名"→"姓名"，"上课班级数"→"班级数"），列顺序与 TeachingStatistics.vue 一致
- **教学安排导出**：新增缺失字段（入学年份、在读学期、人数、培养层次），列顺序与 TeachingArrange.vue 一致
- **开课查询导出**：新增缺失字段（在读学期、开课数、周课时合计），列顺序与 UnifiedSemesterQuery.vue 一致

### 二次检查报告修复（v2.12.1）

- **C-2 并发锁**：`auto-arrange.js` 单课程排课添加内存锁 `arrangeLocks`
- **H-2 密码复杂度**：`validateUser` 添加密码复杂度校验
- **H-3 日志降级**：排课诊断日志从 `info` 降为 `debug`
- **H-4 无效 include**：移除 `assignTeacher` 中 `semester: null` 的死代码 include
- **M-2 JWT 过期时间**：`auth.config.js` 改为从环境变量读取
- **M-5 事务优化**：`alreadyWritten` 计算从 O(A²) 优化为 O(A)
- **其余 M/L 级问题全部修复**，详见 `docs/kec-manager-v2.12-二次检查报告.md`

---

## [2.9.1] - 2026-06-23

### Bug 修复

- **排序回归修复**：移除 CollegeList、MajorList、CourseList、TextbookList、TrainingLevelList 五个页面的 el-table `:default-sort` 属性，避免客户端按名称排序覆盖服务端 `sort_order` 排序
- **教材启用/停用 500 错误**：`toggleTextbookStatus` 改用 `req.body?.is_active` 可选链，修复 POST 无 body 时 `req.body` 为 undefined 导致的 TypeError 崩溃
- **教材已用教材重复显示**：后端 `queries.js` 对 `assignedIds` 加 `new Set()` 去重；前端 `TeachingArrange.vue` 新增 `uniqueTextbooks()` 函数按 ID 去重显示

### 文档

- 全面代码审计报告归档至 `docs/kec-manager-审计报告.md`，共 50 项（C3+H12+M20+L15），新增 M-19（学期查询年级筛选分页 total 不准）、M-20（排课统计导出忽略筛选条件）

---

## [2.9.0] - 2026-06-23

### 前端健壮性修复

- **H-1 ElMessageBox 确认框异常捕获**：`UserManagement.vue` 的 `toggleUserStatus` 和 `deleteUser` 将 `ElMessageBox.confirm` 移入 try-catch，取消操作不再抛出未捕获异常
- **H-2 表单验证 Promise 模式修复**：`Login.vue` 和 `UserManagement.vue` 的 `formRef.value.validate(callback)` 改为纯 Promise 模式 `await formRef.value.validate()`，修复 callback 模式下 `await` 为空操作的隐患
- **H-11 settings store 防御性加载**：`load()` 添加 try-catch 和学期字符串防御性解析，API 返回格式异常时不再崩溃

### 后端逻辑修复

- **H-4 教材状态切换修复**：`toggleTextbookStatus` 改为接受 `req.body.is_active` 目标状态，而非盲目 toggle
- **H-5 课程删除关联检查补全**：`deleteCourse` 新增 `teaching_assignments` 和 `teacher_courses` 计数检查，防止删除有排课或教师关联的课程

### 性能优化

- **H-6 教师排课查询过滤**：`getTeachersForCourse` 中 `teacherAssignmentsWithCollege` 和 `teacherAssignmentsWithLevel` 添加 `teacher_id` 过滤，避免拉取整个学期的排课数据
- **H-7 课时统计消除 N+1 查询**：`getStatistics` 预加载所有 `training_levels` 构建全局 Map，替代 Promise.all 内逐教师查询
- **H-8 教师导入消除 N+1 查询**：预加载所有导入行涉及的教师姓名构建索引 Map，替代循环内逐行 DB 查询
- **H-9 教材使用概览 O(n²)→O(n)**：`queryAllTextbooksUsage` 构建 `classId→class` Map 替代循环内 `Array.find()`
- **H-10 班级列表查询合并**：`listClasses` 7 次独立班级查询合并为单次查询 + 单次遍历推导所有关联映射

### 数据库安全

- **H-3 排课记录外键约束加固**：`teaching_assignments` 三个外键从 `onDelete: Cascade` 改为 `onDelete: Restrict`，防止删除教师/班级/课程时静默级联丢失排课数据。三个控制器（`deleteTeacher`/`deleteClass`/`deleteCourse`）均已添加前置排课检查

### 安全评估

- **H-12 JWT Token 安全评估**：当前架构（15分钟 access token + 7天 rotating refresh + 角色实时刷新 + 速率限制）对小型内部工具安全级别合理。后续建议将 token 存储从 JS 可访问 cookie 迁移到 httpOnly cookie

## [2.8.2] - 2026-06-23

### Bug修复

- **系统重置错误处理**：`resetSystem` 和 `resetAuditLogs` 添加 try-catch 包裹，防止 Prisma 事务异常导致进程崩溃（C-1）
- **排课算法教材计算修复**：`trySwapOne` 置换逻辑中教材数量计算改为基于移除后集合，修复 MAX_TEXTBOOKS 约束被绕过的问题（C-2）
- **Dashboard ElMessage 导入修复**：添加缺失的 `ElMessage` 导入，修复点击"数据导入"按钮时的 ReferenceError（C-3）

## [2.7.1] - 2026-06-23

### 功能优化

- **教学排课预览模式增强**：预览结果弹窗增加“执行排课”按钮，减少重复操作
  - 点击执行后自动关闭预览弹窗并应用排课结果
  - 优化确认提示文案，明确区分预览和执行的区别
- **课时统计筛选器增强**：新增姓名筛选输入框
  - 支持模糊匹配教师姓名
  - 位于筛选器最前面，方便快速查找
  - 可与其他筛选条件组合使用

### Bug修复

- **培养方案匹配逻辑修正**：修复按层次关联方案的班级匹配问题
  - 专业和层次匹配改为平级OR关系，无先后顺序
  - 移除错误的 `!cls.major_id` 限制条件
- **班级管理页显示优化**：未关联方案的班级统一显示“未关联”标签
  - 标签颜色规范：自定义方案(橙色)、已关联(绿色)、未关联(灰色)
- **培养方案管理页颜色调整**：按层次关联类型从灰色调整为蓝色
  - 提升视觉区分度，便于识别不同关联方式

## [2.7.0] - 2026-06-21

### 代码质量提升

- **新增代码格式化支持**：集成 Prettier 和 ESLint，统一代码风格
  - 前端：配置 Vue 3 + Element Plus 格式化规则
  - 后端：配置 Node.js + Express 格式化规则
  - 添加 `npm run format` 和 `npm run lint` 脚本
  - 创建 CODE_FORMATTING.md 详细使用指南
- **代码格式化执行**：对全部前端（57个文件）和后端（68个文件）进行格式化
- **ESLint 配置升级**：迁移到 ESLint v9+ flat config 格式（eslint.config.js）

### 项目清理

- **删除冗余文档**：清理 docs/archive/ 目录中的 8 个历史报告文件
- **删除过时文档**：移除 4 个重复或过时的技术文档
- **删除临时脚本**：清理 server/scripts/ 中的 15 个一次性诊断脚本
- **删除根目录脚本**：移除 scripts/ 目录中的 3 个临时脚本
- **删除重复文件**：移除 deploy-gitee.sh（与 deploy.sh 重复）
- **删除空文件**：移除 nul 空文件
- **总计清理**：删除 31 个冗余文件，释放数百KB空间

### 文档更新

- **README 更新**：添加代码格式化章节，更新项目结构图
- **新增 CODE_FORMATTING.md**：详细的代码格式化使用指南
- **相关文档链接**：在 README 中添加代码格式化指南链接

### 依赖更新

- **前端新增依赖**：prettier ^3.8.4, eslint ^10.5.0, eslint-plugin-vue ^10.9.2, @vue/eslint-config-prettier ^10.2.0, @eslint/js ^10.0.1
- **后端新增依赖**：prettier ^3.8.4, eslint ^10.5.0, @eslint/js ^10.0.1

## [2.6.1] - 2026-06-20

### 排课算法优化

- **P1-A 教材亲和副作用隔离**：`isTextbookMatch` 改为始终使用教师固有教材快照（`inherentTextbookIds`），`buildTeacherConstraints` 固化固有教材副本。教师被分配新教材班级后不再因 `textbookIds` 累加而在后续轮次被误判为该教材匹配，避免非预期的亲和聚集挤占专任教师
- **P1-B 批量排课优先级改供需比**：从"仅按可用教师数"改为"班级总课时需求 / 可用教师剩余容量"的供需比。资源更紧张（供需比大）的课程优先处理，避免瓶颈课程因靠后排队而容量耗尽。新增 `plan_course_semesters` 聚合查询估算课时需求
- **P2 阶段4 后置换回溯**：兜底分配后对未分配班级尝试置换——若某教师 T 已满但其某班级 V 能被其他教师 T'' 接管，且 T 腾出容量后能容纳未分配班级 U，则执行置换。单轮置换（不递归），复杂度 O(U×T×A)，资源紧张时提升 5-15% 分配率。单元测试验证：2教师3班级场景下成功置换，容量与分配均正确

## [2.6.0] - 2026-06-19

### 安全修复（严重）
- **C-4** 修复系统重置确认验证可被绕过：`validateReset` 的 `confirm` 字段移除 `.optional()`，省略字段不再放行破坏性重置操作
- **C-5** 修复系统重置操作零审计痕迹：`resetSystem`/`resetAuditLogs` 审计记录改为事务内 `deleteMany` 后重新写入，确保破坏性操作可追溯
- **C-6** 修复前端生产镜像构建失败：Dockerfile 构建阶段去掉 `--only=production`，恢复 devDependencies（vite 等）安装

### 排课算法修复（严重/高危）
- **C-1** 修复培养方案匹配 `null===null` 误匹配：新增统一的三级互斥匹配函数 `isClassMatchPlan`（custom > major > level），补真值守卫，避免跨专业错误排课
- **C-2** 修复排课并发竞态：教师工作量读取与写入移入事务，事务内二次校验教师实际容量，超载分配降级跳过
- **C-3** 修复空分配跳过事务：非预览模式无论是否有新分配都执行 `deleteMany`，保证"全量替换"语义与幂等性
- **H-7** 修复手动排课 `weekly_hours` 静默置 0：update 分支未传时保留原值；增加教师活跃状态与可教课程校验
- **H-11** 修复批量预览不累积跨课程容量：预览模式维护教师工作量累积快照，保证容量计算顺序依赖
- **H-12** 收紧 `parseSemester` 仅支持学期索引 1/2（秋季/春季），暑期学期逻辑半实现风险消除
- **M-1** 提前返回前查询手动安排数，避免 `manualCount` 误报 0
- **M-3** `plan_courses` 查询加 `orderBy`，保证多方案匹配确定性
- **M-10** 周课时为 0 或负数的班级不参与排课，归入 unassigned 并告警

### 安全校验修复（高危）
- **H-5** 7 个 PUT 更新路由补全业务字段校验（teacher/textbook/course/major/college/trainingLevel/plan/class），新增 `validateClassUpdate`
- **H-6** 教学安排 5 个写接口新增 express-validator 校验（semester 格式、weekly_hours 范围、course_id 类型等）
- **H-8** 导出侧统一公式注入防护：`createWorkbook` 写入单元格前对 `= + - @` 开头字符串转义
- **H-9** 审计日志与 winston 日志脱敏：`handleValidationErrors` 剔除 password 字段；教师失败审计改白名单字段
- **L-3/L-4/L-5** 导出/查询 `:id` 参数挂 `validateIdParam`；教材 `publish_date` 格式校验；query 参数安全解析避免 NaN

### 认证权限修复（高危/中危）
- **H-1** 前端 Token Cookie 增加 `Secure` 标志（HTTPS 环境动态判断）
- **H-2** access token 校验用户是否仍存在且激活，并使用数据库最新角色（30s 缓存），防止降级/禁用后旧 token 仍生效
- **H-4** viewer 角色读取教师 PII 脱敏（birth_date）；含 PII 的导出接口（teachers/statistics/teaching-arrange）提升为 admin 权限
- **L-2** downloadToken 有效期缩短至 30s
- **M-2** `GET /api/settings` 匿名访问只返回 organization_name，登录用户（带 token）返回全部；`updateSettings` 校验 current_semester 格式

### 导入导出修复（高危/中危）
- **H-13** 教师导入课程 auto-create、班级导入 level/major/college upsert 移入事务，避免回滚后残留孤儿数据
- **H-14** Excel 解析增加行数上限（20000 行），防止 zip 炸弹 OOM
- **H-2(导入)** 班级导入增加行级数值范围校验（入学年份/学制/人数），与单条 API 一致
- **H-10** 导出接口增加限流（每分钟 10 次），防止并发全量导出 OOM
- **M-8** 教师导入去重检测同名多条时跳过，避免张冠李戴
- **M-9** 教师更新三张关联表 deleteMany+createMany 包入事务
- **M-10** `batchUpdateDefaultHours` 增加 teacher_ids 长度/类型校验
- **L-6** 审计日志 details 限制最大长度 2000 字符，防止表膨胀

### 阻断性 Bug 修复
- 修复 Express 5 下 `sanitizeQuery`/`sanitizeBody` 中间件崩溃：`req.query` 为 getter-only 不能整体赋值，改为原地修改属性（此 bug 导致所有请求 500）

### 前端修复
- **L-1** 登录跳转 `redirect` 参数校验，仅允许站内相对路径，防开放重定向
- **L-7** 登出清除 API 响应缓存；cache.js 增加 LRU 上限（50 条）
- **L-8** Login.vue 改用 `__APP_VERSION__` 替代 package.json import，避免泄露依赖清单
- **L-10** 404 路由显式 `requiresAuth: false`
- **M-12** Nginx 增加 CSP/HSTS/Referrer-Policy/Permissions-Policy 安全头；`X-XSS-Protection` 置 0
- **M-13** 移除硬编码测试账号明文，改为环境变量读取
- 401 刷新队列入队前标记 `_retry`，避免边界场景二次刷新

### 其他
- `.env.example` 补全 `JWT_REFRESH_SECRET`/`JWT_DOWNLOAD_SECRET`/`BCRYPT_ROUNDS`
- `saveHourSettings` 保存前调用 `validateHourSettings` 校验，避免无效设置静默持久化
- `JSON.parse(system_settings.value)` 全部包裹 try/catch，存储损坏时回退默认值
- `getStatistics` 修复 `teacher?.x.map` 链式访问潜在 TypeError
- `vite.config.js` 显式 `sourcemap: false`

## [1.0.0] - 2026-06-13

### 新增
- 首次正式发布版本
- 完整的课程管理平台功能
  - 基础数据管理（培养层次、专业、学院、课程、教材、班级）
  - 培养方案管理
  - 查询报表功能
  - 用户管理和权限控制
  - 操作日志审计
- 前后端分离架构（Vue 3 + Element Plus + Node.js + Prisma）
- 页脚版本号显示功能

### 技术栈
- 前端：Vue 3.5.34, Element Plus 2.14.1, Vite 5.4.21
- 后端：Node.js, Express 5.1.0, Prisma 6.10.1
- 数据库：支持 Prisma 的多种数据库

---

## 版本说明

- **主版本号** (v1.x.x)：不兼容的 API 修改
- **次版本号** (vx.1.x)：新功能（向后兼容）
- **修订号** (vx.x.1)：Bug 修复（向后兼容）

## 发布流程

1. 更新 `package.json` 中的版本号
2. 在此文件中记录变更内容
3. 提交代码并打标签：`git tag v1.0.0`
4. 推送标签：`git push origin v1.0.0`
