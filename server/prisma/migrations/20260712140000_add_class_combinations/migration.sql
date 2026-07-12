-- CreateTable：合班教学组
CREATE TABLE "class_combinations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "class_combinations_name_idx" ON "class_combinations"("name");

-- AddColumn：classes 新增 combination_id 外键（可空）
ALTER TABLE "classes" ADD COLUMN "combination_id" INTEGER;

-- CreateIndex
CREATE INDEX "classes_combination_id_idx" ON "classes"("combination_id");

-- AddForeignKey
-- 注意：使用 ON DELETE SET NULL，删除合班组记录时不阻塞班级；班级删除时由应用层清理组合
ALTER TABLE "classes" ADD CONSTRAINT "classes_combination_id_fkey"
    FOREIGN KEY ("combination_id") REFERENCES "class_combinations"("id")
    ON DELETE SET NULL;
