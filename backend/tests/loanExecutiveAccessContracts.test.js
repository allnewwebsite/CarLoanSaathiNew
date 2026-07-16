import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bankManagerCanAccessLead,
  executiveStrongIdentityValues,
  leadExecutiveStrongIdentityValues,
  loanExecutiveCanAccessLead,
} from "../controllers/bankAccessShared.controller.js";
import { loanExecutiveMatchesLead } from "../services/roleIdentity.service.js";

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

test("loan executive dashboard identity includes auth uid and employee aliases", () => {
  const lead = {
    bankId: "bank-a",
    assignedExecutiveId: "LE-042",
    assignedExecutiveJobId: "vikas",
    assignedExecutiveName: "Vikas",
  };
  const executive = {
    uid: "firebase-uid-vikas",
    email: "vikas@example.com",
    employeeId: "LE-042",
    jobId: "vikas",
    bankId: "bank-a",
    name: "Vikas",
  };
  const bankAccessShared = read("backend/controllers/bankAccessShared.controller.js");

  assert.equal(executiveStrongIdentityValues(executive).includes("LE-042"), true);
  assert.equal(leadExecutiveStrongIdentityValues(lead).includes("LE-042"), true);
  assert.equal(leadExecutiveStrongIdentityValues(lead).includes("vikas"), true);
  assert.equal(loanExecutiveCanAccessLead(executive, lead), true);
  assert.equal(bankAccessShared.includes("firstRecordByIdentity(\"loanExecutives\""), true);
  assert.equal(bankAccessShared.includes("[\"email\", \"officialEmail\", \"uid\", \"authUid\", \"employeeId\", \"employeeCode\", \"jobId\"]"), true);
  assert.equal(bankAccessShared.includes("employeeId: executive?.employeeId || account.employeeId || req.user?.employeeId"), true);
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
    "bankScopedLeadCandidates",
    "const [projected, canonical, bankCandidates] = await Promise.all([",
    "...(projected?.data || [])",
    "...(canonical?.data || [])",
    "...bankCandidates",
    "const merged = [...byId.values()]",
    "query: projectionQuery",
    "query: baseQuery",
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
    "executiveIdentityValues(user)",
    "field: \"scopeId\", op: \"in\"",
    "scopeId(user.email || user.uid || user.mobile)",
  ].forEach((snippet) => assert.equal(projectionLead.includes(snippet), true, `projectionLead missing ${snippet}`));

  assert.equal(projectionShared.includes("\"executiveMobile\""), true, "projection view fields missing executiveMobile");
});

test("loan executive secondary paths enrich identity and do not trust partial projections alone", () => {
  const leadController = read("backend/controllers/lead.controller.js");
  const dashboardController = read("backend/controllers/dashboard.controller.js");
  const deadCaseController = read("backend/controllers/deadCase.controller.js");
  const documentController = read("backend/controllers/document.controller.js");
  const bankExecutiveController = read("backend/controllers/bankExecutive.controller.js");
  const timelineService = read("backend/services/timeline.service.js");
  const notificationService = read("backend/services/notification.service.js");
  const leadQuery = read("backend/services/leadQuery.service.js");

  [
    "async function loanExecutiveActor",
    "getRecord(\"loanExecutives\", email)",
    "executiveQueryArgs(actor)",
    "loanExecutiveMatchesLead(actor, lead)",
  ].forEach((snippet) => assert.equal(leadController.includes(snippet), true, `lead controller missing ${snippet}`));

  [
    "async function loanExecutiveActor",
    "executiveQueryArgs(actor)",
    "source: \"projection+canonical\"",
  ].forEach((snippet) => assert.equal(dashboardController.includes(snippet), true, `dashboard controller missing ${snippet}`));

  [
    "async function loanExecutiveActor",
    "executiveIdentityValues(actor)",
    "executiveNameValues(actor)",
  ].forEach((snippet) => assert.equal(deadCaseController.includes(snippet), true, `dead case controller missing ${snippet}`));

  assert.equal(documentController.includes("loanExecutiveMatchesLead({ ...req.user, ...executive }, lead)"), true);
  assert.equal(documentController.includes("lead?.isDeadCase === true && req.user?.role !== \"finance-desk\""), false);

  [
    "executiveQueryArgs(executiveActor)",
    "loanExecutiveMatchesLead(executiveActor, lead)",
    "...(projected?.data || [])",
  ].forEach((snippet) => assert.equal(bankExecutiveController.includes(snippet), true, `bank executive controller missing ${snippet}`));

  [
    "async function timelineActor",
    "loanExecutiveMatchesLead(scopedActor, lead || {})",
    "actor: scopedActor",
  ].forEach((snippet) => assert.equal(timelineService.includes(snippet), true, `timeline service missing ${snippet}`));

  [
    "executiveIdentityValues(actor)",
    "item.meta?.assignedExecutiveMobile",
  ].forEach((snippet) => assert.equal(notificationService.includes(snippet), true, `notification service missing ${snippet}`));

  [
    "executiveIdentityValues = []",
    "executiveNameIdentities",
    "lead.assignedExecutiveMobile",
    "lead.executiveMobile",
    "lead.assignedExecutiveName",
  ].forEach((snippet) => assert.equal(leadQuery.includes(snippet), true, `lead query missing ${snippet}`));
});

