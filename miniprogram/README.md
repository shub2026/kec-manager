# KEC 教务 · 微信小程序端（体验版 MVP）

零侵入现有 `client/`(Web) 与 `server/`(后端) 的微信小程序，仅做**体验版**只读查询工具。
原生于 `miniprogram/` 目录，与 `client`、`server` 平级。

## 页面清单（8 页）

| 页面 | 路由 | 类型 | 数据源 |
|------|------|------|--------|
| 登录 | `pages/login` | 普通 | `POST /api/auth/login` |
| 首页概览 | `pages/home` | tabBar | `GET /api/dashboard/stats` + `insights` |
| 课程查询 | `pages/teaching-arrange` | tabBar | `GET /api/query/course`（按课程聚合各培养方案采用情况，对标 WEB 端课程查询页） |
| 教材查询 | `pages/textbook` | tabBar | `GET /api/textbooks`（搜索+分页） |
| 教材详情 | `pages/textbook-detail` | navigateTo | `GET /api/query/textbook/:id` |
| 教师课时 | `pages/teacher-hours` | tabBar | `GET /api/teaching-arrange/statistics` |
| 课时统计 | `pages/hours-statistics` | navigateTo（用户新增页） | `GET /api/teaching-arrange/statistics` |
| 我的 | `pages/profile` | tabBar | `GET /api/auth/me` |

## 与后端对齐的关键约定

- **请求层** `utils/request.js`：GET 自动带 `Authorization: Bearer`；非 GET 自动带 `X-CSRF-Token` 头 +
  `enableCookie` 让 wx 管理 `XSRF-TOKEN` cookie；401 仅 GET 静默刷新重试；403 重拉 CSRF 重试一次。
- **登录缓存** `utils/auth.js`：登录成功后必须缓存响应体里的 `csrfToken`，否则后续 POST 头/ cookie 不一致会 403。
- **学期参数**：统计类接口经 `utils/api.js ensureSemester()` 自动注入 `semester=currentSemester.value`（取自 `/api/settings`）。
- **命名转换**：后端命名中间件把 query/body 的 camelCase 转 snake，小程序一律发 camelCase（`page/pageSize/semester/grade/title`）。
- **合班去重**：`statistics` 后端已按逻辑教学单元去重（合班=1 班、课时计 1 次），口径与 Web 端一致。

## 上线前必做（非阻断）

1. ✅ `utils/config.js`：`API_BASE` 已设为 `https://kec.sntip.cn`（已备案 HTTPS；实测 `/api/health` 返回 200、`/api/settings` 返回 200）。
2. ✅ `project.config.json`：`appid` 已设为 `wx644a8a088dd18bac`；真机体验版仍需在 MP 后台「开发管理-开发设置」把 `kec.sntip.cn` 加进 **request 合法域名**（含 https 校验，已备案可过）。
3. ✅ CSRF 已**后端根治**（用户授权「后端业务代码可改，只要不影响 WEB 端」）：修改 `server/src/middleware/csrf.js`
   - 带合法 `Authorization: Bearer` 的请求直接放行（CSRF 只防浏览器 Cookie 会话劫持；Bearer 由客户端显式携带，跨站带不来 → WEB 端本来就带 Bearer，行为不变）。
   - 登录/刷新引导端点：仅校验 `X-CSRF-Token` 头的 HMAC 签名（小程序无法回传 Strict cookie，但头是服务端签名的、攻击者无法伪造）。WEB 端仍走完整 Double Submit。
   - 已用单测覆盖 7 个场景（小程序登录/已登录、WEB 登录/已登录、伪造签名、无凭据、缺 CSRF 头 Cookie 会话），全部符合预期。
   - `miniprogram/nginx-csrf-fallback.conf` 不再需要，保留作可选保险。
4. 三端（开发者工具 / iOS / Android）实机验证登录链路。
5. 个人主体体验成员上限 15 人。

## 验证状态

- ✅ 13 个 JS 全部通过 `node --check` 语法校验
- ✅ 11 个 JSON 全部通过 JSON.parse 校验
- ✅ app.json 8 个 page 路由均存在对应 `.js`
- ⏳ 三端实机登录链路（依赖真实域名 + AppID）
