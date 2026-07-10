-- Sync migration: capture schema changes that were applied via `prisma db push`
-- but never recorded as a migration file.
--
-- NOTE: training_plans.college_id already exists in production (added earlier),
-- so it is NOT included here. Only changes confirmed missing from production.
--
-- Changes:
-- 1. training_plans: add status column (missing from production)
-- 2. token_blacklist: new table for JWT revocation
-- 3. courses: unique constraint on name
-- 4. textbooks: unique constraint on title
-- 5. classes: index on is_left_school
-- 6. teachers: indexes on affiliated_college_id and status
-- 7. token_blacklist: indexes on expires_at and unique on jti

-- 1. training_plans: add status column
ALTER TABLE "training_plans" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';

-- 2. token_blacklist table (IF NOT EXISTS for safety)
CREATE TABLE IF NOT EXISTS "token_blacklist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jti" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. courses: unique on name (IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "courses_name_key" ON "courses"("name");

-- 4. textbooks: unique on title (IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "textbooks_title_key" ON "textbooks"("title");

-- 5. classes: index on is_left_school (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "classes_is_left_school_idx" ON "classes"("is_left_school");

-- 6. teachers: indexes on affiliated_college_id and status (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "teachers_affiliated_college_id_idx" ON "teachers"("affiliated_college_id");
CREATE INDEX IF NOT EXISTS "teachers_status_idx" ON "teachers"("status");

-- 7. token_blacklist indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "token_blacklist_expires_at_idx" ON "token_blacklist"("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "token_blacklist_jti_key" ON "token_blacklist"("jti");
