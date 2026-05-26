import { Router } from "express";
import { getOverview } from "../controllers/dashboard.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/overview", authenticate, getOverview);

export default router;
