import { native, type FoliaNativePlugin } from './bridge';

// navidromeArtwork.ts — two visible-row requests at a time, leaving native cover slots for playback.
export function createNavidromeArtwork(scope: string, current: () => boolean,
  bridge: Pick<FoliaNativePlugin, 'navidromeArtwork'> = native) {
  type Work = { start(): void };
  const queued: Work[] = [];
  let active = 0;
  const drain = () => { while (active < 2 && queued.length) { active++; queued.shift()!.start(); } };
  return (id: string, signal: AbortSignal): Promise<string | undefined> => new Promise((resolve, reject) => {
    const check = () => { signal.throwIfAborted(); if (!current()) throw Error('navidrome-settings-changed'); };
    try { check(); } catch (error) { reject(error); return; }
    if (queued.length >= 64) { reject(Error('cover-busy')); return; }
    const cancel = () => { const index = queued.indexOf(work); if (index >= 0) { queued.splice(index, 1); reject(new DOMException('Canceled', 'AbortError')); } };
    const work: Work = { start: () => {
      signal.removeEventListener('abort', cancel);
      void (async () => {
        try { check(); const result = await bridge.navidromeArtwork({ id, scope }); check(); resolve(result.url); }
        catch (error) { reject(error); }
        finally { active--; drain(); }
      })();
    } };
    signal.addEventListener('abort', cancel, { once: true }); queued.push(work); drain();
  });
}
export const navidromeCoverKey = (id: string) => 'navidrome-artwork:' + encodeURIComponent(id);
export function navidromeCoverId(key?: string): string | undefined {
  return key?.startsWith('navidrome-artwork:') ? decodeURIComponent(key.slice('navidrome-artwork:'.length)) : undefined;
}
