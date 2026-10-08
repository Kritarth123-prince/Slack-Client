-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastListSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageNotification_userId_messageId_key" ON "MessageNotification"("userId", "messageId");

-- AddForeignKey
ALTER TABLE "MessageNotification" ADD CONSTRAINT "MessageNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageNotification" ADD CONSTRAINT "MessageNotification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
