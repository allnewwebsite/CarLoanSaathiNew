import { firestore } from "../firebase/admin.js";
import { assertNonEmptyFirestoreData } from "../utils/firestoreSanitizer.js";
import {
  createRecord,
  deleteRecord,
  getRecord,
  updateRecord,
  upsertRecord,
} from "./firestoreCore.service.js";

export async function runRecordTransaction(handler) {
  if (!firestore) return handler({
    get: getRecord,
    set: upsertRecord,
    update: updateRecord,
    create: createRecord,
    delete: deleteRecord,
  });
  const { FieldValue } = await import("firebase-admin/firestore");
  return firestore.runTransaction(async (transaction) => {
    const read = async (collection, id) => {
      const ref = firestore.collection(collection).doc(id);
      const doc = await transaction.get(ref);
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    };
    const write = (collection, id, payload, { merge = true } = {}) => {
      const ref = firestore.collection(collection).doc(id);
      transaction.set(ref, assertNonEmptyFirestoreData({ id, ...payload }), { merge });
    };
    const patch = (collection, id, payload) => {
      const ref = firestore.collection(collection).doc(id);
      transaction.update(ref, assertNonEmptyFirestoreData(payload));
    };
    const remove = (collection, id) => {
      const ref = firestore.collection(collection).doc(id);
      transaction.delete(ref);
    };
    return handler({
      get: read,
      set: write,
      update: patch,
      delete: remove,
      serverTimestamp: FieldValue.serverTimestamp,
    });
  });
}
