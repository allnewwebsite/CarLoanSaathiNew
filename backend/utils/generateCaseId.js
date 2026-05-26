import { firestore } from "../firebase/admin.js";
import { listRecords } from "../services/firestore.service.js";

let memoryLeadCounter = 0;

function formatCaseId(counter) {
  return `CLS-${String(counter).padStart(4, "0")}`;
}

export async function generateLeadCaseId() {
  const counterId = "leads";
  const existingMax = firestore ? 0 : (await listRecords("leads"))
    .map((lead) => String(lead.caseId || ""))
    .map((value) => {
      const match = value.match(/^CLS-(?:\d{4}-)?(\d{4,})$/);
      return match ? Number(match[1]) : NaN;
    })
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);

  if (!firestore) {
    memoryLeadCounter = Math.max(memoryLeadCounter, existingMax);
    memoryLeadCounter += 1;
    return formatCaseId(memoryLeadCounter);
  }

  return firestore.runTransaction(async (transaction) => {
    const counterRef = firestore.collection("systemCounters").doc(counterId);
    const snapshot = await transaction.get(counterRef);
    const data = snapshot.exists ? snapshot.data() : {};
    const current = Number(data?.current || 0);
    const next = Math.max(current, existingMax) + 1;
    transaction.set(counterRef, {
      type: "leads",
      current: next,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return formatCaseId(next);
  });
}
