-- CreateTable
CREATE TABLE "TurnTrace" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "phase" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TurnTrace_sessionId_startedAt_idx" ON "TurnTrace"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "TurnTrace_messageId_idx" ON "TurnTrace"("messageId");
