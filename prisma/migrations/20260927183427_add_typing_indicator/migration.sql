-- CreateTable
CREATE TABLE "TypingIndicator" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "threadTs" TEXT NOT NULL DEFAULT '',
    "slackUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TypingIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TypingIndicator_conversationId_updatedAt_idx" ON "TypingIndicator"("conversationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TypingIndicator_conversationId_threadTs_slackUserId_key" ON "TypingIndicator"("conversationId", "threadTs", "slackUserId");

-- AddForeignKey
ALTER TABLE "TypingIndicator" ADD CONSTRAINT "TypingIndicator_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypingIndicator" ADD CONSTRAINT "TypingIndicator_slackUserId_fkey" FOREIGN KEY ("slackUserId") REFERENCES "SlackUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
