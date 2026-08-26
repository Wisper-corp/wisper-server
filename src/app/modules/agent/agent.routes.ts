import { Router } from "express";
import { UserRole } from "@prisma/client";
import authorize from "../../middlewares/authorize";
import { agentController } from "./agent.controller";

const router = Router();

// Every route is admin-only: seeding creates real accounts and posts.
router.post("/seed", authorize(UserRole.ADMIN), agentController.seedAgents);
router.post("/run/:groupId", authorize(UserRole.ADMIN), agentController.runNow);
router.get("/group/:groupId", authorize(UserRole.ADMIN), agentController.listAgents);
router.get("/activity/:groupId", authorize(UserRole.ADMIN), agentController.activityLog);
router.patch("/:id/pause", authorize(UserRole.ADMIN), agentController.setPaused);
router.delete("/group/:groupId", authorize(UserRole.ADMIN), agentController.removeAgents);

export const agentRoutes = router;
