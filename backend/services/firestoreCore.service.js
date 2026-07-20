import { firestore } from "../firebase/admin.js";
import { assertNonEmptyFirestoreData } from "../utils/firestoreSanitizer.js";
import { assertLeadMutable } from "../utils/deadCase.js";
import { logWarn } from "./logger.service.js";
import { recordFirestoreRead } from "./requestScope.service.js";
import { logRealtimeTicketStep } from "./realtimeTicketLatency.service.js";
import { syncWriteProjections } from "./firestoreProjectionWrite.service.js";
import {
  clearAuthCacheForWrite,
  clearCollectionReadCache,
  DIRECT_ID_ONLY_COLLECTIONS,
  getRequestReadCache,
  hashValue,
  memoryStore,
  readCacheKey,
  readSignature,
  recordWriteMetric,
  resolveDocumentRef,
  setRequestReadCache,
} from "./firestoreShared.service.js";

export async function createRecord(collection, payload) {
  const startedAt = Date.now();
  clearCollectionReadCache(collection);
  clearAuthCacheForWrite(collection, payload?.id);
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const record = {
    id: `${collection}-${Date.now()}`,
    ...(collection === "leads" ? { isDeadCase: false } : {}),
    ...cleanPayload,
    createdAt: new Date().toISOString(),
  };
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    memoryStore[collection].push(record);
    await syncWriteProjections(collection, record);
    recordWriteMetric({ collection, operation: "create", id: record.id, startedAt });
    return record;
  }
  await firestore.collection(collection).doc(record.id).set(record);
  recordWriteMetric({ collection, operation: "create", id: record.id, startedAt });
  await syncWriteProjections(collection, record).catch((error) => {
    logWarn("Projection write skipped after create", { collection, error: error.message });
  });
  return record;
}

export async function getRecord(collection, id) {
  const startedAt = Date.now();
  const cacheKey = readCacheKey(collection, "get", { id });
  const cachedRecord = getRequestReadCache(cacheKey);
  if (cachedRecord !== undefined) {
    logRealtimeTicketStep(`firestore_get_cache:${collection}`, Date.now() - startedAt, { collection, operation: "get", cacheStatus: "request-cache-hit" });
    return cachedRecord;
  }
  if (!firestore) return (memoryStore[collection] || []).find((item) => item.id === id || (collection === "leads" && item.caseId === id)) || null;
  try {
    const directDoc = await firestore.collection(collection).doc(id).get();
    recordFirestoreRead({ collection, operation: "get", signature: readSignature(collection, "get", [["id", hashValue(id)]]), documentsReturned: directDoc.exists ? 1 : 0, estimatedReads: 1 });
    if (directDoc.exists) return setRequestReadCache(cacheKey, { ...directDoc.data(), id: directDoc.id });
    if (DIRECT_ID_ONLY_COLLECTIONS.has(collection)) return setRequestReadCache(cacheKey, null);

    const idSnapshot = await firestore.collection(collection).where("id", "==", id).limit(1).get();
    recordFirestoreRead({ collection, operation: "find", signature: readSignature(collection, "find", [["id", "==", hashValue(id)], ["limit", 1]]), documentsReturned: idSnapshot.size, estimatedReads: idSnapshot.size, limit: 1 });
    if (!idSnapshot.empty) {
      const doc = idSnapshot.docs[0];
      return setRequestReadCache(cacheKey, { id: doc.id, ...doc.data() });
    }

    if (collection === "leads") {
      const caseSnapshot = await firestore.collection(collection).where("caseId", "==", id).limit(1).get();
      recordFirestoreRead({ collection, operation: "find", signature: readSignature(collection, "find", [["caseId", "==", hashValue(id)], ["limit", 1]]), documentsReturned: caseSnapshot.size, estimatedReads: caseSnapshot.size, limit: 1 });
      if (!caseSnapshot.empty) {
        const doc = caseSnapshot.docs[0];
        return setRequestReadCache(cacheKey, { id: doc.id, ...doc.data() });
      }
    }

    return setRequestReadCache(cacheKey, null);
  } finally {
    logRealtimeTicketStep(`firestore_get:${collection}`, Date.now() - startedAt, { collection, operation: "get", firestore: true });
  }
}

