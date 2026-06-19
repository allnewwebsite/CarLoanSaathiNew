import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  executiveStrongIdentityValues,
  leadExecutiveStrongIdentityValues,
  loanExecutiveCanAccessLead,
} from "../controllers/bankAccessShared.controller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}

test("loan executive lead access matches strong individual identities without bank-level leakage", () => {
  const lead = {
    bankId: "bank-a",
    branchId: "branch-a",
    assignedExecutiveName: "Vikas",
    assignedExecutiveMobile: "7854127844",
  };
  const executive = {
    id: "firebase-uid-vikas",
    email: "vikas@gmail.com",
    mobile: "+91 7854127844",
    bankId: "bank-a",
    branchId: "branch-a",
    name: "Vikas",
  };
  const otherExecutive = {
    id: "firebase-uid-other",
    email: "other@gmail.com",
    mobile: "+91 7854127800",
    bankId: "bank-a",
    branchId: "branch-a",
    name: "Other",
  };

  assert.equal(leadExecutiveStrongIdentityValues(lead).includes("7854127844"), true);
  assert.equal(executiveStrongIdentityValues(executive).includes("7854127844"), true);
  assert.equal(loanExecutiveCanAccessLead(executive, lead), true);
  assert.equal(loanExecutiveCanAccessLead(otherExecutive, lead), false);
});

test("loan executive list and projection contracts include id, email, and mobile assignment paths", () => {
  const bankShared = read("backend/controllers/bankShared.controller.js");
  const leadQuery = read("backend/services/leadQuery.service.js");
  const projectionLead = read("backend/services/projectionLead.service.js");
  const projectionShared = read("backend/services/projectionShared.service.js");

  [
    "Promise.all([",
    "queryExecutiveLeads({",
    "executiveNames",
    "const [projected, canonical] = await Promise.all([",
    "...(projected?.data || [])",
    "...(canonical?.data || [])",
    "const merged = [...byId.values()]",
    "query: scopedQuery",
    "bankId: query.bankId || partner.bankId || partner.bankPartnerId || undefined",
    "executiveStrongIdentityValues(partner)",
    "executiveMobile",
    "loanExecutiveCanAccessLead(partner, lead)",
    "{ field: \"executiveMobile\", value: mobile }",
  ].forEach((snippet) => assert.equal(bankShared.includes(snippet), true, `bankShared missing ${snippet}`));

  [
    "assignedExecutiveMobile",
    "executiveMobile",
    "executiveIdentities",
    "assignedExecutiveName",
  ].forEach((snippet) => assert.equal(leadQuery.includes(snippet), true, `leadQuery missing ${snippet}`));

  [
    "lead.assignedExecutiveMobile",
    "lead.executiveMobile",
    "scopeId(user.email || user.uid || user.mobile)",
  ].forEach((snippet) => assert.equal(projectionLead.includes(snippet), true, `projectionLead missing ${snippet}`));

  assert.equal(projectionShared.includes("\"executiveMobile\""), true, "projection view fields missing executiveMobile");
});
