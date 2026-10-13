import { useCallback, useRef } from 'react';

// useSheetScroll.ts — retain a settings page's position while its existing subview replaces it.
export function useSheetScroll() {
  const current = useRef<HTMLElement | null>(null);
  const position = useRef(0);
  return useCallback((element: HTMLElement | null) => {
    if (current.current) position.current = current.current.scrollTop;
    current.current = element;
    if (element) element.scrollTop = position.current;
  }, []);
}
