# kec-manager 项目长期记忆

## 项目概况
- KEC 课程管理平台，Vue3 + Express + Prisma + SQLite
- 核心功能：培养计划、班级管理、教师排课、教材协调、数据导入导出
- 排课服务核心文件：`server/src/services/teaching-arrange.service.js`

## 排课算法关键约定
- 排课采用贪心 + 多阶段筛选（当前 6 阶段）
- 教材匹配有两级推导：实际排课推导（优先）+ 培养方案兜底（问题源头）
- `inherentTextbookIds` 是固有教材快照，运行时不可污染（P1-A 修复约定）
- `assignedTextbookIds` 是本轮已分配教材 Set，用于内聚评分
- 评分权重：学院+5、层次+5、本轮已用教材+6、固有教材+3（2026-06-20 调整）

## 已知技术债
- ~~教材兜底推导过宽：无排课记录教师 = 该课程所有教材并集，导致内聚失效~~ → 2026-06-20 已修复（改空集合，受 TEXTBOOK_COHESION.FALLBACK_EMPTY 控制）
- ~~阶段优先级错位：phase3（偏好无教材）先于 phase4（无偏好有教材），削弱内聚~~ → 2026-06-20 已修复（插入 phase2.5 内聚优先阶段）
- 贪心算法无全局回溯，trySwapUnassigned 仅看容量不看教材内聚（仍未修复，属长期优化项）
- batchAutoArrange 顺序依赖，先处理课程占用教师容量影响后续

## 重要文件位置
- 排课服务：`server/src/services/teaching-arrange.service.js`
- 排课逻辑文档：`docs/TEACHING_ARRANGE_LOGIC.md`
- 教材内聚分析：`docs/TEXTBOOK_COHESION_ANALYSIS.md`
- 常量定义：`server/src/constants/index.js`（WORKLOAD_BALANCE 等）

## 排课优化进展
- 2026-06-20：完成 6 阶段重构 + 评分权重调整 + 语法修复
- 2026-06-20：完成教材内聚度深度分析，提出 P0/P1/P2 三档修复方案
- 2026-06-20：教材内聚度全套 6 项修复落地（兜底收紧/phase2.5/内聚惩罚/统计指标/教材分组/配置化），待重启后端验证

## 排课算法关键配置（TEXTBOOK_COHESION）
- 总开关 `TEXTBOOK_COHESION.ENABLED`，关闭即回退原逻辑
- 权重：学院+5、层次+5、本轮已用教材+6、固有教材+4、新增教材每本-2
- `FALLBACK_EMPTY=true`：无排课记录教师教材为空（核心修复）
- `COHESION_PHASE_ENABLED=true`：启用 phase2.5 内聚优先阶段
- `SCATTERED_THRESHOLD=3`：教材数≥3 视为分散教师

## 班级离校级联规则（2026-06-20 新增）
- 班级标记 `is_left_school=true` 时，自动删除当前学期该班全部 `teaching_assignments`
- `!currentClass.is_left_school` 守卫防重复删除
- 前端单编辑/批量设置均有 ElMessageBox 确认弹窗
- 实现位置：`server/src/controllers/class.controller.js` updateClass + `client/src/views/class/ClassList.vue` handleSave/handleBatchSet

## 教师周课时容量天花板（2026-06-20 新增）
- `default_weekly_hours` 作为全局容量天花板，标准/最大模式均服从
- `standardCap = min(系统剩余, 教师个人剩余)`，`fullCap` 同理
- 实现位置：`server/src/services/teaching-arrange.service.js` buildTeacherConstraints

## v2.12.3 安全修复（2026-06-24）
- **C-1 密码 XSS 修复**：`xss.js` 新增 `SKIP_SANITIZE_KEYS` 白名单，password/old_password/new_password 等字段跳过 XSS 清洗（修复前改密码含 `<>` 字符会永久锁死）
- **H-4 sanitizeBody 全局**：`app.js` 在 express.json 后全局挂载，密码字段自动跳过
- **M-2 updateClass 事务**：班级更新 + 级联删除排课记录包入 `prisma.$transaction`
- **M-7 重置限流**：`settings.routes.js` 所有 `/reset/*` 加 resetLimiter（每用户每小时 3 次）
- **M-8 分页参数修复**：`pagination.js` `validatePagination(maxPageSize=100)` 接受参数
- **H-5 querySemester 分页上限**：强制 `Math.min(Math.max(n,1), 100)`
- **H-2 密码正则统一**：`validateChangePassword` 改为严格字符集 `[A-Za-z\d@$!%*?&]{8,128}`
- **H-1 .bak 清理**：删除残留备份文件，.gitignore 加 `*.bak*` 规则

## TeachingArrange.vue 拆分决策（2026-06-24）
- 文件 1609 行（template 585 + script 580 + style 442），**评估结论：暂不拆分**
- 理由：① 当前无 bug，经历 7 轮排课修复后状态稳定；② 状态耦合天然紧密（selectedCourseId 贯穿所有函数），拆分代价大于收益；③ 实际逻辑约 600 行，CSS 占 28%，属正常体量
- 拆分触发条件：文件突破 2500 行 / 需复用弹窗组件 / 新人抱怨难维护
- overview.md 中 L-7 已降级为观察项
