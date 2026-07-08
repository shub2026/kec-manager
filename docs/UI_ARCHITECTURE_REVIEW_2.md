## KEC 课程管理平台 — 第二轮 UI/UX 架构审查

> 审查日期：2026-07-08  
> 审查范围：渲染性能、视觉风格、交互细节、布局一致性  
> 审查人：UI/UX 架构审查

---

### 一、布局一致性

#### 1.1 PageHeader 组件覆盖率不足

目前仅 3 个页面使用了 `PageHeader` 组件（TeacherList、TeachingArrange、TeachingStatistics），全部集中在教学安排模块。其余 12+ 个列表页和查询页仍使用 `el-card #header` 内嵌 `card-header` 的传统模式，导致两种页面标题风格并存：一种有独立的 24px 粗体标题 + 模块标签 + 描述文字，另一种则挤在卡片顶栏里与筛选器、操作按钮混在一起。

**建议**：将 `PageHeader` 推广到所有列表页（CollegeList、MajorList、CourseList、TextbookList、ClassList、PlanList、TrainingLevelList）和查询页（PlanQuery、UnifiedSemesterQuery、UnifiedTextbookQuery、AuditLog、UserManagement）。标题区域从卡片中剥离出来，使 `el-card` 纯粹承载数据内容。这样所有页面的信息层级统一为"页面标题 → 内容卡片"两级结构，视觉节奏也更一致。

#### 1.2 空状态组件混用

8 个基础数据列表页已统一使用自定义 `EmptyState` 组件（带场景化 SVG 插画），但查询模块（PlanQuery、UnifiedSemesterQuery、UnifiedTextbookQuery）和系统模块（AuditLog、UserManagement）仍在使用 Element Plus 默认的 `el-empty`。前者有品牌感的插画和引导文案，后者是灰色默认图标——同一平台内两种空状态体验落差明显。

**建议**：为查询页新增 `type="query"` 和 `type="textbook-query"` 类型的 EmptyState 插画，为系统页新增 `type="audit"` 和 `type="user"` 类型，全面替换 `el-empty`。

#### 1.3 移动端 Dialog 全屏适配不统一

仅 3 个表单弹窗（ClassFormDialog、TeacherList 编辑弹窗、TextbookList 编辑弹窗）实现了 `:fullscreen="isMobile"` 的移动端全屏适配。其余页面的 `el-dialog` 在窄屏下仍是固定宽度弹窗，内容可能被截断或溢出。

**建议**：所有包含表单的 `el-dialog` 统一加上 `:fullscreen="isMobile"` 绑定。同时，目前 `AuditLog.vue` 中有一个 `width="500px"` 的硬编码弹窗（操作详情对话框），应改为 `width="min(500px, 90vw)"` 的响应式写法（PlanDetail 和 TeachingArrange 已经用了这种写法）。

#### 1.4 card-header 内筛选器/按钮布局规范

根据项目约定（AGENTS.md），筛选器和操作按钮统一放在 `card-header-actions` 内，筛选器在前、按钮在后。多数页面遵循了此规范，但 TeachingStatistics 和 TeachingArrange 的筛选器放在卡片内部（`page-toolbar`）而非 `card-header`，与 CourseList、TextbookList 等页面的模式不同。

**建议**：不需要强制统一——如果页面已使用独立的 `PageHeader`，筛选器放在卡片内 `page-toolbar` 是合理的分层。但应在文档中明确两种模式的适用场景：有 PageHeader 的页面用 card 内 toolbar，无 PageHeader 的页面用 card-header-actions。

---

### 二、视觉风格

#### 2.1 卡片全局 hover 阴影过于激进

`global.css` 中给所有 `.el-card` 加了 `hover` 时 shadow 升级的效果（shadow-sm → shadow-md）。这对 Dashboard 的统计卡片和教学内容卡片是合适的，但对于页面中仅有一张全宽卡片的列表页（如 CollegeList、MajorList），hover 时整张卡片阴影跳动反而造成视觉干扰——用户并不会在列表页"悬停卡片"，他们悬停的是表格行。

