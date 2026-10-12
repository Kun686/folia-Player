import { useEffect, useRef } from 'react';
import type { SegmentLyricsOptions } from '../services/lyricSegmentationAi';
import { segmentMobileLyricsWithAi } from './mobileAISegmentation';

// useMobileSegmentationAI.ts — a foreground editor job; native song intent also guards the final local transaction.
export function useMobileSegmentationAI(captureGuard: () => () => boolean, visible: boolean) {
  const current = useRef({ captureGuard, visible }); current.current = { captureGuard, visible };
  const job = useRef<{ controller: AbortController; valid(): boolean } | null>(null);
  const cancel = () => { job.current?.controller.abort(); };
  useEffect(() => {
    const background = () => { if (document.hidden) cancel(); };
    window.addEventListener('folia-ai-settings-changed', cancel);
    document.addEventListener('visibilitychange', background);
    return () => { cancel(); window.removeEventListener('folia-ai-settings-changed', cancel);
      document.removeEventListener('visibilitychange', background); };
  }, []);
  useEffect(() => { if (!visible) cancel(); }, [visible]);
  const run = async (lines: string[], options: SegmentLyricsOptions = {}) => {
    cancel();
    const controller = new AbortController(), songCurrent = current.current.captureGuard();
    const work = { controller, valid: () => !controller.signal.aborted && current.current.visible && !document.hidden && songCurrent() };
    job.current = work;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted || !work.valid()) abort();
    try {
      const result = await segmentMobileLyricsWithAi(lines, { signal: controller.signal, onProgress: options.onProgress });
      if (!work.valid()) throw new DOMException('Segmentation cancelled', 'AbortError');
      return result;
    } catch (error) {
      if (!work.valid()) throw new DOMException('Segmentation cancelled', 'AbortError');
      throw error;
    } finally { options.signal?.removeEventListener('abort', abort); }
  };
  return { run, cancel, isCurrent: () => job.current?.valid() === true };
}
