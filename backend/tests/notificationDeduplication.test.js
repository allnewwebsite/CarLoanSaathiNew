import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const notification = fs.readFileSync(new URL("../services/notification.service.js", import.meta.url), "utf8");
const whatsapp = fs.readFileSync(new URL("../services/whatsappQueue.service.js", import.meta.url), "utf8");
const templates = fs.readFileSync(new URL("../services/notificationTemplates.service.js", import.meta.url), "utf8");

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
