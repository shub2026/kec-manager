-- Sync migration: capture all schema changes that were applied via `prisma db push`
-- but never recorded as a migration. This ensures production databases (which only
-- run `prisma migrate deploy`) receive the same schema as development.
--
-- Changes included:
-- 1. training_plans: add college_id and status columns
-- 2. token_blacklist: new table for JWT revocation
-- 3. courses: unique constraint on name
-- 4. textbooks: unique constraint on title
-- 5. classes: index on is_left_school
-- 6. teachers: indexes on affiliated_college_id and status
-- 7. token_blacklist: indexes on expires_at and unique on jti

-- 1. training_plans: add college_id (FK to colleges) and status
ALTER TABLE "training_plans" ADD COLUMN "college_id" INTEGER;
ALTER TABLE "training_plans" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';
CREATE INDEX "training_plans_college_id_idx" ON "training_plans"("college_id");

-- Note: the foreign key for college_id cannot be added via ALTER TABLE in SQLite.
-- The column exists and is functional; the FK constraint is enforced at the
-- application layer via Prisma. A future recreate-table migration can add it if needed.

-- 2. token_blacklist table
CREATE TABLE "token_blacklist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jti" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. courses: unique on name
CREATE UNIQUE INDEX "courses_name_key" ON "courses"("name");

-- 4. textbooks: unique on title
CREATE UNIQUE INDEX "textbooks_title_key" ON "textbooks"("title");

-- 5. classes: index on is_left_school
CREATE INDEX "classes_is_left_school_idx" ON "classes"("is_left_school");

-- 6. teachers: indexes on affiliated_college_id and status
CREATE INDEX "teachers_affiliated_college_id_idx" ON "teachers"("affiliated_college_id");
CREATE INDEX "teachers_status_idx" ON "teachers"("status");

-- 7. token_blacklist indexes
CREATE INDEX "token_blacklist_expires_at_idx" ON "token_blacklist"("expires_at");
CREATE UNIQUE INDEX "token_blacklist_jti_key" ON "token_blacklist"("jti");
