import { Router } from "express";
import authorize from "../../middlewares/authorize";
import { UserRole } from "@prisma/client";
import { kycController } from "./kyc.controller";

const router = Router();

// ── Public (authenticated users) ─────────────────────────────────────────

// Status
router.get(
  "/status",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.getStatus
);

// Email verification
router.post(
  "/email/send-otp",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.sendEmailOtp
);
router.post(
  "/email/verify",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.verifyEmail
);

// Phone verification
router.post(
  "/phone/send-otp",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.sendPhoneOtp
);
router.post(
  "/phone/verify",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.verifyPhone
);

// NIN verification
router.post(
  "/nin/verify",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.verifyNin
);

// Address verification
router.post(
  "/address/submit",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.submitAddress
);

// Badge
router.post(
  "/badge/activate",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.activateBadge
);
router.post(
  "/badge/pay-outstanding",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  kycController.payOutstandingFee
);

// ── Admin only ────────────────────────────────────────────────────────────

// Admin: review address submission
router.patch(
  "/admin/address/:userId/review",
  authorize(UserRole.ADMIN),
  kycController.adminReviewAddress
);

// Admin: manage badge (grant/revoke/exempt/unexempt)
router.patch(
  "/admin/badge/:userId",
  authorize(UserRole.ADMIN),
  kycController.adminManageBadge
);

// Admin: trigger monthly billing cron manually
router.post(
  "/admin/billing/run",
  authorize(UserRole.ADMIN),
  kycController.runBilling
);

export const kycRoutes = router;
