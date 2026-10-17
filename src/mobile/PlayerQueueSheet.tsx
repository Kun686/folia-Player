import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { animate, motion, useDragControls, useMotionValue, useTransform } from 'framer-motion';
import { ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import QueueBrowser from './QueueBrowser';
import QueueActionsMenu from './QueueActionsMenu';
import { queueSheetAnchors, queueSheetTarget } from './queueSheetGeometry';
import { useReducedMotionFor } from '../hooks/useReducedMotionFor';

// PlayerQueueSheet.tsx — native queue browsing in a modal sheet; Motion owns drag, elasticity and springs.
export default function PlayerQueueSheet({ close, error, ...queue }: ComponentProps<typeof QueueBrowser> & { close(): void; error: string }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null), panel = useRef<HTMLElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  const controls = useDragControls(), y = useMotionValue(window.innerHeight);
  const reduced = useReducedMotionFor('uiMicroMotion');
  const [height, setHeight] = useState(window.innerHeight);
  const [snap, setSnap] = useState<'full' | 'middle' | 'closed'>('middle');
  const snapRef = useRef(snap);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const generation = useRef(0);
  const dragging = useRef(false);
  const opacity = useTransform(y, [0, height + 24], [.5, 0]);
  const hiddenInset = useTransform(y, value => `${Math.max(0, value)}px`);
  const stop = useCallback(() => { generation.current++; animation.current?.stop(); }, []);
  const settle = useCallback((next: typeof snap, velocity = 0, size = height) => {
    stop();
    const version = generation.current;
    snapRef.current = next; setSnap(next);
    animation.current = animate(y, queueSheetAnchors(size)[next], {
      ...(reduced ? { duration: .12 } : { type: 'spring' as const, stiffness: 380, damping: 36, velocity }),
      onComplete: () => { if (generation.current === version && next === 'closed') closeRef.current(); },
    });
  }, [height, reduced, stop, y]);
  const settleRef = useRef(settle); settleRef.current = settle;
  useLayoutEffect(() => {
    const host = dialog.current!, surface = panel.current!;
    host.showModal();
    let previous = 0;
    const measure = () => {
      const size = surface.offsetHeight;
      if (!size || size === previous) return;
      previous = size; setHeight(size);
      settleRef.current(snapRef.current, 0, size);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(surface);
    return () => { observer.disconnect(); stop(); host.close(); };
  }, [stop]);
  const dismiss = () => settle('closed');
  return <dialog ref={dialog} className="player-queue-host" aria-label={t('mobile.queue')}
    onCancel={event => { event.preventDefault(); dismiss(); }}>
    <motion.button className="player-queue-scrim" style={{ opacity }} aria-label={t('mobile.close')}
      tabIndex={-1} onClick={dismiss} />
    <motion.section ref={panel} className="player-queue-sheet sheet" data-snap={snap} style={{ y, '--queue-hidden-inset': hiddenInset } as import('framer-motion').MotionStyle}
      drag="y" dragControls={controls} dragListener={false} dragMomentum={false}
      dragConstraints={{ top: 0, bottom: height + 24 }} dragElastic={reduced ? 0 : { top: .16, bottom: .1 }}
      onDragStart={() => { dragging.current = true; }}
      onDragEnd={(_, info) => { dragging.current = false; settle(queueSheetTarget(y.get(), info.velocity.y, height), info.velocity.y); }}
      onFocusCapture={event => { if (event.target.matches('input,textarea,select')) settle('full'); }}>
      <button className="queue-grab" aria-label={t('mobile.queueSheet.resize')} aria-expanded={snap === 'full'}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          // Keep touch/mouse ownership on the moving handle, including after viewport changes.
          // Avoid WebKit scrolling a focused button while its transformed sheet is moving.
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          stop(); controls.start(event);
        }}
        onPointerUp={() => { if (!dragging.current) settle(snapRef.current); }}
        onPointerCancel={() => { dragging.current = false; settle(snapRef.current); }}
        onClick={event => { if (event.detail === 0) settle(snapRef.current === 'full' ? 'middle' : 'full'); }}
        onKeyDown={event => {
          if (['ArrowUp', 'Home'].includes(event.key)) { event.preventDefault(); settle('full'); }
          if (['ArrowDown', 'End'].includes(event.key)) { event.preventDefault(); settle('middle'); }
        }}><span /></button>
      <header><div><h2>{t('mobile.queue')}</h2><small>{queue.state.queue.length}</small></div>
        <div className="queue-heading-actions">
          <QueueActionsMenu busy={queue.busy} count={queue.state.queue.length} edit={queue.edit} />
          <button className="queue-expand" aria-label={t('mobile.queueSheet.resize')}
            onClick={() => settle(snap === 'full' ? 'middle' : 'full')}><ChevronDown style={{ transform: snap === 'full' ? 'none' : 'rotate(180deg)' }} size={20} /></button>
        <button aria-label={t('mobile.close')} onClick={dismiss}><X size={22} /></button></div></header>
      <div className="queue-sheet-content">
        {error && <p role="alert">{t('mobile.' + error)}</p>}
        <QueueBrowser {...queue} />
      </div>
    </motion.section>
  </dialog>;
}
