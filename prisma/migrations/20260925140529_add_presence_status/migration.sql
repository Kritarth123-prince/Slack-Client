-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN     "autoAwayEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "doNotDisturb" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "presence" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "presenceManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "statusEmoji" TEXT,
ADD COLUMN     "statusExpiresAt" TIMESTAMP(3),
ADD COLUMN     "statusText" TEXT;
