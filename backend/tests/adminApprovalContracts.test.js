import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}

test("admin approval controller imports shared helpers used by all action paths", () => {
  const source = read("backend/controllers/adminApprovals.controller.js");
  [
    "firstAdminLookup",
    "stripRemovedDealershipFields",
    "approveDealershipApproval",
    "rejectDealershipApproval",
    "suspendDealershipApproval",
    "approveBankApproval",
    "rejectBankApproval",
    "suspendBankApproval",
  ].forEach((snippet) => assert.equal(source.includes(snippet), true, `Missing ${snippet}`));
});
