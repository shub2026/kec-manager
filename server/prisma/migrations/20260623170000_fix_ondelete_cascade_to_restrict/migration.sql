-- Fix C-1: Align teaching_assignments ON DELETE from CASCADE to RESTRICT
-- The Prisma schema declares onDelete: Restrict but the DB was created with CASCADE

PRAGMA foreign_keys=OFF;

CREATE TABLE "teaching_assignments_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacher_id" INTEGER NOT NULL,
    "class_id" INTEGER NOT NULL,
    "course_id" INTEGER NOT NULL,
    "semester" TEXT NOT NULL,
    "weekly_hours" REAL NOT NULL DEFAULT 0,
    "is_auto" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "teaching_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "teaching_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "teaching_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "teaching_assignments_new" SELECT * FROM "teaching_assignments";

DROP TABLE "teaching_assignments";

ALTER TABLE "teaching_assignments_new" RENAME TO "teaching_assignments";

-- Recreate all indexes
CREATE INDEX "teaching_assignments_teacher_id_idx" ON "teaching_assignments"("teacher_id");
CREATE INDEX "teaching_assignments_semester_idx" ON "teaching_assignments"("semester");
CREATE INDEX "teaching_assignments_course_id_semester_idx" ON "teaching_assignments"("course_id", "semester");
CREATE INDEX "teaching_assignments_class_id_semester_idx" ON "teaching_assignments"("class_id", "semester");
CREATE INDEX "teaching_assignments_teacher_id_semester_idx" ON "teaching_assignments"("teacher_id", "semester");
CREATE UNIQUE INDEX "teaching_assignments_class_id_course_id_semester_key" ON "teaching_assignments"("class_id", "course_id", "semester");

PRAGMA foreign_keys=ON;
