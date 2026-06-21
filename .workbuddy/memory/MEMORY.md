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
