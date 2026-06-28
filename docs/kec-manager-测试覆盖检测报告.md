## KEC Manager 测试覆盖检测报告

**项目版本：** v2.13.2
**检测日期：** 2026-06-28
**测试框架：** Vitest v4.1.9 + @vitest/coverage-v8
**检测范围：** 后端 server/src 全部模块（前端 client 无测试配置）

---

### 一、总体结论

| 指标 | 数值 | 评价 |
|------|------|------|
| 测试文件 | 6 个 | 偏少 |
| 测试用例 | 84 个，全部通过 | 健康 |
| 语句覆盖率 | 6.21% (266/4281) | 严重不足 |
| 分支覆盖率 | 7.32% (203/2770) | 严重不足 |
| 函数覆盖率 | 5.98% (31/518) | 严重不足 |
| 行覆盖率 | 6.43% (247/3839) | 严重不足 |

**一句话总结：** 现有 84 个测试全部通过，质量较高，但仅覆盖了 6% 的代码。测试集中在认证和排课纯函数两个点上，控制器层、业务服务层、中间件层、工具函数层几乎完全空白，前端没有任何测试。

---

### 二、各模块覆盖详情

#### 已覆盖模块（覆盖率 > 0%）

| 模块 | 语句% | 分支% | 函数% | 评价 |
|------|-------|-------|-------|------|
| auth.service.js | 93.61 | 87.5 | 100 | 优秀，核心认证流程全覆盖 |
| auth.middleware.js | 83.33 | 88.23 | 83.33 | 优秀，含缓存机制测试 |
| settings.service.js | 60.52 | 78.37 | 50 | 良好，学期解析纯函数覆盖 |
| error.js | 55.55 | 50 | 33.33 | 一般，仅自定义错误类被间接覆盖 |
| auth.config.js | 54.16 | 50 | 0 | 一般，通过 auth 测试间接加载 |
| auto-arrange.js | 15.26 | 18.67 | 8.91 | 偏低，仅评分/资格/统计3个函数 |
| queries.js (arrange) | 11.88 | 18.3 | 14.28 | 偏低，仅教材/学院/层次匹配+学期解析 |

#### 完全未覆盖模块（0% 覆盖，按风险排序）

**高风险（核心业务逻辑）：**

- `teaching-arrange.service.js` — 排课主服务，含 getTeachersForCourse、四阶段分配逻辑
- `auto-arrange.js` 剩余 85% — arrangeCourses 主算法、trySwapOne 置换函数（已知缺少学院/层次/课程资格校验）
- `batch.js` — 批量排课服务
- `plan.service.js` — 培养方案匹配（已知三轮匹配逻辑复杂）
- `class-filter.service.js` — 班级筛选服务
- `class.service.js` — 班级业务服务

**高风险（数据导入导出）：**

- `import/teachers.js` (479行) — 教师导入，含自动创建学院逻辑
- `import/classes.js` (319行) — 班级导入
- `import/textbooks.js` (144行) — 教材导入
- `import/courses.js` (142行) — 课程导入
- `data-export.controller.js` (825行) — 数据导出
- `semester-export.controller.js` (293行) — 学期导出

**中风险（请求验证与中间件）：**

- `validation.js` (581行) — 请求验证规则，已知字段名 snake_case 易出错
- `naming.middleware.js` (66行) — camelCase ↔ snake_case 转换，已知 Prisma Decimal 展开 bug
- `xss.js` (84行) — XSS 防护中间件
- `error.js` (57行) — 全局错误处理中间件
- `pagination.js` (27行) — 分页中间件

**中风险（控制器层，18个全部 0%）：**

- teacher.controller.js (567行) — 教师 CRUD + 状态切换 + 导入导出
- plan-matrix.controller.js (579行) — 培养方案矩阵
- plan.controller.js (343行) — 培养方案管理
- textbook.controller.js (392行) — 教材管理
- class.controller.js (463行) — 班级管理
- course.controller.js (139行) — 课程管理
- college.controller.js (197行) — 学院管理
- 其余控制器...

**工具函数（均 0%）：**

- `naming.js` (117行) — snake/camel 转换核心，已知 Array/constructor 顺序 bug
- `excel.js` (169行) — Excel 工具函数
- `sort.js` (101行) — 排序工具
- `response.js` (19行) — 响应格式化工具

**前端（client/）：** 无任何测试配置，无测试文件。

---

### 三、现有测试质量评审

#### 3.1 auth.middleware.test.js — 评分 A

**优点：** 覆盖了认证中间件的所有分支路径（无 token、无效 token、禁用用户、不存在用户、合法 token、downloadToken），缓存机制测试完善（命中缓存、缓存失效、invalidateUserStatusCache 后重新查库），roleMiddleware 权限检查覆盖五种场景。Mock 策略清晰，工厂函数在 vi.mock 内定义避免 hoisting 问题。