test("bank loan executive lead list does not hide assigned leads with alternate bank fields", () => {
  const bankShared = read("backend/controllers/bankShared.controller.js");
  const bankAccessShared = read("backend/controllers/bankAccessShared.controller.js");

  assert.equal(bankShared.includes("const baseQuery = {"), true);
  assert.equal(bankShared.includes("query: baseQuery"), true);
  assert.equal(bankShared.includes("query: scopedQuery"), false);
  assert.equal(bankShared.includes("async function bankScopedLeadCandidates"), true);
  assert.equal(bankShared.includes("assignedExecutiveName\", \"assignedExecutiveEmail"), true);
  assert.equal(bankShared.includes("...bankCandidates"), true);
  assert.equal(bankShared.includes(".filter((lead) => loanExecutiveCanAccessLead(partner, lead))"), true);
  assert.equal(bankAccessShared.includes("const nameMatch = anyMatch([lead.assignedExecutiveName], executiveNameValues(partner));"), true);
  assert.equal(bankAccessShared.includes("return anyMatch(leadBankValues(lead), partnerBankValues(partner));"), true);
});

test("loan executive reassignment atomically replaces every previous executive projection scope", () => {
  const assignmentService = read("backend/services/assignment.service.js");

  [
    "lead.assignedExecutiveId",
    "lead.assignedExecutiveEmail",
    "lead.assignedExecutiveMobile",
    "lead.executiveMobile",
    "const previousPlan = leadOwnershipProjectionPlan(latestLead)",
    "previousPlan.executiveDocIds",
    "transaction.delete(\"executiveViews\", docId)",
    "nextPlan.writes.forEach((write) => transaction.set",
    "ownerId: executive.id",
  ].forEach((snippet) => assert.equal(assignmentService.includes(snippet), true, `assignment service missing ${snippet}`));
});

test("canonical case ownership overrides stale legacy executive aliases", () => {
  const canonicalLead = {
    assignedExecutiveId: "new-owner",
    assignedExecutiveEmail: "new@example.com",
    assignedExecutiveMobile: "9999999999",
    assignedExecutiveName: "New Owner",
    updatedByExecutiveId: "old-owner",
    executiveEmail: "old@example.com",
    loanExecutiveId: "old-owner",
  };
  assert.equal(loanExecutiveMatchesLead({ id: "old-owner", email: "old@example.com" }, canonicalLead), false);
  assert.equal(loanExecutiveMatchesLead({ id: "new-owner", email: "new@example.com" }, canonicalLead), true);
  assert.equal(loanExecutiveCanAccessLead({ id: "old-owner", email: "old@example.com" }, canonicalLead), false);
  assert.equal(loanExecutiveCanAccessLead({ id: "new-owner", email: "new@example.com" }, canonicalLead), true);
});

test("bank manager total leads include legacy bank-scoped rows without branch metadata", () => {
  const bankShared = read("backend/controllers/bankShared.controller.js");
  const bankAccessShared = read("backend/controllers/bankAccessShared.controller.js");
  const manager = {
    bankId: "UCBA0002429",
    bankName: "UCO Bank",
    ifscCode: "UCBA0002429",
    branchId: "BRANCH-A",
    roleType: "bank-manager",
  };

  assert.equal(bankManagerCanAccessLead(manager, { assignedBankName: "UCO Bank", caseId: "CLS-0001" }), true);
  assert.equal(bankManagerCanAccessLead(manager, { assignedBankName: "UCO Bank", branchId: "BRANCH-A" }), true);
  assert.equal(bankManagerCanAccessLead(manager, { assignedBankName: "UCO Bank", branchId: "BRANCH-B" }), false);
  [
    "const [projected, canonical, bankCandidates] = await Promise.all([",
    "queryLeadProjectionForUser({",
    "queryBankLeads({ bankId: identity.bankId, query: baseQuery, fields })",
    "bankScopedLeadCandidates(partner, baseQuery, fields)",
    "...(projected?.data || [])",
    "...(canonical?.data || [])",
    "...bankCandidates",
    ".filter((lead) => partnerCanAccessLead(partner, lead))",
  ].forEach((snippet) => assert.equal(bankShared.includes(snippet), true, `bankShared missing ${snippet}`));
  assert.equal(bankAccessShared.includes("return sameBank && (!hasLeadBranchScope || sameBranch)"), true);
  assert.equal(bankAccessShared.includes("bankProfileForContext(manager || {}, account, req.user || {})"), true);
  assert.equal(bankAccessShared.includes("bankName: profile.bankName || profile.companyName || bankProfile.bankName"), true);
  assert.equal(bankAccessShared.includes("ifscCode: profile.ifscCode || profile.bankIfsc || profile.ifsc"), true);
});
