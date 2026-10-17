import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../hooks/useReducedMotionFor';
import { useLivePreviewLayout } from './useLivePreviewLayout';
import type { ViewportPresentation } from '../types/viewportPresentation';

// LiveSettingsSheet.tsx — keep the stage visible while preserving the original settings' portalled editors.
export default function LiveSettingsSheet({ children, hidden, busy, close, onPreviewChange }: {
  children: ReactNode; hidden: boolean; busy: boolean; close(): void;
  onPreviewChange?: (presentation: ViewportPresentation) => void;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotionFor('uiMicroMotion');
  const panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  useLivePreviewLayout(panel, hidden, onPreviewChange);
  const backdropDown = useRef(false);
  useEffect(() => {
    if (hidden) return;
    const previous = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [hidden]);
  useEffect(() => {
    if (hidden) return;
    // iPad's native picker can retain its old anchor after rotation or an app switch while focused.
    // Release only that select; ordinary resizing, text editing and keyboard focus remain intact.
    const releasePicker = () => {
      const active = document.activeElement;
      if (active instanceof HTMLSelectElement && panel.current?.contains(active)) active.blur();
    };
    const target = window.screen.orientation ?? window;
    const event = window.screen.orientation ? 'change' : 'orientationchange';
    const background = () => { if (document.hidden) releasePicker(); };
    target.addEventListener(event, releasePicker);
    document.addEventListener('visibilitychange', background);
    return () => {
      target.removeEventListener(event, releasePicker);
      document.removeEventListener('visibilitychange', background);
    };
  }, [hidden]);
  return <div className="sheet-backdrop live-settings-host" hidden={hidden} inert={hidden}
    onPointerDown={event => { backdropDown.current = event.target === event.currentTarget; }}
    onClick={event => { if (!busy && backdropDown.current && event.target === event.currentTarget) close(); }}>
    <motion.section ref={panel} className="sheet sheet-pinned visual-settings" role="dialog" aria-modal="true" aria-label={t('mobile.visuals')}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: .12 } : { type: 'spring', stiffness: 340, damping: 36 }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy && event.target instanceof Element && event.target.closest('[role=dialog]') === panel.current) {
          event.preventDefault(); event.stopPropagation(); close();
        }
        if (event.key !== 'Tab') return;
        const focusable = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]') ?? [])]
          .filter(element => element.getClientRects().length && !element.closest('[hidden],[inert]'));
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header><div><h2>{t('mobile.visuals')}</h2><p>{t('mobile.livePreview')}</p></div>
        <button ref={closeButton} className="sheet-close" disabled={busy} aria-label={t('mobile.close')} onClick={close}><X size={22} /></button>
      </header>
      {children}
    </motion.section>
  </div>;
}
