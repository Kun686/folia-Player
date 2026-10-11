import { useEffect, useRef, type InputHTMLAttributes } from 'react';

// TouchRange.tsx — retain native range semantics while keeping iOS sheet drags on the input.
export default function TouchRange(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onTouchMove'>) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    // Paired with touch-action:none on typography ranges, this direct listener keeps
    // WKWebView delivering moves inside scrolling disclosures. Preserve native range behavior.
    const retainRangeGesture = (event: TouchEvent) => event.stopPropagation();
    element.addEventListener('touchmove', retainRangeGesture, { passive: false });
    return () => element.removeEventListener('touchmove', retainRangeGesture);
  }, []);
  return <input {...props} ref={input} type="range" />;
}
