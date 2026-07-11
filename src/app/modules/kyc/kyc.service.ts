import { KycFieldStatus } from "@prisma/client";
import bcrypt from "bcrypt";
import ApiError from "../../middlewares/classes/ApiError";
import generateOTP from "../../utils/generateOTP";
import prisma from "../../utils/prisma";
import { sendEmail } from "../../utils/sendEmail";
import { sendNotificationToUser } from "../../utils/sendNotification";
import path from "path";

const OTP_EXPIRY_MINUTES = 10;
const BADGE_FEE = 6500;
const MIN_RECOMMENDATIONS = 20;
const MAX_NIN_ATTEMPTS = 3;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Upsert (get-or-create) KycVerification row for a user */
const getOrCreateKyc = async (authId: string) => {
  let kyc = await prisma.kycVerification.findUnique({ where: { authId } });
  if (!kyc) {
    kyc = await prisma.kycVerification.create({ data: { authId } });
  }
  return kyc;
};

/** Hash OTP, upsert into otps table, send email */
const issueEmailOtp = async (email: string, subject: string) => {
  const rawOtp = generateOTP();
  const hashed = await bcrypt.hash(rawOtp, 10);
  const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.otp.upsert({
    where: { email },
    create: { email, otp: hashed, expires, attempts: 0, isVerified: false },
    update: { otp: hashed, expires, attempts: 0, isVerified: false },
  });

  // Use the existing email template path pattern
  const templatePath = path.join(
    process.cwd(),
    "src/app/utils/email-templates/otp.html"
  );

  try {
    await sendEmail(email, subject, templatePath, {
      OTP: rawOtp,
      EXPIRY: `${OTP_EXPIRY_MINUTES} minutes`,
    });
  } catch {
    // If template doesn't exist fall back to raw OTP in subject — don't block
    console.warn(`KYC OTP for ${email}: ${rawOtp}`);
  }
};

/** Verify OTP from otps table, throw on mismatch/expired */
const verifyOtpCode = async (email: string, code: string) => {
  const record = await prisma.otp.findUnique({ where: { email } });
  if (!record || record.isVerified) {
    throw new ApiError(400, "No active OTP found. Please request a new one.");
  }
  if (record.expires < new Date()) {
    throw new ApiError(400, "OTP has expired. Please request a new one.");
  }
  if (record.attempts >= 3) {
    throw new ApiError(400, "Too many attempts. Please request a new OTP.");
  }

  await prisma.otp.update({
    where: { email },
    data: { attempts: { increment: 1 } },
  });

  const matched = await bcrypt.compare(code, record.otp);
  if (!matched) throw new ApiError(400, "Invalid OTP. Please try again.");

  // Mark used
  await prisma.otp.update({ where: { email }, data: { isVerified: true } });
};

// ─────────────────────────────────────────────
// EMAIL VERIFICATION
// ─────────────────────────────────────────────

const sendEmailOtp = async (authId: string, email: string) => {
  // Validate email isn't already used by another account
  const existing = await prisma.auth.findFirst({
    where: { email, NOT: { id: authId } },
  });
  if (existing) throw new ApiError(400, "Email is already used by another account.");

  await issueEmailOtp(email, "Wisper — Email Verification OTP");
  return { message: "OTP sent to " + email };
};

const verifyEmail = async (authId: string, email: string, otp: string) => {
  await verifyOtpCode(email, otp);

  await prisma.kycVerification.upsert({
    where: { authId },
    create: { authId, emailStatus: KycFieldStatus.VERIFIED, verifiedEmail: email },
    update: { emailStatus: KycFieldStatus.VERIFIED, verifiedEmail: email },
  });

  return { message: "Email verified successfully." };
};

// ─────────────────────────────────────────────
// PHONE VERIFICATION (OTP sent via Termii SMS)
// ─────────────────────────────────────────────

