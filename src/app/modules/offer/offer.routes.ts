import { UserRole } from "@prisma/client";
import { Router } from "express";
import authorize from "../../middlewares/authorize";
import { offerController } from "./offer.controller";

const router = Router();

// Create a new offer
router.post(
  "/",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  offerController.create
);

// Get offers for a chat
router.get(
  "/chat/:chatId",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  offerController.getByChatId
);

// Get a single offer
router.get(
  "/:id",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  offerController.getById
);

// Accept an offer
router.patch(
  "/:id/accept",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  offerController.accept
);

// Decline an offer
router.patch(
  "/:id/decline",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  offerController.decline
);

// Pay for an offer
router.post(
  "/:id/pay",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  offerController.pay
);

// Release payment from escrow to seller (buyer confirms job done)
router.post(
  "/:id/release",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  offerController.release
);

// Open dispute
router.post(
  "/:id/dispute",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  offerController.dispute
);

export const offerRoutes = router;
