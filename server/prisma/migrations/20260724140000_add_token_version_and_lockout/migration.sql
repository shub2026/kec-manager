-- SEC-H1: 引入 token_version 字段，用于重置密码/吊销会话时使所有已签发令牌失效
-- 旧令牌 payload 不含 v 字段，校验时 v !== user.token_version 即被拒绝（默认 0 即可）
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- SEC-M4: 账号锁定字段，连续登录失败 N 次后短期锁定
ALTER TABLE "users" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" DATETIME;

-- 索引：锁定查询性能
CREATE INDEX "idx_users_locked_until" ON "users" ("locked_until") WHERE "locked_until" IS NOT NULL;