**建议**：将全局 `.el-card:hover` 的阴影增强改为仅对 `.el-card.is-hover:hover` 生效（即显式标记可交互的卡片）。列表页的全宽容器卡片不需要 hover 阴影效果。

#### 2.2 表头背景色与品牌色耦合过深

`global.css` 给所有 `.el-table th` 加了 `background: var(--brand-primary-soft)` 的浅蓝底色。这在浅色主色下效果不错，但如果将来切换主色（比如换成深色系或暖色系），所有表头的底色都会跟着变，可能和表格行的色彩搭配失调。此外，这个蓝色底与 `stripe` 斑马纹（Element Plus 默认的浅灰交替）并置时，表头的蓝色和斑马纹的灰色属于两个色温系统，略显突兀。

**建议**：表头背景色改为中性色（如 `var(--bg-subtle)` 即 `#f1f5f9`），保持 `font-weight: 600` 的粗体区分。这样表头有层次感但不依赖品牌色，换肤时不受影响。如果需要强调品牌感，可以仅在 Dashboard 和核心业务表格中使用品牌浅底色。

#### 2.3 操作列 hover 浮现效果存在可见性风险

`global.css` 中 `.op-buttons` 的按钮默认 45% 透明度，hover 表格行时才变为 100%。这个设计减少了视觉噪音，但对于低频使用的操作（如"删除"），用户可能不知道按钮的存在——特别是新用户第一次使用时，看不到操作入口。

**建议**：将默认透明度从 0.45 提升到 0.65-0.7，保证按钮在静态状态下仍可辨识。或者改为仅"编辑/查看"等常用操作始终可见，"删除"等危险操作放在 hover 后才浮现或放在 `el-dropdown` 的"更多"菜单中。

#### 2.4 主色按钮 hover 投影硬编码 RGBA

`global.css` 中 `.el-button--primary:hover` 使用了硬编码的 `rgba(14, 165, 233, 0.28)` 投影色。如果主色 `--brand-primary` 变更，这个投影颜色不会跟着变。

**建议**：在 `theme.css` 中新增 `--brand-primary-shadow: rgba(14, 165, 233, 0.28)` 令牌，全局样式引用变量而非硬编码值。

---

### 三、交互细节

#### 3.1 keep-alive 缓存页面的数据刷新机制不够健壮

目前 4 个缓存页面（ClassList、TeacherList、PlanList 等）使用 `watch(() => route.path, ...)` 来检测"从其他页面回来时需要刷新数据"。代码注释也承认这是一种 workaround。问题在于：这种方式会监听所有路由变化，当应用路由增多后，逻辑判断会越来越脆弱（比如子路由切换、查询参数变化等边界情况）。

**建议**：改用 Vue 的 `onActivated()` 生命周期钩子。`onActivated` 在 keep-alive 组件每次被激活时触发，语义更精确，代码更简洁。可以在 `onActivated` 中检查一个 sessionStorage 标志（如 `planListNeedsRefresh`）来决定是否需要重新加载数据，这样既有按需刷新的灵活性，又不依赖全局路由监听。

#### 3.2 keep-alive include 依赖隐式文件名推断

`Layout.vue` 中 `cachedViews` 列表硬编码了 8 个组件名（`ClassList`、`TextbookList` 等），而所有 `<script setup>` 的视图组件都没有使用 `defineOptions({ name: '...' })` 来显式声明组件名。Vue 3.3+ 虽然会根据文件名自动推断组件名，但这意味着：如果文件重命名（比如 `ClassList.vue` → `ClassManagement.vue`），keep-alive 缓存会静默失效，不会有任何报错提示。

**建议**：为所有被 keep-alive 缓存的 8 个视图组件添加 `defineOptions({ name: 'ClassList' })` 等显式命名，使其与 `cachedViews` 列表形成强绑定。

