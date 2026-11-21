-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastPolledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConversationSetting" ADD COLUMN     "clearedBeforeTs" TEXT;

-- AlterTable
ALTER TABLE "ReadState" ADD COLUMN     "rewoundAt" TIMESTAMP(3);
