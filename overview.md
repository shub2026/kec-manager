# 离校级联删除排课 — 最终方案

## 行为
- 班级标记离校 → 保存 → **无弹窗确认** → 后端直接 `deleteMany` 当前学期全部排课
- 关闭离校 → 不删排课（正常恢复状态推算）

## 修改文件

| 文件 | 改动 |
|------|------|
| `server/src/controllers/class.controller.js` | `leftSchool && !currentClass.is_left_school` 时级联删除 |
| `client/src/views/class/ClassList.vue` | 移除弹窗确认/dbg代码，handleSave 直传 |
| `client/src/views/class/components/ClassFormDialog.vue` | 移除 leftSchoolChange emit，回归 v-model |

## 触发条件
- `is_left_school: true` 且 `currentClass.is_left_school === false`
- 仅删当前学期（`semester: semesterInfo.name`）
- audit log 记录删除数量
