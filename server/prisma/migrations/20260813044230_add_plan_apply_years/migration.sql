-- AlterTable
ALTER TABLE "training_plans" ADD COLUMN "apply_from_year" INTEGER;
ALTER TABLE "training_plans" ADD COLUMN "apply_to_year" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_classes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "enrollment_year" INTEGER NOT NULL,
    "duration_years" INTEGER NOT NULL,
    "major_id" INTEGER,
    "college_id" INTEGER,
    "training_level_id" INTEGER,
    "student_count" INTEGER NOT NULL,
    "custom_plan_id" INTEGER,
    "combination_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "is_left_school" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "classes_major_id_fkey" FOREIGN KEY ("major_id") REFERENCES "majors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "classes_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "classes_training_level_id_fkey" FOREIGN KEY ("training_level_id") REFERENCES "training_levels" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "classes_custom_plan_id_fkey" FOREIGN KEY ("custom_plan_id") REFERENCES "training_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "classes_combination_id_fkey" FOREIGN KEY ("combination_id") REFERENCES "class_combinations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_classes" ("college_id", "combination_id", "created_at", "custom_plan_id", "duration_years", "enrollment_year", "id", "is_left_school", "major_id", "name", "status", "student_count", "training_level_id", "updated_at") SELECT "college_id", "combination_id", "created_at", "custom_plan_id", "duration_years", "enrollment_year", "id", "is_left_school", "major_id", "name", "status", "student_count", "training_level_id", "updated_at" FROM "classes";
DROP TABLE "classes";
ALTER TABLE "new_classes" RENAME TO "classes";
CREATE INDEX "classes_status_idx" ON "classes"("status");
CREATE INDEX "classes_enrollment_year_idx" ON "classes"("enrollment_year");
CREATE INDEX "classes_major_id_status_idx" ON "classes"("major_id", "status");
CREATE INDEX "classes_training_level_id_idx" ON "classes"("training_level_id");
CREATE INDEX "classes_college_id_idx" ON "classes"("college_id");
CREATE INDEX "classes_custom_plan_id_idx" ON "classes"("custom_plan_id");
CREATE INDEX "classes_is_left_school_idx" ON "classes"("is_left_school");
CREATE INDEX "classes_combination_id_idx" ON "classes"("combination_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "users_locked_until_idx" ON "users"("locked_until");