**小问题：** 未测试 `Bearer` 前缀缺失的边界情况（如直接传 token 字符串不带 `Bearer`）。

#### 3.2 auth.service.test.js — 评分 A

**优点：** 三种 JWT 密钥的生成与验证各自独立测试，login 流程覆盖四种结果（用户不存在、密码错误、账号禁用、成功），refreshToken 覆盖三种场景，changePassword 验证新旧密码加密。使用真实 JWT/bcrypt 操作而非 mock，确保了密码学逻辑的正确性。

**小问题：** 未覆盖 login 成功后更新 last_login_ip 失败的异常路径（第 93/153/163 行未覆盖）。

#### 3.3 settings.service.test.js — 评分 B+

**优点：** parseSemesterString 测试了 9 种边界场景，明确标注 S-04 安全修复验证用例。formatSemesterLabel 覆盖了秋季/春季两种显示逻辑。

**不足：** settings.service.js 还有 40% 代码未覆盖（第 5-19 行的初始化逻辑、第 88-101 行的学期列表获取），这些涉及数据库查询，需要 mock prisma。

#### 3.4 auto-arrange.test.js — 评分 B

**优点：** 采用"相对差值"策略避免硬编码魔法数字，calcMatchScore 覆盖了学院/层次/固有教材/已分配教材/空教材/教材内聚惩罚/教材数量分级/同学院内聚共 8 个维度的评分验证。isTeacherEligible 覆盖容量、学院限制、层次限制、教材硬上限 4 种资格检查。calcAllMatchRates 覆盖完全匹配、完全不匹配、空安排、内聚度计算。

**不足：** auto-arrange.js 共 1339 行，当前只测了 3 个导出函数（15% 覆盖率）。核心函数 `arrangeCourses`（排课主循环）、`trySwapOne`（置换优化）、`selectBestTeacher`（七层优先级选择）均未测试。根据记忆，trySwapOne 已知缺少学院/层次/课程资格校验。

#### 3.5 queries-eligibility.test.js — 评分 A-

**优点：** isTextbookMatch 测试了"修复九轮"的所有关键边界（空数组、null、undefined、回退到 textbookIds），多对多部分匹配和完全不匹配。isCollegeEligible 和 isLevelEligible 各自覆盖无限制/匹配/不匹配三种场景。

**小问题：** isLevelEligible 对 `trainingLevelId: null` 的测试用 `toBeFalsy()` 而非 `toBe(false)`，说明代码返回 null 而非 false，这可能是潜在的类型不一致问题。

#### 3.6 queries.test.js — 评分 B

**优点：** parseSemester 测试了 7 种场景，包括对年份逻辑关系不强制校验的设计决策做了明确标注。

**不足：** 与 settings.service.test.js 的 parseSemesterString 存在功能重叠（虽然测的是不同文件的不同函数）。queries.js 共 459 行，仅覆盖了 parseSemester + isTextbookMatch + isCollegeEligible + isLevelEligible 四个函数（12%），其余数据库查询函数（getTeachersForCourse、getClassesWithCourse 等）均未覆盖。

---

### 四、重复/冗余检测

| 函数 | 测试文件 | 说明 |
|------|---------|------|
| parseSemester | queries.test.js | arrange/queries.js 的解析函数 |
| parseSemesterString | settings.service.test.js | settings.service.js 的解析函数 |

两个函数功能类似（解析学期字符串），但位于不同模块，各自有独立测试，属于合理冗余。不过也暗示项目中存在两个功能重叠的学期解析函数，建议后续统一。

---

### 五、已知 Bug 的测试覆盖检查

根据项目记忆和审计报告，以下已知问题是否有回归测试保护：

| 已知问题 | 测试保护 | 说明 |
|---------|---------|------|
| S-04 学期参数注入 | 有 | settings.service.test.js 明确测试学期索引越界和年份不连续 |
| 九轮修复 inherentTextbookIds 空数组 | 有 | queries-eligibility.test.js 和 auto-arrange.test.js 均覆盖 |
| JWT 三密钥独立 | 有 | auth.service.test.js 验证 downloadToken 不能用 jwtSecret 验证 |
| naming.js Array/constructor 顺序 | 无 | naming.js 0% 覆盖 |
| Decimal 被 snakeToCamel 展开为乱码 | 无 | naming.middleware.js 0% 覆盖 |
| plan.controller 三轮匹配逻辑 | 无 | plan 相关 0% 覆盖 |
| trySwapOne 缺少资格校验 | 无 | auto-arrange.js 主算法未测试 |
| isClassMatchPlan OR逻辑 vs findBestMatchPlan 优先级链 | 无 | 相关服务未测试 |
| getClassesWithCourse 年级筛选精确匹配 | 无 | 相关查询未测试 |
| 培养方案匹配 Set 去重 | 无 | 相关查询未测试 |
| fail() 期望 string message | 无 | response.js 0% 覆盖 |
| validation.js 字段名 snake_case | 无 | validation.js 0% 覆盖 |

