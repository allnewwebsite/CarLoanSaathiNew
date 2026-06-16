export function paginationParams(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const limit = Math.min(Math.max(Number(query.limit || defaultLimit), 1), maxLimit);
  const cursor = typeof query.cursor === "string" && query.cursor.trim() ? query.cursor.trim() : null;
  const page = Number.isFinite(Number(query.page)) ? Math.max(1, Number(query.page)) : null;
  return { limit, cursor, page };
}

export function pageResponse({ data, limit, nextCursor, hasMore = undefined, total = undefined, extra = {} }) {
  const normalizedNextCursor = nextCursor || null;
  return {
    data: Array.isArray(data) ? data : [],
    limit,
    nextCursor: normalizedNextCursor,
    hasMore: typeof hasMore === "boolean" ? hasMore : Boolean(normalizedNextCursor),
    ...(Number.isFinite(Number(total)) ? { total: Number(total) } : {}),
    ...extra,
  };
}