#### 3.3 useDebouncedRef 存在定时器泄漏

`composables/useDebounce.js` 中的 `useDebouncedRef` 函数内部的 `setTimeout` 定时器在组件卸载时不会被清除。如果使用该 composable 的组件在 debounce 等待期间被卸载，定时器会在组件已销毁后仍然触发，尝试写入已失效的 ref。此外 `TextbookList.vue` 使用了 `useDebounceFn` 但未在 `onUnmounted` 中调用 `.cancel()`，与 `CourseList.vue` 和 `TeachingStatistics.vue` 的手动清理做法不一致。

**建议**：在 `useDebouncedRef` 内部添加 `onUnmounted(() => clearTimeout(timer))` 自动清理。对于 `useDebounceFn`，在文档注释中明确提醒调用方需要在 `onUnmounted` 中调用 `.cancel()`，或者自动注册清理钩子。

#### 3.4 ChangePasswordDialog 的双向绑定可简化

`ChangePasswordDialog.vue` 用两个独立的 `watch` 实现 props.modelValue 与内部 dialogVisible 的双向同步。这引入了一个潜在风险：两个 watcher 可能形成无限循环（虽然 Vue 的调度器通常会阻止这种情况，但增加了不必要的渲染周期）。

**建议**：改为 writable computed：

```js
const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});
```

一个 computed 替代两个 watch，逻辑更清晰，性能更好。

#### 3.5 导入功能的取消按钮尚未实现

`useImport.js` 中已正确创建了 `AbortController` 并暴露了 `cancelImport()` 方法，但没有 UI 调用它。用户在文件上传期间无法取消正在进行的导入操作。

**建议**：在上传进度提示中增加"取消"按钮，调用 `cancelImport()` 触发 abort。这在处理大文件导入时尤为重要。

---

### 四、渲染性能

#### 4.1 整体表现良好

项目在前端性能方面做得相当扎实，几个关键优化点值得肯定：

Element Plus 通过 `unplugin-vue-components` 实现了组件自动按需导入，`main.js` 中手动导入了程序化调用（ElMessage 等）的 CSS。图标注册从 280+ 全量注册精简到了 47 个按需注册。构建分包将 vue-vendor、element-plus、element-icons、axios 分离为独立 chunk，缓存策略合理。所有路由组件均使用 `() => import()` 懒加载。TeachingArrange 中的 5 个弹窗组件使用了 `defineAsyncComponent` 延迟加载。Dashboard 的 CountUp 动画基于 `requestAnimationFrame`，卸载时正确取消。全局 resize 监听器通过 `useResponsive` 的单例模式 + 引用计数管理，避免重复绑定。

#### 4.2 可优化项

**表格虚拟滚动**：当前所有列表页使用标准 `el-table`，数据量较小时没有问题。但如果教师、班级、课程等列表数据量增长到数百条，建议评估引入 `el-table-v2`（虚拟化表格）或使用分页来限制单页渲染行数。目前分页在 ClassList 等分页列表中已实现，但 computed 客户端筛选的列表（CollegeList、MajorList 等）是全量渲染。

**watch(route.path) 的性能开销**：每个缓存页面都有一个 `watch` 监听全局路由变化。当路由表增长到 20+ 条且页面切换频繁时，这些 watcher 会在每次路由变化时被触发（即使大部分时候条件判断为 false）。改用 `onActivated` 可以完全消除这个开销。

**Dashboard 的 Promise.all 并行加载**：`fetchStats` 和 `fetchInsights` 已经使用 `Promise.all` 并行加载，这是正确的做法。但 `sparkData` 的生成逻辑在每次渲染时都会重新计算（如果它不是 computed 而是普通函数），建议确认其是否被包裹在 computed 中。

#### 4.3 无重大性能隐患

没有发现 deep watcher、无节流的滚动事件、DOM 读写循环（layout thrashing）等严重性能问题。CSS 中 26 处 `!important` 均用于覆盖 Element Plus 内部样式，属于合理用法，不影响渲染性能。

