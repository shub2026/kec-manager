# KEC 课程管理平台 — 视觉与交互设计改进建议

> 审查日期：2026-07-07
> 审查范围：前端整体视觉风格、交互体验、信息架构

---

## 一、色彩体系 — 建立品牌辨识度

### 现状

- 主色 `#409eff` 是 Element Plus 默认蓝
- 侧边栏 `#304156` 是常见深灰
- 整体缺乏品牌感，与其他 Element Plus 后台系统难以区分

### 建议

1. **换一套有辨识度的主色**
   - 教育类平台适合偏青/偏绿的冷色调
   - 推荐 `#0EA5E9`（天蓝）或 `#6366F1`（靛蓝）
   - 配合暖色辅助色（如 `#F59E0B`）做对比

2. **侧边栏升级为更现代的深色**
   - 使用渐变：从 `#1E293B` 到 `#0F172A` 的微妙渐变
   - 或反其道使用浅色侧边栏 + 主色高亮条，摆脱"后台管理系统"刻板印象

3. **Dashboard 欢迎区域加品牌色渐变背景**
   ```css
   background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
   color: #fff;
   ```
   配白色文字，瞬间拉开与"默认模板"的差距

---

## 二、Dashboard — 从"数据罗列"到"信息仪表盘"

### 现状

- 8 个统计卡片平铺排列，大小一致，无主次之分
- 底部有一大块"关于平台"的说明文字（管理员不需要每次看到产品介绍）

### 建议

1. **区分统计卡片的视觉权重**
   - 核心指标（如"总周课时""参与教师"）用大卡片 + 趋势图/迷你图表
   - 次要指标（如"专业类别"）用紧凑的小卡片
   - 参考 Vercel / Linear 的 dashboard 设计

2. **为统计数字添加动画计数器**
   - 使用 Vue CountUp 等库
   - 进入页面时数字从 0 跳动到目标值，增加生动感

3. **添加近期动态 / 快捷操作区**
   - 替代底部的"关于 KEC 平台"说明
   - 可放置：最近操作记录、待办提醒、本学期排课进度等

4. **统计卡片加微型图表**
   - 用 sparkline 展示趋势（如本学期 vs 上学期课程数变化）
   - 而非只显示一个静态数字

---

## 三、表格与列表 — 增加信息密度和层次感

### 现状

- 标准 `el-table` + stripe，每页看起来都一样
- 操作列每行都有圆形按钮排成一排，视觉拥挤

### 建议

1. **表头用更明显的视觉区分**
   ```css
   .el-table th {
     background: var(--brand-primary-soft);
     font-weight: 600;
   }
   ```
   让表头与数据行有明显分层

2. **操作列改为 hover 才显示的浮动操作条**
   - 或统一使用 `el-dropdown` 的"更多操作"按钮
   - 减少视觉噪音

3. **空状态使用自定义 SVG 插画**
   - 替代默认的 `el-empty`
   - 按场景定制：
     - "暂无课程" → 翻开的书本插画
     - "暂无班级" → 教室插画
     - "暂无教师" → 人物剪影插画
   - 增加产品温度

4. **表格行加 row-click 展开详情**
   - 减少弹窗频率
   - 非核心编辑可以在展开行内完成

---

## 四、卡片与容器 — 打破"方盒子"感

### 现状

- 所有页面都是一个 `el-card` 包裹一切
- header + toolbar + table 的固定模式，页面同质化严重

### 建议

1. **页面标题区域独立出来**
   - 做成带有面包屑 + 页面描述的 Page Header
   - 与内容卡片分离
   - 参考 Ant Design Pro 的 PageHeader 模式

2. **不同页面使用不同的布局模板**
   - Dashboard → 网格卡片
   - 列表页 → 全宽表格
   - 表单页 → 居中窄栏
   - 目前所有页面看起来一样

3. **卡片之间增加微妙的视觉层次**
   - 核心操作卡片用更强的阴影（`var(--shadow-md)`）
   - 辅助信息卡片用更轻的边框（仅 border，无 shadow）

---

## 五、侧边栏与导航 — 提升品质感

### 现状

