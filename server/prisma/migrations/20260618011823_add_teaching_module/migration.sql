-- CreateTable
CREATE TABLE "teachers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "birth_date" TEXT,
    "personnel_type" TEXT NOT NULL DEFAULT 'full_time',
    "qualification_type" TEXT,
    "default_weekly_hours" REAL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "teacher_courses" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacher_id" INTEGER NOT NULL,
    "course_id" INTEGER NOT NULL,
    CONSTRAINT "teacher_courses_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teacher_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "teacher_scheduling_colleges" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacher_id" INTEGER NOT NULL,
    "college_id" INTEGER NOT NULL,
    CONSTRAINT "teacher_scheduling_colleges_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teacher_scheduling_colleges_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "colleges" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "teaching_assignments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacher_id" INTEGER NOT NULL,
    "class_id" INTEGER NOT NULL,
    "course_id" INTEGER NOT NULL,
    "semester" TEXT NOT NULL,
    "weekly_hours" REAL NOT NULL DEFAULT 0,
    "is_auto" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "teaching_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teaching_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teaching_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "teachers_personnel_type_idx" ON "teachers"("personnel_type");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_courses_teacher_id_course_id_key" ON "teacher_courses"("teacher_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_scheduling_colleges_teacher_id_college_id_key" ON "teacher_scheduling_colleges"("teacher_id", "college_id");

-- CreateIndex
CREATE INDEX "teaching_assignments_teacher_id_idx" ON "teaching_assignments"("teacher_id");

-- CreateIndex
CREATE INDEX "teaching_assignments_semester_idx" ON "teaching_assignments"("semester");

-- CreateIndex
CREATE INDEX "teaching_assignments_course_id_semester_idx" ON "teaching_assignments"("course_id", "semester");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_assignments_class_id_course_id_semester_key" ON "teaching_assignments"("class_id", "course_id", "semester");
