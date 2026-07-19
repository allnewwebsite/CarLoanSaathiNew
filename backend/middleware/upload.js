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

export function discardUploadedFile(file) {
  if (!file?.path) return;
  fs.rm(file.path, { force: true }, () => {});
}

function hasValidSignature(buffer, mimetype) {
  if (mimetype === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimetype === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}

export async function validateUploadedFileSignature(req, res, next) {
  if (!req.file?.path) return next();
  try {
    const handle = await fs.promises.open(req.file.path, "r");
    const header = Buffer.alloc(8);
    try {
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (hasValidSignature(header.subarray(0, bytesRead), req.file.mimetype)) return next();
    } finally {
      await handle.close();
    }
  } catch {
    // Treat unreadable temporary files as invalid uploads.
  }
  discardUploadedFile(req.file);
  return res.status(400).json({ message: "File content does not match an allowed PDF or image format", code: "INVALID_FILE_CONTENT" });
}