12 个已知问题中仅 3 个有回归测试保护，其余 9 个完全依赖人工验证。

---

### 六、建议与优先级

#### P0 — 立即处理（对现有测试的补强）

1. **vitest 依赖问题：** `npm install` 后 vitest 才可用，说明 server/node_modules 可能未完整提交或 `.gitignore` 排除了 vitest。建议确认 CI 环境中 `npm install` 包含 devDependencies。

2. **补充 auto-arrange 核心函数测试：** `selectBestTeacher` 七层优先级和 `trySwapOne` 置换函数是排课算法的核心，已知 trySwapOne 有资格校验缺陷。建议至少覆盖：优先级顺序正确性、置换后资格验证、边界容量场景。

3. **补充 naming.js 单元测试：** 这是已知的 bug 高发区（Array/constructor 守卫顺序、Decimal 展开问题），且是纯函数，测试成本极低。

#### P1 — 近期规划（高风险业务逻辑）

4. **naming.middleware.js 测试：** 含 constructor !== Object 守卫和 Array.isArray 检查顺序，直接影响所有 API 请求的数据格式。

5. **validation.js 测试：** 581 行验证规则，字段名必须 snake_case，是 422 错误的主要来源。建议对每个资源的验证规则至少覆盖合法/非法各一个用例。

6. **plan.service.js 测试：** 三轮匹配逻辑（custom_plan_id → major_id → training_level_id）复杂度高，已知有计数不一致的问题。

7. **teaching-arrange.service.js 测试：** getTeachersForCourse 是排课前的教师筛选，过滤 active 状态、学院/层次关联，逻辑关键。

#### P2 — 中期建设（提升测试体系）

8. **引入 API 集成测试：** 使用 supertest 对关键路由做端到端测试（登录→排课→查询），当前 18 个控制器全部 0% 覆盖。优先覆盖：auth 路由（登录/刷新/修改密码）、排课路由（单课程/批量）、导入路由（教师/班级）。

9. **导入/导出测试：** 导入涉及事务、部分导入模式（gate 逻辑）、自动创建关联记录，导出涉及 Excel 生成。建议用 mock prisma 测试解析逻辑和错误处理。

10. **前端组件测试：** 当前 client/ 无任何测试。建议引入 Vitest + @testing-library/vue，优先覆盖：排课结果弹窗（单课程/批量双路径）、筛选器组件（ClassFilterBar）、导入上传组件（el-upload headers 配置）。

#### P3 — 长期优化

11. **CI 集成：** 配置 GitHub Actions 或 Gitee CI，在 push 时自动运行测试+覆盖率，设定覆盖率门槛（如核心模块 > 60%）。

12. **覆盖率目标：** 按模块重要性分级设定目标——排课算法 > 80%，认证授权 > 90%，控制器 > 50%，工具函数 > 70%。

13. **统一学期解析：** 项目中存在 parseSemester（arrange/queries.js）和 parseSemesterString（settings.service.js）两个功能重叠的函数，建议统一为一个共享工具函数，减少重复测试维护成本。

---

### 七、测试架构评价

**Mock 策略：** 现有测试一致采用 vi.mock 隔离外部依赖（prisma、logger、config），mock 对象在工厂函数内定义避免变量提升问题，策略成熟可复用。

**测试组织：** `__tests__` 目录紧邻被测文件，命名规范 `.test.js`，vitest.config.js 配置清晰。但缺少按测试类型分层（unit / integration / e2e）。

**断言质量：** 断言精确（toBe/toEqual/toBeTruthy/toThrow），有明确的中文注释说明测试意图和对应的 bug 修复编号，可读性好。

**维护成本：** 测试用例与具体实现耦合度适中，auto-arrange 测试用"相对差值"策略有效降低了 magic number 的维护负担。

---

### 附：覆盖率可视化

```
auth.service.js        ████████████████████████████████████████████░░  93.6%
auth.middleware.js     ████████████████████████████████████████░░░░░░  83.3%
settings.service.js    █████████████████████████████░░░░░░░░░░░░░░░░░  60.5%
auto-arrange.js        ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  15.3%
queries.js (arrange)   ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  11.9%
controllers (18个)     ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%
routes (15个)          ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%
其他 services (5个)    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%
其他 middleware (6个)  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%
utils (5个)            █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   2.6%
client (前端)          ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   无测试
```
