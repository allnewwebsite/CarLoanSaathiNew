export function paginationParams(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const limit = Math.min(Math.max(Number(query.limit || defaultLimit), 1), maxLimit);
  const cursor = typeof query.cursor === "string" && query.cursor.trim() ? query.cursor.trim() : null;
  return { limit, cursor };
}

export function pageResponse({ data, limit, nextCursor, total = undefined, extra = {} }) {
  return {
    data,
    limit,
    nextCursor: nextCursor || null,
    hasMore: Boolean(nextCursor),
    ...(Number.isFinite(total) ? { total } : {}),
    ...extra,
  };
}
