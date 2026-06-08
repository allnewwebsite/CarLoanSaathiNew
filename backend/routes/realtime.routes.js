import { Router } from "express";
import { createRealtimeConnectionTicket, getRealtimeStats, streamRealtimeEvents } from "../controllers/realtime.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.post("/ticket", authenticate, createRealtimeConnectionTicket);
router.get("/events", streamRealtimeEvents);
router.get("/stats", authenticate, requireRole(ROLES.SUPER_ADMIN), getRealtimeStats);

export default router;
