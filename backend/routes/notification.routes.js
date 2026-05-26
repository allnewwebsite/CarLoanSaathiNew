import { Router } from "express";
import { listNotifications, processWhatsAppQueueNow, readNotification } from "../controllers/notification.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(authenticate);
router.get("/", listNotifications);
router.patch("/:id/read", readNotification);
router.post("/whatsapp/process", requireRole(ROLES.SUPER_ADMIN), processWhatsAppQueueNow);

export default router;
