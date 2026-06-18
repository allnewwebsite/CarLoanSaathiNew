import { useCallback, useEffect, useMemo, useRef } from "react";

export function useCursorPager(dependencies = []) {
  const cursorsRef = useRef({ 1: null });
  const key = useMemo(() => JSON.stringify(dependencies), dependencies);

  useEffect(() => {
    cursorsRef.current = { 1: null };
  }, [key]);

  const cursorForPage = useCallback((page) => {
    const pageNumber = Math.max(Number(page || 1), 1);
    return pageNumber > 1 ? cursorsRef.current[pageNumber] || "" : "";
  }, []);

  const cursorParamsForPage = useCallback((page) => {
    const cursor = cursorForPage(page);
    return cursor ? { cursor } : {};
  }, [cursorForPage]);

  const requestPageForPage = useCallback((page) => {
    const pageNumber = Math.max(Number(page || 1), 1);
    return pageNumber <= 1 || cursorForPage(pageNumber) ? pageNumber : 1;
  }, [cursorForPage]);

  const rememberNextCursor = useCallback((page, nextCursor) => {
    const pageNumber = Math.max(Number(page || 1), 1);
    if (nextCursor) cursorsRef.current[pageNumber + 1] = nextCursor;
  }, []);

  return { cursorParamsForPage, rememberNextCursor, requestPageForPage };
}
