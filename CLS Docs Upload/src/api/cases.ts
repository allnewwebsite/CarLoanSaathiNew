import { api } from "./client";
import { Lead, responseData } from "../types";

export async function listCases(params: { search?: string; status?: string; cursor?: string; limit?: number } = {}) {
  const { search, cursor, limit = 25 } = params;
  const query: Record<string, string | number> = { limit };
  if (search) query.search = search;
  if (cursor) query.cursor = cursor;
  const { data } = await api.get("/dealer/leads", { params: query });
  const raw = data?.data && Array.isArray(data.data) ? data : responseData<any>(data);
  const rows = Array.isArray(raw) ? raw : raw?.data || raw?.items || raw?.leads || [];
  return { items: rows as Lead[], nextCursor: Array.isArray(raw) ? null : raw?.nextCursor || null, hasMore: Boolean(!Array.isArray(raw) && (raw?.hasMore || raw?.nextCursor)) };
}

export async function getCase(id: string) { const { data } = await api.get(`/dealer/leads/${encodeURIComponent(id)}`); return responseData<Lead>(data); }
