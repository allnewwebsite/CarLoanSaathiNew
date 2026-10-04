import { api } from "./client";
import { DocumentRecord, PickedFile, responseData } from "../types";

export async function listDocuments(leadId: string) {
  const { data } = await api.get(`/documents/lead/${encodeURIComponent(leadId)}`);
  const rows = responseData<any>(data);
  return (Array.isArray(rows) ? rows : rows?.data || rows?.documents || []) as DocumentRecord[];
}

export async function uploadDocument(leadId: string, type: string, file: PickedFile, idempotencyKey: string, onProgress: (progress: number) => void) {
  const form = new FormData();
  form.append("leadId", leadId);
  form.append("type", type);
  form.append("document", { uri: file.uri, name: file.name, type: file.type } as any);
  const { data } = await api.post("/documents/upload", form, { headers: { "Content-Type": "multipart/form-data", "Idempotency-Key": idempotencyKey }, onUploadProgress: (event) => { if (event.total) onProgress(Math.min(1, event.loaded / event.total)); } });
  return responseData<DocumentRecord>(data);
}
