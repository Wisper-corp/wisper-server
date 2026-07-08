-- CreateEnum
CREATE TYPE "KycFieldStatus" AS ENUM ('UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "kyc_verifications" (
    "id" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "emailStatus" "KycFieldStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedEmail" TEXT,
    "phoneStatus" "KycFieldStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedPhone" TEXT,
    "ninStatus" "KycFieldStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "ninAttempts" INTEGER NOT NULL DEFAULT 0,
    "ninNumber" TEXT,
    "ninFirstName" TEXT,
    "ninLastName" TEXT,
    "ninDob" TEXT,
    "addressStatus" "KycFieldStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "addressText" TEXT,
    "addressDocUrl" TEXT,
    "addressDocType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_verification_badges" (
    "id" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isAdminGranted" BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "gracePeriodEnd" TIMESTAMP(3),
    "lastBilledAt" TIMESTAMP(3),
    "isFeeExempt" BOOLEAN NOT NULL DEFAULT false,
    "feeExemptUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_verification_badges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_verifications_authId_key" ON "kyc_verifications"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_verification_badges_authId_key" ON "kyc_verification_badges"("authId");

-- AddForeignKey
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_authId_fkey" FOREIGN KEY ("authId") REFERENCES "auths"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_verification_badges" ADD CONSTRAINT "kyc_verification_badges_authId_fkey" FOREIGN KEY ("authId") REFERENCES "auths"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
