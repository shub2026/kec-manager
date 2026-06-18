-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_teachers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "birth_date" TEXT,
    "personnel_type" TEXT NOT NULL DEFAULT 'full_time',
    "qualification_type" TEXT,
    "default_weekly_hours" REAL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "affiliated_college_id" INTEGER,
    CONSTRAINT "teachers_affiliated_college_id_fkey" FOREIGN KEY ("affiliated_college_id") REFERENCES "colleges" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_teachers" ("affiliated_college_id", "birth_date", "created_at", "default_weekly_hours", "gender", "id", "name", "personnel_type", "qualification_type", "sort_order", "updated_at") SELECT "affiliated_college_id", "birth_date", "created_at", "default_weekly_hours", "gender", "id", "name", "personnel_type", "qualification_type", "sort_order", "updated_at" FROM "teachers";
DROP TABLE "teachers";
ALTER TABLE "new_teachers" RENAME TO "teachers";
CREATE INDEX "teachers_personnel_type_idx" ON "teachers"("personnel_type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
