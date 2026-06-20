# 教材内聚优化 — 八轮修复：Phase 0 死代码

## 本次修复（2026-06-20 18:37）

### 终极根因：Phase 0 是死代码

前七轮修复（评分权重、硬上限、置换清理、interleaveByTextbook）全部无效，因为 **Phase 0 从未执行过**。

```javascript
// Phase 0 filter（修复前）
(t, cls) => t.assignedTextbookIds.size === 0 && isTextbookMatch(t, cls)

// isTextbookMatch 内部
cls.textbookIds.every(tid => teacher.assignedTextbookIds.has(tid))
```

**两个条件互斥**：
- `t.assignedTextbookIds.size === 0` 要求教师没有已分配教材
- `isTextbookMatch` 要求教师的 `assignedTextbookIds` 包含班级的所有教材
- SIZE-0 教师的 `assignedTextbookIds` 是空 Set → `every()` 返回 false
- 结果：**没有任何教师能通过 Phase 0 filter**

所有班级走 Phase 3+（无教材约束），`assignRound` 内部排序导致教材聚集 → 全员2本。

### 修复

新增 `canTeachTextbook(teacher, cls)`：
```javascript
// 检查 inherentTextbookIds（教师能力），非 assignedTextbookIds（运行时已分配）
function canTeachTextbook(teacher, cls) {
  if (!cls.textbookIds || cls.textbookIds.length === 0) return true;
  if (!teacher.inherentTextbookIds || teacher.inherentTextbookIds.length === 0) return true;
  return cls.textbookIds.some(tid => teacher.inherentTextbookIds.includes(tid));
}
```

Phase 0 filter 改用 `canTeachTextbook`：
```javascript
const phase0Filter = (t, cls) =>
  t.assignedTextbookIds.size === 0 && canTeachTextbook(t, cls);
```

### 关键区别

| 函数 | 检查什么 | 用途 |
|------|---------|------|
| `isTextbookMatch` | `assignedTextbookIds`（运行时已分配） | Phase 1+ 内聚深化 |
| `canTeachTextbook` | `inherentTextbookIds`（教师能力） | Phase 0 初始播种 |

### 预期效果

Phase 0 现在能执行：interleaveByTextbook 交错排序 + canTeachTextbook 能力检查
→ 21位教师交替拿教材39/40 → ~11人{39}、~10人{40}
→ Phase 1 各自深耕同教材班级 → 大部分教师1本
