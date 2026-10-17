import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

// usePlayerChromeActivity.ts — shared desktop/mobile idle clock; pointer holds never expire mid-drag.
export const usePlayerChromeActivity = (
    enabled: boolean,
    setIsPlayerChromeHidden: React.Dispatch<React.SetStateAction<boolean>>,
) => {
    const timeoutIdRef = useRef<number | undefined>(undefined);
    const rafIdRef = useRef<number | undefined>(undefined);
    const revealRef = useRef<() => void>(() => setIsPlayerChromeHidden(false));
    const reveal = useCallback(() => revealRef.current(), []);
    useEffect(() => {
        revealRef.current = () => setIsPlayerChromeHidden(false);
        if (!enabled) return;
        let isThrottled = false;
        let isPointerHeld = false;
        let deferTouchReveal = false;

        const clearAutoHideTimer = () => {
            window.clearTimeout(timeoutIdRef.current);
            timeoutIdRef.current = undefined;
        };

        const scheduleAutoHide = (delay: number) => {
            clearAutoHideTimer();
            if (isPointerHeld) return;
            timeoutIdRef.current = window.setTimeout(() => {
                timeoutIdRef.current = undefined;
                setIsPlayerChromeHidden(true);
            }, delay);
        };

        const showAndResetTimer = () => {
            setIsPlayerChromeHidden(false);
            scheduleAutoHide(3000);
        };

        const handleMouseOut = (event: PointerEvent) => {
            if (event.pointerType !== 'mouse') return;
            const hasLeftWindow = !event.relatedTarget || event.clientY <= 0 || event.clientX <= 0
                || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
            if (hasLeftWindow) {
                scheduleAutoHide(300);
            }
        };

        const handleMouseMove = (event: PointerEvent) => {
            // iOS emits compatibility mousemove before click. Revealing controls there can swallow the tap.
            if (event.pointerType !== 'mouse') return;
            // A pointer released outside the window does not reliably deliver pointerup here.
            // Repair the held state as soon as the mouse comes back without a pressed button.
            if (isPointerHeld && event.buttons === 0) {
                isPointerHeld = false;
            }
            if (isThrottled) return;
            isThrottled = true;
            rafIdRef.current = requestAnimationFrame(() => {
                showAndResetTimer();
                isThrottled = false;
            });
        };
        const handlePointerDown = (event: PointerEvent) => {
            isPointerHeld = true;
            clearAutoHideTimer();
            // Keep the hit-tested surface stable until an actionable touch produces its click.
            deferTouchReveal = event.pointerType === 'touch' && event.target instanceof Element
                && !!event.target.closest('button,a,input,select,textarea,[role="button"],[role="slider"]');
            if (!deferTouchReveal) setIsPlayerChromeHidden(false);
        };
        const handlePointerUp = () => {
            isPointerHeld = false;
            if (deferTouchReveal) scheduleAutoHide(3000);
            else showAndResetTimer();
        };
        const finishTouch = () => {
            deferTouchReveal = false;
            isPointerHeld = false;
            showAndResetTimer();
        };
        const handleWindowBlur = () => {
            isPointerHeld = false;
            scheduleAutoHide(300);
        };

        revealRef.current = showAndResetTimer;
        showAndResetTimer();
        window.addEventListener('pointerout', handleMouseOut);
        window.addEventListener('pointermove', handleMouseMove);
        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', finishTouch);
        window.addEventListener('click', finishTouch);
        window.addEventListener('wheel', showAndResetTimer, { passive: true });
        window.addEventListener('blur', handleWindowBlur);

        return () => {
            revealRef.current = () => setIsPlayerChromeHidden(false);
            clearAutoHideTimer();
            if (rafIdRef.current !== undefined) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = undefined;
            }
            window.removeEventListener('pointerout', handleMouseOut);
            window.removeEventListener('pointermove', handleMouseMove);
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', finishTouch);
            window.removeEventListener('click', finishTouch);
            window.removeEventListener('wheel', showAndResetTimer);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [enabled, setIsPlayerChromeHidden]);
    return reveal;
};
