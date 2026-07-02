import { Router } from "express";
import { industryController } from "./industry.controller";

const router = Router();

// Public endpoints — no auth required for onboarding
router.get("/search", industryController.search);
router.get("/sectors", industryController.getSectors);

export const industryRoutes = router;
