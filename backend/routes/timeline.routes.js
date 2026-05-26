import { Router } from "express";
import { getLeadTimeline, searchTimeline } from "../controllers/timeline.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.use(authenticate);
router.get("/", searchTimeline);
router.get("/leads/:leadId", getLeadTimeline);

export default router;
