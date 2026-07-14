import { Router } from "express";
import { bankController } from "./bank.controller";

const router = Router();

// GET /banks/nigeria — returns full list of Nigerian banks from Monnify
router.get("/nigeria", bankController.getNigerianBanks);

export const bankRoutes = router;
