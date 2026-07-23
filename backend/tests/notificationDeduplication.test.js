import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const notification = fs.readFileSync(new URL("../services/notification.service.js", import.meta.url), "utf8");
const whatsapp = fs.readFileSync(new URL("../services/whatsappQueue.service.js", import.meta.url), "utf8");
const templates = fs.readFileSync(new URL("../services/notificationTemplates.service.js", import.meta.url), "utf8");
const bankWorkflow = fs.readFileSync(new URL("../controllers/bankLeadWorkflow.controller.js", import.meta.url), "utf8");
const dealerLead = fs.readFileSync(new URL("../controllers/dealerLead.controller.js", import.meta.url), "utf8");

test("notification creation atomically gates all SSE, log and delivery side effects", () => {
  assert.match(notification, /runRecordTransaction/);
  assert.match(notification, /if \(!creation\.created\)[\s\S]*return creation\.notification/);
  assert.ok(notification.indexOf("if (!creation.created)") < notification.indexOf("publishRealtimeEvent({"));
});

test("WhatsApp queue creation and worker claims are transactionally deduplicated", () => {
  assert.match(whatsapp, /if \(!creation\.created\)[\s\S]*deduped: true/);
  assert.match(whatsapp, /const claimed = await runRecordTransaction/);
  assert.match(whatsapp, /status: "skipped-claimed"/);
});

test("business event aliases share concise canonical notification templates", () => {
  assert.match(templates, /canonicalNotificationType/);
  assert.match(templates, /title: "New case assigned"/);
  assert.match(templates, /title: "Customer documents uploaded"/);
  assert.match(templates, /title: "Loan disbursed successfully"/);
  assert.match(templates, /title: "Password changed"/);
});

test("one business event owns one notification record across portal scopes", () => {
  assert.match(notification, /eventId: resolvedEventId/);
  assert.match(notification, /notificationEventVersion/);
  assert.doesNotMatch(notification.match(/function notificationDedupeId[\s\S]*?\n}/)?.[0] || "", /recipientRole|recipientId/);
  const statusTransition = fs.readFileSync(new URL("../services/leadStatusTransition.service.js", import.meta.url), "utf8");
  assert.equal((bankWorkflow.match(/createNotification\(\{/g) || []).length, 0);
  assert.equal((statusTransition.match(/createNotification\(\{/g) || []).length, 1);
  assert.doesNotMatch(bankWorkflow, /status-changed-bank-manager|status-changed-gm/);
  assert.doesNotMatch(dealerLead, /finance-lead-created-bank-manager/);
});

test("notification retries reuse the original event id and side effects follow the atomic create gate", () => {
  const worker = fs.readFileSync(new URL("../services/notificationWorker.service.js", import.meta.url), "utf8");
  assert.match(worker, /eventId: event\.eventId/);
  assert.ok(notification.indexOf("if (!creation.created)") < notification.indexOf("publishRealtimeEvent({"));
  assert.ok(notification.indexOf("if (!creation.created)") < notification.indexOf("queueWhatsAppNotification({"));
});
