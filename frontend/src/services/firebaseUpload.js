import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "./firebaseStorage.js";

export function uploadStorageFile({ file, storagePath, contentType, onProgress }) {
  const storageRef = ref(storage, storagePath);
  const task = uploadBytesResumable(storageRef, file, contentType ? { contentType } : undefined);
  return new Promise((resolve, reject) => {
    task.on("state_changed", (snapshot) => {
      const total = snapshot.totalBytes || file.size || 1;
      const progress = Math.round((snapshot.bytesTransferred / total) * 100);
      onProgress?.(progress);
    }, reject, async () => {
      const fileUrl = await getDownloadURL(task.snapshot.ref);
      resolve({ fileUrl, storagePath });
    });
  });
}

export async function deleteStoragePath(storagePath) {
  if (!storagePath) return;
  await deleteObject(ref(storage, storagePath));
}
