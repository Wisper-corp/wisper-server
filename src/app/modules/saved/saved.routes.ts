import { Router } from "express";
import { UserRole } from "@prisma/client";
import authorize from "../../middlewares/authorize";
import { savedController } from "./saved.controller";

const router = Router();

router.get(
  "/",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  savedController.getSavedItems
);

// One route in both directions: saving an already-saved post unsaves it.
router.patch(
  "/:kind/:id",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  savedController.toggleSaved
);

export const savedRoutes = router;
