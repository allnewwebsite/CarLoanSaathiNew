import fs from "fs";
import path from "path";
import { storage } from "../firebase/admin.js";

export async function uploadLeadDocument(file, leadId, metadata = {}) {
  if (!file) return null;

  if (!storage) {
    return {
      url: `/uploads/${file.filename}`,
      storagePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  const safeName = path.basename(file.filename || file.originalname).replace(/[^a-zA-Z0-9._-]/g, "-");
  const folderLeadId = String(metadata.caseId || leadId).replace(/[^a-zA-Z0-9._-]/g, "-");
  const destination = `documents/leads/${folderLeadId}/${safeName}`;
  await storage.upload(file.path, {
    destination,
    metadata: {
      contentType: file.mimetype,
      metadata: {
        leadId,
        dealershipId: metadata.dealershipId || "",
        bankId: metadata.bankId || "",
        assignedExecutiveId: metadata.assignedExecutiveId || "",
        assignedExecutiveEmail: metadata.assignedExecutiveEmail || "",
        uploadedBy: metadata.uploadedBy || "",
      },
    },
  });

  fs.rm(file.path, { force: true }, () => {});
  return {
    url: null,
    storagePath: destination,
    originalName: path.basename(file.originalname),
    mimeType: file.mimetype,
    size: file.size,
  };
}

export async function createShortLivedDocumentUrl(storagePath) {
  if (!storagePath || !storage) return null;
  const [url] = await storage.file(storagePath).getSignedUrl({
    action: "read",
    expires: Date.now() + 5 * 60 * 1000,
  });
  return url;
}

export async function deleteLeadDocument(storagePath) {
  if (!storagePath) return false;

  if (!storage) {
    if (fs.existsSync(storagePath)) fs.rmSync(storagePath, { force: true });
    return true;
  }

  const file = storage.file(storagePath);
  await file.delete({ ignoreNotFound: true });
  return true;
}
