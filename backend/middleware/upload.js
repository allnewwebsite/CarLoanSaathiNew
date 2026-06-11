import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";

const allowedExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const uploadDir = path.resolve("uploads");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(file.mimetype) && allowedExtensions.has(ext));
  },
});
