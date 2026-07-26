-- AlterTable: F9 修复——添加 owner 列，防止误释放其他进程持有的锁
ALTER TABLE "arrange_locks" ADD COLUMN "owner" TEXT NOT NULL DEFAULT '';
