-- CreateTable
CREATE TABLE "arrange_locks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lock_key" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "arrange_locks_lock_key_key" ON "arrange_locks"("lock_key");
