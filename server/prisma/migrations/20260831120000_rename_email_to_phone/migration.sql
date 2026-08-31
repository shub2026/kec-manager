-- 用户联系方式由邮箱改为联系电话：重命名列并清空旧邮箱值（邮箱无业务用途）
ALTER TABLE "users" RENAME COLUMN "email" TO "phone";
UPDATE "users" SET "phone" = NULL WHERE "phone" IS NOT NULL;
