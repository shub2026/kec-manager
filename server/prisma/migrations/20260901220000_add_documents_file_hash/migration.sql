-- AlterTable
ALTER TABLE "documents" ADD COLUMN "file_hash" TEXT;

-- CreateIndex
CREATE INDEX "documents_file_hash_idx" ON "documents"("file_hash");