export async function getRecordsByIds(collection, ids = []) {
  const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!uniqueIds.length) return [];
  if (!firestore) {
    const wanted = new Set(uniqueIds);
    return (memoryStore[collection] || []).filter((item) => wanted.has(String(item.id || "")));
  }
  const records = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const chunk = uniqueIds.slice(offset, offset + 100);
    const snapshots = await firestore.getAll(...chunk.map((id) => firestore.collection(collection).doc(id)));
    recordFirestoreRead({
      collection,
      operation: "get-all",
      signature: readSignature(collection, "get-all", [["ids", chunk.map(hashValue).sort()]]),
      documentsReturned: snapshots.filter((snapshot) => snapshot.exists).length,
      estimatedReads: snapshots.length,
      limit: chunk.length,
    });
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) records.push({ ...snapshot.data(), id: snapshot.id });
    });
  }
  return records;
}

export async function updateRecord(collection, id, payload, { readback = true, mutationRole = "" } = {}) {
  const startedAt = Date.now();
  clearCollectionReadCache(collection);
  clearAuthCacheForWrite(collection, id);
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const update = { ...cleanPayload, updatedAt: new Date().toISOString() };
  if (!firestore) {
    if (collection === "leads") {
      const existing = (memoryStore[collection] || []).find((item) => item.id === id);
      if (existing) assertLeadMutable(existing, { role: mutationRole });
    }
    let updated = { id, ...update };
    memoryStore[collection] = (memoryStore[collection] || []).map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...update };
      return updated;
    });
    await syncWriteProjections(collection, updated);
    recordWriteMetric({ collection, operation: "update", id, startedAt });
    return updated;
  }
  const ref = await resolveDocumentRef(collection, id);
  let existingRecord = null;
  if (collection === "leads") {
    const existing = await ref.get();
    if (existing.exists) {
      existingRecord = { id: existing.id, ...existing.data() };
      assertLeadMutable(existingRecord, { role: mutationRole });
    }
  }
  await ref.update(update);
  recordWriteMetric({ collection, operation: "update", id, startedAt });
  if (!readback) return { id, ...update };
  if (existingRecord) {
    const record = { ...existingRecord, ...update, id: existingRecord.id };
    await syncWriteProjections(collection, record).catch((error) => {
      logWarn("Projection write skipped after update", { collection, id, error: error.message });
    });
    return record;
  }
  const doc = await ref.get();
  recordFirestoreRead({ collection, operation: "update-readback", signature: readSignature(collection, "update-readback", [["id", hashValue(id)]]), documentsReturned: doc.exists ? 1 : 0, estimatedReads: 1 });
  const record = { ...doc.data(), id: doc.id };
  await syncWriteProjections(collection, record).catch((error) => {
    logWarn("Projection write skipped after update", { collection, id, error: error.message });
  });
  return record;
}

export async function upsertRecord(collection, id, payload, { readback = true } = {}) {
  const startedAt = Date.now();
  clearCollectionReadCache(collection);
  clearAuthCacheForWrite(collection, id);
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const update = { ...cleanPayload, updatedAt: new Date().toISOString() };
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    if (index >= 0) {
      if (collection === "leads") assertLeadMutable(memoryStore[collection][index]);
      memoryStore[collection][index] = { ...memoryStore[collection][index], ...update };
      await syncWriteProjections(collection, memoryStore[collection][index]);
      recordWriteMetric({ collection, operation: "upsert", id, startedAt });
      return memoryStore[collection][index];
    }
    const record = { id, ...update, createdAt: new Date().toISOString() };
    memoryStore[collection].push(record);
    await syncWriteProjections(collection, record);
    recordWriteMetric({ collection, operation: "upsert", id, startedAt });
    return record;
  }
  let existingRecord = null;
  if (collection === "leads") {
    const existing = await firestore.collection(collection).doc(id).get();
    if (existing.exists) {
      existingRecord = { id: existing.id, ...existing.data() };
      assertLeadMutable(existingRecord);
    }
  }
  await firestore.collection(collection).doc(id).set(update, { merge: true });
  recordWriteMetric({ collection, operation: "upsert", id, startedAt });
  if (!readback) return { id, ...update };
  if (existingRecord) {
    const record = { ...existingRecord, ...update, id };
    await syncWriteProjections(collection, record).catch((error) => {
      logWarn("Projection write skipped after upsert", { collection, id, error: error.message });
    });
    return record;
  }
  const doc = await firestore.collection(collection).doc(id).get();
  recordFirestoreRead({ collection, operation: "upsert-readback", signature: readSignature(collection, "upsert-readback", [["id", hashValue(id)]]), documentsReturned: doc.exists ? 1 : 0, estimatedReads: 1 });
  const record = { id: doc.id, ...doc.data() };
  await syncWriteProjections(collection, record).catch((error) => {
    logWarn("Projection write skipped after upsert", { collection, id, error: error.message });
  });
  return record;
}

