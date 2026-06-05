import { useCallback, useEffect, useMemo, useRef } from "react";

export function useCursorPager(dependencies = []) {
  const cursorsRef = useRef({ 1: null });
  const key = useMemo(() => JSON.stringify(dependencies), dependencies);

  useEffect(() => {
    cursorsRef.current = { 1: null };
  }, [key]);

  const cursorParamsForPage = useCallback((page) => {
    const pageNumber = Math.max(Number(page || 1), 1);
    const cursor = cursorsRef.current[pageNumber];
    return pageNumber > 1 && cursor ? { cursor } : {};
  }, []);

  const rememberNextCursor = useCallback((page, nextCursor) => {
    const pageNumber = Math.max(Number(page || 1), 1);
    if (nextCursor) cursorsRef.current[pageNumber + 1] = nextCursor;
  }, []);

  return { cursorParamsForPage, rememberNextCursor };
}
