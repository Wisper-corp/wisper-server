-- Manual Migration: Add Offers and Post Pricing
-- Run this SQL directly on your PostgreSQL database if Prisma migration fails

-- 1. Add OfferStatus enum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'PAID');

-- 2. Create offers table
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- 3. Add price column to posts table
ALTER TABLE "posts" ADD COLUMN "price" DOUBLE PRECISION;

-- 4. Add foreign key constraints
ALTER TABLE "offers" ADD CONSTRAINT "offers_senderId_fkey" 
    FOREIGN KEY ("senderId") REFERENCES "auths"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offers" ADD CONSTRAINT "offers_receiverId_fkey" 
    FOREIGN KEY ("receiverId") REFERENCES "auths"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Create indexes for performance
CREATE INDEX "offers_senderId_idx" ON "offers"("senderId");
CREATE INDEX "offers_receiverId_idx" ON "offers"("receiverId");
CREATE INDEX "offers_chatId_idx" ON "offers"("chatId");
CREATE INDEX "offers_status_idx" ON "offers"("status");

-- Verification queries (run these to check if migration succeeded)
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'offers';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'price';
