-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "namespace" TEXT NOT NULL DEFAULT 'default';

-- CreateIndex
CREATE INDEX "KnowledgeSource_namespace_status_idx" ON "KnowledgeSource"("namespace", "status");