- 深色侧边栏 + 标准 `el-menu`
- 活跃状态仅靠文字颜色变化，辨识度低

### 建议

1. **Logo 区域用更有品质感的设计**
   - 加一个小尺寸的品牌 logo（非 favicon 复用）
   - 配合品牌色背景块

2. **活跃菜单项用左侧色条指示器**
   ```css
   .el-menu-item.is-active::before {
     content: '';
     position: absolute;
     left: 0;
     top: 8px;
     bottom: 8px;
     width: 3px;
     border-radius: 0 3px 3px 0;
     background: var(--brand-primary);
   }
   ```
   3px 宽的主色竖条，比文字颜色变化更醒目

3. **折叠态确保 tooltip 提示菜单名称**
   - Element Plus 自带此功能，确认是否已启用

---

## 六、交互细节 — 让体验更流畅

### 建议

1. **页面切换加过渡动画**
   ```vue
   <router-view v-slot="{ Component }">
     <transition name="fade-slide" mode="out-in">
       <component :is="Component" />
     </transition>
   </router-view>
   ```
   ```css
   .fade-slide-enter-active,
   .fade-slide-leave-active {
     transition: all 200ms var(--ease-out);
   }
   .fade-slide-enter-from {
     opacity: 0;
     transform: translateX(12px);
   }
   .fade-slide-leave-to {
     opacity: 0;
     transform: translateX(-12px);
   }
   ```
   轻量右滑 + 淡入效果，避免页面硬切

2. **表单提交后的成功反馈增强**
   - 除了 `ElMessage.success`，可在按钮位置显示短暂的对勾动画
   - 使用 Lottie 动画，比纯文字 toast 更有确认感

3. **批量操作的确认改为 inline 确认条**
   - 类似 Gmail 的 snackbar 风格
   - 比弹窗打断感更轻

4. **骨架屏推广到所有列表页**
   - Dashboard 已经使用了 `el-skeleton`，效果好
   - 列表页替代 `v-loading` 的旋转图标

---

## 七、字体与排版

### 现状

- 字体栈 `PingFang SC, Microsoft YaHei, sans-serif`，基本够用
- 标题层级差异不够明显

### 建议

1. **数字使用等宽数字特性**
   ```css
   .stat-value, .el-table .cell {
     font-variant-numeric: tabular-nums;
   }
   ```
   让统计数字和表格数据对齐更整齐

2. **标题层级再拉开一些**
   - 页面标题拉到 28px + 700 字重
   - 卡片标题 16px + 600 字重
   - 正文 14px + 400 字重
   - 层次更激进一些

3. **增加段落间距和行高的呼吸感**
   - 卡片内 padding 从 20px 放宽到 24px
   - `--font-body` 行高 1.6 保持不变，已经不错

---

## 八、优先实施顺序

| 优先级 | 改动项 | 预期效果 | 工作量 |
|--------|--------|---------|--------|
| P0 | 替换主色 + 侧边栏配色 | 立刻脱离"默认模板"感 | 小 |
| P0 | Dashboard 欢迎区渐变背景 + 去掉底部介绍 | 首屏质感大幅提升 | 小 |
| P1 | 页面切换动画 + 活跃菜单指示条 | 交互品质感 | 小 |
| P1 | 表格操作列改 hover 浮动 + 自定义空状态 | 减少视觉噪音 | 中 |
| P2 | 统计数字动画 + sparkline 图表 | 数据展示升级 | 中 |
| P2 | Page Header 独立 + 布局差异化 | 页面层次感 | 中 |
| P3 | 骨架屏推广到所有列表页 | 加载体验统一 | 小 |
| P3 | 表单提交动画反馈 | 操作确认感 | 小 |

---

## 附：参考设计灵感

- [Vercel Dashboard](https://vercel.com/dashboard) — 简洁的数据仪表盘
- [Linear App](https://linear.app) — 精致的交互细节
- [Ant Design Pro](https://pro.ant.design) — PageHeader 与布局模式
- [Stripe Dashboard](https://dashboard.stripe.com) — 信息密度与层次感
- [Notion](https://notion.so) — 留白与排版节奏