const sendSmsOtp = async (phone: string): Promise<void> => {
  const rawOtp = generateOTP();
  const hashed = await bcrypt.hash(rawOtp, 10);
  const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Store OTP keyed by phone (re-use otps table, phone as "email" key)
  await prisma.otp.upsert({
    where: { email: phone },
    create: { email: phone, otp: hashed, expires, attempts: 0, isVerified: false },
    update: { otp: hashed, expires, attempts: 0, isVerified: false },
  });

  const termiiApiKey = process.env.TERMII_API_KEY || "";
  const termiiSenderId = process.env.TERMII_SENDER_ID || "N-Alert";
  const termiiBaseUrl = (process.env.TERMII_BASE_URL || "https://v4.api.termii.com") + "/api/sms/send";

  if (!termiiApiKey) {
    console.warn(`[Termii] TERMII_API_KEY not set. OTP for ${phone}: ${rawOtp}`);
    return;
  }

  const body = {
    to: phone,
    from: termiiSenderId,
    sms: `Your Wisper phone verification code is: ${rawOtp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`,
    type: "plain",
    api_key: termiiApiKey,
    channel: "generic",
  };

  const res = await fetch(termiiBaseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[Termii] SMS failed for ${phone}:`, err);
    throw new ApiError(500, "Failed to send SMS. Please try again.");
  }
};

const sendPhoneOtp = async (authId: string, phone: string) => {
  await getOrCreateKyc(authId);
  await sendSmsOtp(phone);
  return { message: "OTP sent to " + phone };
};

const verifyPhone = async (authId: string, phone: string, otp: string) => {
  await verifyOtpCode(phone, otp);

  await prisma.kycVerification.upsert({
    where: { authId },
    create: { authId, phoneStatus: KycFieldStatus.VERIFIED, verifiedPhone: phone },
    update: { phoneStatus: KycFieldStatus.VERIFIED, verifiedPhone: phone },
  });

  return { message: "Phone number verified successfully." };
};

// ─────────────────────────────────────────────
// NIN VERIFICATION (via QoreID)
// ─────────────────────────────────────────────

const verifyNin = async (authId: string, nin: string) => {
  if (!/^\d{11}$/.test(nin)) {
    throw new ApiError(400, "NIN must be exactly 11 digits.");
  }

  const kyc = await getOrCreateKyc(authId);

  // Enforce max attempts
  if (kyc.ninAttempts >= MAX_NIN_ATTEMPTS) {
    throw new ApiError(
      400,
      "Maximum NIN verification attempts (3) reached. Please contact Customer Support."
    );
  }

  // If already verified
  if (kyc.ninStatus === KycFieldStatus.VERIFIED) {
    throw new ApiError(400, "NIN already verified.");
  }

  // Increment attempt before calling QoreID (count even on API failure)
  const updatedKyc = await prisma.kycVerification.update({
    where: { authId },
    data: { ninAttempts: { increment: 1 } },
  });

  const qoreApiKey = process.env.QOREID_API_KEY || "";
  const qoreAppId = process.env.QOREID_APP_ID || "";

  if (!qoreApiKey || !qoreAppId) {
    throw new ApiError(500, "NIN verification service not configured. Please contact support.");
  }

  // QoreID — get access token first (returns 201)
  const tokenRes = await fetch(`https://api.qoreid.com/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: qoreAppId, secret: qoreApiKey }),
  });

  if (!tokenRes.ok && tokenRes.status !== 201) {
    await prisma.kycVerification.update({
      where: { authId },
      data: { ninStatus: KycFieldStatus.REJECTED },
    });
    throw new ApiError(500, "NIN verification service unavailable. Please try again later.");
  }

  const tokenData = await tokenRes.json() as any;
  const accessToken: string = tokenData.accessToken;

  if (!accessToken) {
    throw new ApiError(500, "NIN verification service error. Please try again later.");
  }

  // QoreID — NIN lookup
  const qoreRes = await fetch(`https://api.qoreid.com/v1/ng/identities/nin/${nin}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const attemptsLeft = MAX_NIN_ATTEMPTS - updatedKyc.ninAttempts;

  if (!qoreRes.ok) {
    const errBody = await qoreRes.json().catch(() => ({})) as any;
    const errMsg = errBody?.message || "NIN verification failed.";

    // Mark as rejected on this attempt
    await prisma.kycVerification.update({
      where: { authId },
      data: { ninStatus: KycFieldStatus.REJECTED },
    });

    if (updatedKyc.ninAttempts >= MAX_NIN_ATTEMPTS) {
      throw new ApiError(400, "Maximum NIN attempts reached. Please contact Customer Support.");
    }

    throw new ApiError(400, `${errMsg} Attempts remaining: ${attemptsLeft}.`);
  }

  const data = await qoreRes.json() as any;
  const applicant = data?.applicant || data?.nin || data;

  const firstName: string = applicant?.firstname || applicant?.firstName || "";
  const lastName: string = applicant?.surname || applicant?.lastName || "";
  const dob: string = applicant?.birthdate || applicant?.dateOfBirth || "";

  if (!firstName && !lastName) {
    await prisma.kycVerification.update({
      where: { authId },
      data: { ninStatus: KycFieldStatus.REJECTED },
    });
    throw new ApiError(
      400,
      `Could not retrieve NIN details. Attempts remaining: ${attemptsLeft}.`
    );
  }

  await prisma.kycVerification.update({
    where: { authId },
    data: {
      ninStatus: KycFieldStatus.VERIFIED,
      ninNumber: nin,
      ninFirstName: firstName,
      ninLastName: lastName,
      ninDob: dob,
    },
  });

  return {
    message: "NIN verified successfully.",
    data: { firstName, lastName, dateOfBirth: dob },
  };
};

// ─────────────────────────────────────────────
// ADDRESS VERIFICATION
// ─────────────────────────────────────────────

const submitAddress = async (
  authId: string,
  addressText: string,
  addressDocUrl: string,
  addressDocType: string
) => {
  const validDocTypes = ["utility_bill", "bank_statement", "tenancy_agreement"];
  if (!validDocTypes.includes(addressDocType)) {
    throw new ApiError(
      400,
      "Invalid document type. Accepted: utility_bill, bank_statement, tenancy_agreement."
    );
  }

  await prisma.kycVerification.upsert({
    where: { authId },
    create: {
      authId,
      addressStatus: KycFieldStatus.PENDING_REVIEW,
      addressText,
      addressDocUrl,
      addressDocType,
    },
    update: {
      addressStatus: KycFieldStatus.PENDING_REVIEW,
      addressText,
      addressDocUrl,
      addressDocType,
    },
  });

  return { message: "Address submitted for review. You will be notified once approved." };
};

// Admin: approve or reject address
const reviewAddress = async (
  targetAuthId: string,
  action: "approve" | "reject"
) => {
  const kyc = await prisma.kycVerification.findUnique({ where: { authId: targetAuthId } });
  if (!kyc) throw new ApiError(404, "KYC record not found.");

  if (kyc.addressStatus !== KycFieldStatus.PENDING_REVIEW) {
    throw new ApiError(400, "No pending address submission to review.");
  }

  const newStatus =
    action === "approve" ? KycFieldStatus.VERIFIED : KycFieldStatus.REJECTED;

  await prisma.kycVerification.update({
    where: { authId: targetAuthId },
    data: { addressStatus: newStatus },
  });

  const notifTitle =
    action === "approve" ? "Address Verified ✅" : "Address Verification Rejected";
  const notifBody =
    action === "approve"
      ? "Your proof of address has been approved."
      : "Your proof of address was rejected. Please resubmit with a valid document.";

  await sendNotificationToUser(targetAuthId, notifTitle, notifBody);

  return { message: `Address ${action}d successfully.` };
};

// ─────────────────────────────────────────────
// GET KYC STATUS
// ─────────────────────────────────────────────

const getKycStatus = async (authId: string) => {
  const kyc = await prisma.kycVerification.findUnique({ where: { authId } });
  const badge = await prisma.kycVerificationBadge.findUnique({ where: { authId } });

  const recommendationCount = await prisma.recommendation.count({
    where: { receiverId: authId },
  });

  return {
    email: {
      status: kyc?.emailStatus ?? KycFieldStatus.UNVERIFIED,
      verifiedEmail: kyc?.verifiedEmail ?? null,
    },
    phone: {
      status: kyc?.phoneStatus ?? KycFieldStatus.UNVERIFIED,
      verifiedPhone: kyc?.verifiedPhone ?? null,
    },
    nin: {
      status: kyc?.ninStatus ?? KycFieldStatus.UNVERIFIED,
      attemptsUsed: kyc?.ninAttempts ?? 0,
      maxAttempts: MAX_NIN_ATTEMPTS,
      firstName: kyc?.ninFirstName ?? null,
      lastName: kyc?.ninLastName ?? null,
      dateOfBirth: kyc?.ninDob ?? null,
    },
    address: {
      status: kyc?.addressStatus ?? KycFieldStatus.UNVERIFIED,
      addressText: kyc?.addressText ?? null,
      docType: kyc?.addressDocType ?? null,
    },
    badge: {
      isActive: badge?.isActive ?? false,
      isAdminGranted: badge?.isAdminGranted ?? false,
      nextBillingDate: badge?.nextBillingDate ?? null,
      gracePeriodEnd: badge?.gracePeriodEnd ?? null,
      isFeeExempt: badge?.isFeeExempt ?? false,
      feeExemptUntil: badge?.feeExemptUntil ?? null,
    },
    recommendationCount,
    isEligibleForBadge:
      kyc?.emailStatus === KycFieldStatus.VERIFIED &&
      kyc?.phoneStatus === KycFieldStatus.VERIFIED &&
      kyc?.ninStatus === KycFieldStatus.VERIFIED &&
      kyc?.addressStatus === KycFieldStatus.VERIFIED &&
      recommendationCount >= MIN_RECOMMENDATIONS,
  };
};

// ─────────────────────────────────────────────
// VERIFICATION BADGE — ACTIVATION
// ─────────────────────────────────────────────

const activateBadge = async (authId: string) => {
  const kyc = await prisma.kycVerification.findUnique({ where: { authId } });

  if (
    !kyc ||
    kyc.emailStatus !== KycFieldStatus.VERIFIED ||
    kyc.phoneStatus !== KycFieldStatus.VERIFIED ||
    kyc.ninStatus !== KycFieldStatus.VERIFIED ||
    kyc.addressStatus !== KycFieldStatus.VERIFIED
  ) {
    throw new ApiError(
      400,
      "You must complete all KYC verification steps before requesting a badge."
    );
  }

  const recommendationCount = await prisma.recommendation.count({
    where: { receiverId: authId },
  });

  if (recommendationCount < MIN_RECOMMENDATIONS) {
    throw new ApiError(
      400,
      `You need at least ${MIN_RECOMMENDATIONS} recommendations. You currently have ${recommendationCount}.`
    );
  }

  // Check wallet
  const wallet = await prisma.wallet.findUnique({ where: { authId } });
  if (!wallet || wallet.balance < BADGE_FEE) {
    throw new ApiError(
      400,
      `Insufficient wallet balance. ₦${BADGE_FEE.toLocaleString()} required to activate badge.`
    );
  }

  const now = new Date();
  const nextBillingDate = new Date(now);
  nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

  await prisma.$transaction(async (tx) => {
    // Deduct badge fee
    await tx.wallet.update({
      where: { authId },
      data: { balance: { decrement: BADGE_FEE } },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "SPEND",
        amount: BADGE_FEE,
        date: now,
      },
    });

    // Create or activate badge
    await tx.kycVerificationBadge.upsert({
      where: { authId },
      create: {
        authId,
        isActive: true,
        isAdminGranted: false,
        grantedAt: now,
        nextBillingDate,
        lastBilledAt: now,
      },
      update: {
        isActive: true,
        isAdminGranted: false,
        grantedAt: now,
        nextBillingDate,
        lastBilledAt: now,
        revokedAt: null,
        gracePeriodEnd: null,
      },
    });
  });

  await sendNotificationToUser(
    authId,
    "Verification Badge Activated ✅",
    "Your Wisper verification badge is now active. It will be renewed monthly for ₦6,500."
  );

  return { message: "Verification badge activated successfully.", nextBillingDate };
};

// ─────────────────────────────────────────────
// ADMIN — MANAGE BADGE
// ─────────────────────────────────────────────

const adminManageBadge = async (
  targetAuthId: string,
  action: "grant" | "revoke" | "exempt" | "unexempt",
  exemptUntil?: string
) => {
  switch (action) {
    case "grant":
      await prisma.kycVerificationBadge.upsert({
        where: { authId: targetAuthId },
        create: {
          authId: targetAuthId,
          isActive: true,
          isAdminGranted: true,
          grantedAt: new Date(),
          nextBillingDate: null, // admin-granted — no billing
        },
        update: {
          isActive: true,
          isAdminGranted: true,
          grantedAt: new Date(),
          revokedAt: null,
          gracePeriodEnd: null,
        },
      });
      await sendNotificationToUser(
        targetAuthId,
        "Verification Badge Granted ✅",
        "An admin has granted you a Wisper verification badge."
      );
      break;

    case "revoke":
      await prisma.kycVerificationBadge.upsert({
        where: { authId: targetAuthId },
        create: { authId: targetAuthId, isActive: false, revokedAt: new Date() },
        update: { isActive: false, revokedAt: new Date() },
      });
      await sendNotificationToUser(
        targetAuthId,
        "Verification Badge Removed",
        "Your verification badge has been removed by an admin."
      );
      break;

    case "exempt":
      if (!exemptUntil) throw new ApiError(400, "exemptUntil date is required.");
      await prisma.kycVerificationBadge.upsert({
        where: { authId: targetAuthId },
        create: {
          authId: targetAuthId,
          isActive: true,
          isFeeExempt: true,
          feeExemptUntil: new Date(exemptUntil),
        },
        update: {
          isFeeExempt: true,
          feeExemptUntil: new Date(exemptUntil),
        },
      });
      break;

    case "unexempt":
      await prisma.kycVerificationBadge.update({
        where: { authId: targetAuthId },
        data: { isFeeExempt: false, feeExemptUntil: null },
      });
      break;

    default:
      throw new ApiError(400, "Invalid action.");
  }

  return { message: `Badge ${action} applied successfully.` };
};

// ─────────────────────────────────────────────
// MONTHLY BILLING CRON
// ─────────────────────────────────────────────

const runMonthlyBadgeBilling = async () => {
  const now = new Date();

  // 1. Find badges whose grace period has expired → deactivate
  const expiredGrace = await prisma.kycVerificationBadge.findMany({
    where: {
      isActive: true,
      isAdminGranted: false,
      isFeeExempt: false,
      gracePeriodEnd: { lte: now },
    },
  });

  for (const badge of expiredGrace) {
    await prisma.kycVerificationBadge.update({
      where: { id: badge.id },
      data: { isActive: false, revokedAt: now },
    });
    await sendNotificationToUser(
      badge.authId,
      "Verification Badge Removed",
      "Your verification badge has been removed due to non-payment. Fund your wallet and reactivate to restore it."
    );
  }

  // 2. Find badges due for billing today
  const dueBadges = await prisma.kycVerificationBadge.findMany({
    where: {
      isActive: true,
      isAdminGranted: false,
      isFeeExempt: false,
      gracePeriodEnd: null, // not already in grace
      nextBillingDate: { lte: now },
    },
    include: { auth: { include: { wallet: true } } },
  });

  for (const badge of dueBadges) {
    const wallet = badge.auth.wallet;

    // Check exemption expiry
    if (badge.isFeeExempt && badge.feeExemptUntil && badge.feeExemptUntil > now) {
      // Still exempt — push billing date forward one month, skip deduction
      const next = new Date(badge.nextBillingDate!);
      next.setMonth(next.getMonth() + 1);
      await prisma.kycVerificationBadge.update({
        where: { id: badge.id },
        data: { nextBillingDate: next },
      });
      continue;
    }

    // Exemption expired — clear it
    if (badge.isFeeExempt && badge.feeExemptUntil && badge.feeExemptUntil <= now) {
      await prisma.kycVerificationBadge.update({
        where: { id: badge.id },
        data: { isFeeExempt: false, feeExemptUntil: null },
      });
    }

    if (!wallet || wallet.balance < BADGE_FEE) {
      // Insufficient funds — start 10-day grace period
      const gracePeriodEnd = new Date(now);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 10);

      await prisma.kycVerificationBadge.update({
        where: { id: badge.id },
        data: { gracePeriodEnd },
      });

      await sendNotificationToUser(
        badge.authId,
        "Badge Payment Failed ⚠️",
        `We couldn't deduct ₦${BADGE_FEE.toLocaleString()} for your verification badge. Please fund your wallet within 10 days to keep your badge active.`
      );
    } else {
      // Successful deduction
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);

      await prisma.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: BADGE_FEE } },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: "SPEND",
            amount: BADGE_FEE,
            date: now,
          },
        });
        await tx.kycVerificationBadge.update({
          where: { id: badge.id },
          data: { nextBillingDate: next, lastBilledAt: now, gracePeriodEnd: null },
        });
      });
    }
  }

  return {
    deactivated: expiredGrace.length,
    billed: dueBadges.length,
  };
};

