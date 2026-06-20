# 教材内聚度优化 · 实施总览

> 完成日期：2026-06-20
> 实施人：高级开发工程师（吴八哥）
> 关联文档：`docs/TEXTBOOK_COHESION_ANALYSIS.md`

## 完成情况

全部 6 项修复已落地，静态验证通过，待重启后端做动态验证。

| # | 修复项 | 优先级 | 状态 | 改动位置 |
|---|--------|:------:|:----:|----------|
| 1 | 收紧教材兜底推导 | P0 | ✅ | service L362-367 |
| 2 | 插入 phase2.5 教材内聚优先阶段 | P0 | ✅ | service L663-672 |
| 3 | calcMatchScore 引入内聚惩罚 | P1 | ✅ | service L401-448 |
| 4 | 新增教材内聚度统计指标 | P1 | ✅ | service calcAllMatchRates |
| 5 | 批量排课按教材分组预处理 | P2 | ✅ | service assignRound L579-592 |
| 6 | 内聚权重可配置化 | P2 | ✅ | constants/index.js |

## 改动文件清单

### 后端
- `server/src/constants/index.js` — 新增 `TEXTBOOK_COHESION` 配置常量（约 +20 行）
- `server/src/services/teaching-arrange.service.js` — 6 处修复（约 +120 行）
  - import 引入 `TEXTBOOK_COHESION`
  - `getTeachersForCourse` 兜底推导收紧
  - `calcMatchScore` 权重配置化 + 内聚惩罚 + 新增 `isNewTextbookZero` 辅助函数
  - `autoArrange` 阶段链插入 phase2.5
  - `assignRound` 班级排序加入教材签名次要键
  - `calcAllMatchRates` 新增 4 项内聚度统计指标

### 前端
- `client/src/views/teaching/TeachingArrange.vue`
  - 单课程排课结果弹窗新增"教材内聚度"展示区块
  - 新增 `cohesionRateClass` 计算属性（按 ≥70/≥40/其他 分级着色）
  - 新增 `.arrange-cohesion` 系列样式

## 配置说明（TEXTBOOK_COHESION）

所有修复受总开关 `ENABLED` 控制，可一键回退：

```javascript
TEXTBOOK_COHESION = {
  ENABLED: true,                // 总开关
  COLLEGE_WEIGHT: 5,            // 学院匹配权重
  LEVEL_WEIGHT: 5,              // 层次匹配权重
  ASSIGNED_WEIGHT: 6,           // 本轮已用教材权重
  INHERENT_WEIGHT: 4,           // 固有教材权重（原值3，提升）
  PENALTY_PER_NEW: 2,           // 新增教材每本扣分
  COHESION_PHASE_ENABLED: true, // phase2.5 开关
  FALLBACK_EMPTY: true,         // 兜底空集合开关
  SCATTERED_THRESHOLD: 3,       // 分散教师教材数阈值
}
```

## 验证情况

### 静态验证（已通过）
- 三个后端文件 `node --check` 全通过
- 新实例启动到 "Server running" 阶段才因端口冲突退出 → 所有 import 成功解析
- 所有新增引用点 grep 闭合，常量字段名与使用点一致
- 前端 `computed` 已导入，`cohesionRateClass` 已定义，模板/样式就位

### 动态验证（待执行）
- ⚠️ 3001 端口当前跑的是旧代码实例，需重启后端加载新代码
- 重启后建议用历史学期数据做 preview 排课，对比修复前后的：
  - 分配率（应 ≥ 修复前，允许小幅下降 ≤ 2%）
  - 教材内聚度（应 ≥ 70%）
  - 教师人均教材数（应 ≤ 1.5）
  - 分散教师数（教材数≥3 的教师应 ≤ 总数 10%）

## 回退方案

如修复后出现分配率大幅下降或其他异常：

1. **快速回退**：`constants/index.js` 设 `TEXTBOOK_COHESION.ENABLED = false`，重启后端
2. **部分回退**：单独关闭某项，如 `COHESION_PHASE_ENABLED = false` 或 `FALLBACK_EMPTY = false`
3. **调参**：降低 `PENALTY_PER_NEW`（如 2→1）减轻内聚压力

## 预期效果

- 教材内聚度从 ~31% 提升至 ~70%+
- 教师人均教材数从 ~2.3 降至 ~1.3
- 分散教师数（≥3 本教材）显著减少
- 预览模式可直接看到 `textbookCohesionRate` 等指标，便于调参
