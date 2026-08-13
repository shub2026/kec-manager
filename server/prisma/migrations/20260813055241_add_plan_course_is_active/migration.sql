-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_plan_courses" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plan_id" INTEGER NOT NULL,
    "course_id" INTEGER NOT NULL,
    "start_semester" INTEGER NOT NULL,
    "end_semester" INTEGER NOT NULL,
    "weekly_hours" REAL NOT NULL,
    "weeks_per_semester" INTEGER NOT NULL DEFAULT 18,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "plan_courses_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "training_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "plan_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_plan_courses" ("course_id", "created_at", "end_semester", "id", "plan_id", "sort_order", "start_semester", "updated_at", "weekly_hours", "weeks_per_semester") SELECT "course_id", "created_at", "end_semester", "id", "plan_id", "sort_order", "start_semester", "updated_at", "weekly_hours", "weeks_per_semester" FROM "plan_courses";
DROP TABLE "plan_courses";
ALTER TABLE "new_plan_courses" RENAME TO "plan_courses";
CREATE INDEX "plan_courses_plan_id_idx" ON "plan_courses"("plan_id");
CREATE INDEX "plan_courses_course_id_idx" ON "plan_courses"("course_id");
CREATE UNIQUE INDEX "plan_courses_plan_id_course_id_key" ON "plan_courses"("plan_id", "course_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
