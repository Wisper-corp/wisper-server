-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
