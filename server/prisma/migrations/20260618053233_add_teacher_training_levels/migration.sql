-- CreateTable
CREATE TABLE "teacher_training_levels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teacher_id" INTEGER NOT NULL,
    "training_level_id" INTEGER NOT NULL,
    CONSTRAINT "teacher_training_levels_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teacher_training_levels_training_level_id_fkey" FOREIGN KEY ("training_level_id") REFERENCES "training_levels" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "teacher_training_levels_teacher_id_training_level_id_key" ON "teacher_training_levels"("teacher_id", "training_level_id");
