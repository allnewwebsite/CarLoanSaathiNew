import { Router } from "express";
import { getLeadDocuments, uploadDocument, updateDocumentStatus, viewDocument } from "../controllers/document.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { uploadRateLimit } from "../middleware/securityMiddleware.js";
import { upload } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(authenticate);
router.get("/lead/:leadId", getLeadDocuments);
router.get("/:id/view", viewDocument);
router.post("/upload", uploadRateLimit, requireRole(ROLES.FINANCE_DESK), upload.single("document"), uploadDocument);
router.patch("/:id/status", requireRole(ROLES.LOAN_EXECUTIVE), updateDocumentStatus);

export default router;
