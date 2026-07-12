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

-- Note: SQLite 不支持 ALTER TABLE ADD CONSTRAINT，外键关系由 Prisma schema 管理
-- ON DELETE SET NULL：删除合班组记录时不阻塞班级；班级删除时由应用层清理组合
