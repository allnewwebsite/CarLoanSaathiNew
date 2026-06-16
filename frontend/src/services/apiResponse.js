export const EMPTY_PAGED_RESPONSE = Object.freeze({
  data: [],
  total: 0,
  limit: 0,
  nextCursor: null,
  hasMore: false,
  meta: {},
  raw: null,
});

function payloadFromResponse(responseOrPayload) {
  if (!responseOrPayload || typeof responseOrPayload !== "object") return responseOrPayload;
  const looksLikePagedPayload = "data" in responseOrPayload
    && (
      "total" in responseOrPayload
      || "limit" in responseOrPayload
      || "nextCursor" in responseOrPayload
      || "hasMore" in responseOrPayload
      || "pagination" in responseOrPayload
    );
  if (!looksLikePagedPayload && "data" in responseOrPayload) {
    return responseOrPayload.data;
  }
  return responseOrPayload;
}

function nestedData(payload) {
  if (payload?.success === true && payload.data !== undefined) return payload.data;
  return payload;
}

export function normalizeRows(responseOrPayload) {
  const payload = payloadFromResponse(responseOrPayload);
  const data = nestedData(payload);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function normalizeRecord(responseOrPayload, fallback = null) {
  const payload = payloadFromResponse(responseOrPayload);
  const data = nestedData(payload);
  if (data && typeof data === "object" && !Array.isArray(data)) return data;
  return fallback;
}

export function normalizePagedResponse(responseOrPayload, { defaultLimit = 0 } = {}) {
  const payload = payloadFromResponse(responseOrPayload);
  const data = nestedData(payload);
  const rows = normalizeRows(responseOrPayload);
  const pagination = payload?.pagination || data?.pagination || {};
  const total = Number.isFinite(Number(data?.total))
    ? Number(data.total)
    : Number.isFinite(Number(pagination?.total))
      ? Number(pagination.total)
      : rows.length;
  const nextCursor = data?.nextCursor || pagination?.nextCursor || null;
  return {
    ...EMPTY_PAGED_RESPONSE,
    data: rows,
    total,
    limit: Number(data?.limit || pagination?.limit || defaultLimit || 0),
    nextCursor,
    hasMore: Boolean(data?.hasMore || pagination?.hasMore || nextCursor),
    meta: payload?.meta || data?.meta || {},
    raw: payload || null,
  };
}

export function normalizeApiError(error, fallback = "Unexpected request error") {
  const payload = error?.response?.data || {};
  return {
    status: error?.response?.status || 0,
    code: payload.code || payload.errorCode || error?.code || "",
    message: payload.message || error?.message || fallback,
    requestId: payload.requestId || payload.meta?.requestId || error?.response?.headers?.["x-request-id"] || "",
    details: payload.details || null,
  };
}