export async function incrementRecord(collection, id, increments = {}, base = {}) {
  const startedAt = Date.now();
  const now = new Date().toISOString();
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    const current = index >= 0 ? memoryStore[collection][index] : { id, ...base, createdAt: now };
    const next = { ...current, ...base, updatedAt: now };
    for (const [key, value] of Object.entries(increments)) {
      next[key] = Number(next[key] || 0) + Number(value || 0);
    }
    if (index >= 0) memoryStore[collection][index] = next;
    else memoryStore[collection].push(next);
    recordWriteMetric({ collection, operation: "increment", id, startedAt });
    return next;
  }
  const { FieldValue } = await import("firebase-admin/firestore");
  const update = { ...base, updatedAt: now };
  for (const [key, value] of Object.entries(increments)) {
    update[key] = FieldValue.increment(Number(value || 0));
  }
  await firestore.collection(collection).doc(id).set(update, { merge: true });
  recordWriteMetric({ collection, operation: "increment", id, startedAt });
  const doc = await firestore.collection(collection).doc(id).get();
  return { id: doc.id, ...doc.data() };
}

export async function bulkUpsertRecords(collection, records = []) {
  const startedAt = Date.now();
  const rows = records.filter((record) => record?.id);
  if (!rows.length) return 0;
  clearCollectionReadCache(collection);
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const byId = new Map(memoryStore[collection].map((record) => [record.id, record]));
    for (const record of rows) {
      byId.set(record.id, {
        ...(byId.get(record.id) || {}),
        ...record,
        updatedAt: record.updatedAt || new Date().toISOString(),
      });
    }
    memoryStore[collection] = [...byId.values()];
    recordWriteMetric({ collection, operation: "bulk-upsert", documentsWritten: rows.length, startedAt });
    return rows.length;
  }
  const writer = firestore.bulkWriter();
  for (const record of rows) {
    const { id, ...payload } = assertNonEmptyFirestoreData(record);
    writer.set(firestore.collection(collection).doc(id), payload, { merge: true });
  }
  await writer.close();
  recordWriteMetric({ collection, operation: "bulk-upsert", documentsWritten: rows.length, startedAt });
  return rows.length;
}

export async function deleteRecord(collection, id) {
  const startedAt = Date.now();
  if (!firestore) {
    memoryStore[collection] = (memoryStore[collection] || []).filter((item) => item.id !== id);
    recordWriteMetric({ collection, operation: "delete", id, startedAt });
    return true;
  }
  const ref = await resolveDocumentRef(collection, id);
  await ref.delete();
  recordWriteMetric({ collection, operation: "delete", id, startedAt });
  return true;
}

export async function deleteRecordsByIds(collection, ids = []) {
  const startedAt = Date.now();
  const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!uniqueIds.length) return 0;
  if (!firestore) {
    const before = (memoryStore[collection] || []).length;
    memoryStore[collection] = (memoryStore[collection] || []).filter((item) => !uniqueIds.includes(String(item.id || "")));
    return before - memoryStore[collection].length;
  }
  const writer = firestore.bulkWriter();
  uniqueIds.forEach((id) => writer.delete(firestore.collection(collection).doc(id)));
  await writer.close();
  recordWriteMetric({ collection, operation: "bulk-delete", documentsWritten: uniqueIds.length, startedAt });
  return uniqueIds.length;
}

