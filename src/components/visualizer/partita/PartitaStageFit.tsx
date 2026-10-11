import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { partitaStageScale, type FitBox, type FitMotion, type FitWord } from './partitaFitGeometry';

// PartitaStageFit.tsx — opt-in mobile fitting of the original composition; desktop markup and motion stay unchanged.
function naturalBox(node: HTMLElement, root: HTMLElement): FitBox {
  let x = 0, y = 0, current: HTMLElement | null = node;
  while (current && current !== root) {
    x += current.offsetLeft; y += current.offsetTop; current = current.offsetParent as HTMLElement | null;
  }
  return { x, y, width: node.offsetWidth, height: node.offsetHeight };
}
export default function PartitaStageFit({ enabled, stage, children }: {
  enabled?: boolean; stage: RefObject<HTMLDivElement | null>; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = root.current, host = stage.current;
    if (!enabled || !content || !host) return;
    let active = true, previous = -1;
    const nodes = [...content.querySelectorAll<HTMLElement>('[data-partita-fit-word]')];
    const update = () => {
      if (!active) return;
      const words: FitWord[] = nodes.filter(node => content.contains(node)).map(node => {
        const chunk = node.closest<HTMLElement>('[data-partita-fit-chunk]')!;
        return { box: naturalBox(node, content), motion: JSON.parse(node.dataset.partitaFitWord!) as FitMotion,
          chunk: naturalBox(chunk, content), chunkMotion: JSON.parse(chunk.dataset.partitaFitChunk!) as FitMotion,
          entranceX: Number(chunk.dataset.partitaEntranceX) };
      });
      const scale = partitaStageScale({ width: host.clientWidth, height: host.clientHeight },
        { width: content.offsetWidth, height: content.offsetHeight }, words);
      if (Math.abs(scale - previous) < 0.0001) return;
      previous = scale;
      content.style.transform = scale < 1 ? `scale(${scale})` : 'none';
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host); observer.observe(content); nodes.forEach(node => observer.observe(node));
    // Loading a custom font may change a word without changing the stage dimensions.
    void document.fonts.ready.then(update); document.fonts.addEventListener('loadingdone', update);
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener('loadingdone', update); };
  }, [enabled, stage, children]);
  return enabled ? <div ref={root} data-partita-fit className="relative flex w-full max-w-5xl items-center justify-center" style={{ transformOrigin: 'center' }}>{children}</div> : children;
}
