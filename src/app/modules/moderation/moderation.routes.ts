import { Router } from "express";
import { UserRole } from "@prisma/client";
import authorize from "../../middlewares/authorize";
import { moderationController } from "./moderation.controller";

const router = Router();

// Admin-only: this is the review desk, not a member-facing surface.
router.post("/moderator", authorize(UserRole.ADMIN), moderationController.appointModerator);
router.get("/log/:groupId", authorize(UserRole.ADMIN), moderationController.log);
router.get("/flagged/:groupId", authorize(UserRole.ADMIN), moderationController.flagged);
router.patch("/verdict/:id", authorize(UserRole.ADMIN), moderationController.resolve);
router.get("/suspensions/:groupId", authorize(UserRole.ADMIN), moderationController.suspensions);
router.delete("/suspensions/:id", authorize(UserRole.ADMIN), moderationController.liftSuspension);

export const moderationRoutes = router;
