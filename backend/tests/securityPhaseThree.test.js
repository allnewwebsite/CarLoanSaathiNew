import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateUploadedFileSignature } from "../middleware/upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

async function validate(contents, mimetype) {
  const target = path.join(root, "uploads", `phase-three-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(target, contents);
  const req = { file: { path: target, mimetype } };
  let response = null;
  let continued = false;
  const res = {
    status(code) {
      response = { code };
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
  };
  await validateUploadedFileSignature(req, res, () => { continued = true; });
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  return { continued, response };
}

test("upload validation accepts matching PDF, JPEG, and PNG signatures", async () => {
  assert.equal((await validate(Buffer.from("%PDF-1.7"), "application/pdf")).continued, true);
  assert.equal((await validate(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).continued, true);
  assert.equal((await validate(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).continued, true);
});

test("upload validation rejects MIME-spoofed content and removes its temporary file", async () => {
  const result = await validate(Buffer.from("<script>alert(1)</script>"), "application/pdf");
  assert.equal(result.continued, false);
  assert.equal(result.response.code, 400);
  assert.equal(result.response.body.code, "INVALID_FILE_CONTENT");
});

test("storage rules require bank managers to match both bank and branch", () => {
  const rules = fs.readFileSync(path.join(root, "storage.rules"), "utf8");
  assert.match(rules, /role\(\) == "bank-manager" && sameBank\(data\) && sameBranch\(data\)/);
  assert.match(rules, /request\.auth\.token\.branchId/);
});

test("document uploads persist branch metadata for Storage authorization", () => {
  const controller = fs.readFileSync(path.join(root, "backend/controllers/document.controller.js"), "utf8");
  const storage = fs.readFileSync(path.join(root, "backend/services/storage.service.js"), "utf8");
  assert.match(controller, /branchId: lead\.branchId \|\| lead\.bankBranchId/);
  assert.match(storage, /branchId: metadata\.branchId \|\| ""/);
  assert.match(storage, /branchCity: metadata\.branchCity \|\| ""/);
});
