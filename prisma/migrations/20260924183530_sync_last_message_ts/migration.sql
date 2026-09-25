-- Baseline migration: records a column that was already added directly to the database
-- (via `prisma db push`) without ever being captured in a migration file. This does not
-- change the database — it is only marked as applied via `prisma migrate resolve`.
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "lastMessageTs" TEXT;