// ─────────────────────────────────────────────
// PAY OUTSTANDING BADGE FEE (restores badge)
// ─────────────────────────────────────────────

const payOutstandingBadgeFee = async (authId: string) => {
  const badge = await prisma.kycVerificationBadge.findUnique({ where: { authId } });
  if (!badge) throw new ApiError(404, "No badge record found.");

  // Badge is active — nothing to pay
  if (badge.isActive && !badge.gracePeriodEnd) {
    throw new ApiError(400, "Your badge is already active.");
  }

  const wallet = await prisma.wallet.findUnique({ where: { authId } });
  if (!wallet || wallet.balance < BADGE_FEE) {
    throw new ApiError(
      400,
      `Insufficient wallet balance. ₦${BADGE_FEE.toLocaleString()} required.`
    );
  }

  const now = new Date();
  const next = new Date(now);
  next.setMonth(next.getMonth() + 1);

  await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { authId },
      data: { balance: { decrement: BADGE_FEE } },
    });
    await tx.transaction.create({
      data: { walletId: wallet.id, type: "SPEND", amount: BADGE_FEE, date: now },
    });
    await tx.kycVerificationBadge.update({
      where: { authId },
      data: {
        isActive: true,
        revokedAt: null,
        gracePeriodEnd: null,
        nextBillingDate: next,
        lastBilledAt: now,
      },
    });
  });

  await sendNotificationToUser(
    authId,
    "Verification Badge Restored ✅",
    "Your payment was successful and your verification badge has been restored."
  );

  return { message: "Badge fee paid and badge restored.", nextBillingDate: next };
};

export const kycService = {
  sendEmailOtp,
  verifyEmail,
  sendPhoneOtp,
  verifyPhone,
  verifyNin,
  submitAddress,
  reviewAddress,
  getKycStatus,
  activateBadge,
  adminManageBadge,
  runMonthlyBadgeBilling,
  payOutstandingBadgeFee,
};
