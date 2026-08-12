-- RenameColumn: teachers.qualification_type -> remark
-- 字段语义由"教师资格类型"调整为通用"备注"，仅重命名列，数据原样保留。
-- （textbooks.price 的 schema 漂移已反向修正为 Float 与库内 REAL 对齐，无需 DDL）
ALTER TABLE "teachers" RENAME COLUMN "qualification_type" TO "remark";