---

### 五、响应式设计

#### 5.1 断点体系完善但存在覆盖盲区

项目定义了 5 级响应式断点（1440px / 992px / 768px / 480px），覆盖了桌面、小屏、平板、手机等场景。侧边栏在 1024px 以下自动折叠，筛选器宽度有 `.filter-xs` 到 `.filter-2xl` 的完整尺寸系统，操作列在 768px 以下从按钮行切换为下拉菜单。

但有两个盲区：1200px-1440px 区间（常见的笔记本屏幕）的筛选器收缩幅度可能不够——当一行有 5-6 个筛选器时，可能需要 `flex-wrap` 换行，但换行后标题和操作按钮的排列可能不协调。建议在 1200px 断点增加 `card-header-actions` 的 `flex-direction: column` 或筛选器尺寸再缩一档。

#### 5.2 平板横屏适配

768px 断点的适配考虑了竖屏平板，但横屏平板（约 1024px 宽）处于"侧边栏刚折叠但内容区还很宽"的状态，布局可能不够紧凑。建议为这个区间增加一个断点，使内容区利用更多水平空间（比如表格列宽自动扩展）。

---

### 六、建议实施优先级

| 优先级 | 改动项 | 工作量 | 影响范围 | 状态 |
|--------|--------|--------|----------|------|
| **P0** | PageHeader 组件推广到所有列表页和查询页 | 中 | 全局一致性 | ✅ 已完成 |
| **P0** | 卡片全局 hover 阴影改为 `.is-hover` 限定 | 小 | 视觉噪音减少 | ✅ 已完成 |
| **P1** | 空状态 EmptyState 替换所有 el-empty | 小 | 品牌感统一 | ✅ 已完成 |
| **P1** | 移动端 Dialog fullscreen 适配全覆盖 | 小 | 移动体验 | ✅ 已完成 |
| **P1** | keep-alive 缓存页改用 onActivated | 小 | 代码健壮性 | ✅ 已完成 |
| **P1** | 缓存组件添加 defineOptions 显式命名 | 小 | 维护安全性 | ✅ 已完成 |
| **P2** | useDebouncedRef 自动清理 + 统一 debounce 策略 | 小 | 内存安全 | ✅ 已完成 |
| **P2** | 操作列默认透明度提升到 0.65 | 极小 | 可发现性 | ✅ 已完成 |
| **P2** | 表头背景色改为中性色 | 极小 | 换肤灵活性 | ✅ 已完成 |
| **P2** | 主色按钮投影 RGBA 改为 CSS 变量 | 极小 | 主题一致性 | ✅ 已完成 |
| **P3** | ChangePasswordDialog 双 watch 改 writable computed | 小 | 代码质量 | ✅ 已完成 |
| **P3** | 导入取消按钮 UI 实现 | 小 | 功能完整性 | ✅ 已完成 |
| **P3** | 1200px 断点筛选器布局优化 | 小 | 笔记本适配 | ✅ 已完成 |

---

### 七、额外修复（审查后补充）

以下修复项在实施过程中发现并一并处理：

| 改动项 | 说明 |
|--------|------|
| 内嵌表格 hover 高亮禁用 | 课时统计页和开课查询页的展开行内嵌表格，hover 时与外层表格同时高亮造成视觉干扰。已在 `.expand-content` 内通过 `background: inherit` 禁用内嵌行 hover |
| 登录页视觉优化 | 按钮投影色与主色统一（RGBA → CSS 变量）、accent 条渐变色改用品牌色、focus ring 加粗至 2px（WCAG）、新增入场动画（fade-in + translateY）、背景添加极淡径向渐变、表单添加 aria-label |
| AuditLog 弹窗宽度修复 | `width="500px"` 硬编码改为 `width="min(500px, 90vw)"` 响应式写法 |

---

> 实施日期：2026-07-08 | 涉及 21 个文件，+321 / -203 行变更
