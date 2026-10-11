import { useEffect, useRef, useState } from 'react';
import type { LyricData, SongResult } from '../types';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { shouldRequestSongThemeAutoGeneration } from '../utils/songThemeAutoGeneration';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { extractColors } from '../utils/colorExtractor';
import { buildBuiltinDualTheme } from '../hooks/themeControllerState';
import type { MobileTheme } from './useMobileTheme';
import { generateMobileAITheme, MobileAIError } from './mobileAITheme';

// useMobileThemeGeneration.ts — original AI/cover policy, bound to native song intent and explicit local choices.
export function useMobileThemeGeneration(appearance: MobileTheme, song: SongResult | null, songEpoch: number,
  lyrics: LyricData | null, lyricsLoading: boolean, cover: string | undefined, coverLoading: boolean, visible: boolean) {
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const mounted = useRef(true), attempted = useRef(new Set<string>());
  const job = useRef<{ controller: AbortController; current: () => boolean } | null>(null);
  const key = song ? getPlaybackSongKey(song) : null;
  const cancel = () => { job.current?.controller.abort(); job.current = null; setBusy(false); };
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => { cancel(); setStatus(''); };
    const background = () => { if (document.hidden) invalidate(); };
    window.addEventListener('folia-ai-settings-changed', invalidate);
    document.addEventListener('visibilitychange', background);
    return () => {
      mounted.current = false; job.current?.controller.abort(); job.current = null;
      window.removeEventListener('folia-ai-settings-changed', invalidate);
      document.removeEventListener('visibilitychange', background);
    };
  }, []);
  useEffect(() => { cancel(); setStatus(''); }, [key, songEpoch]);
  // Preference/edit changes invalidate the same guard used by the atomic theme transaction.
  useEffect(() => { if (job.current && (!job.current.current() || !visible)) { cancel(); setStatus(''); } });
  const generate = async (automatic = false) => {
    if (!song || !visible || document.hidden || job.current || coverLoading || (appearance.generationSource === 'ai' && lyricsLoading)) return;
    const session = appearance.beginGeneration();
    if (!session.ready) return;
    const controller = new AbortController(), current = () => !controller.signal.aborted && session.isCurrent();
    const work = { controller, current }; job.current = work;
    const guarded = { ...session, isCurrent: current };
    setBusy(true); setStatus('');
    try {
      let fallback = false;
      const coverTheme = async () => buildBuiltinDualTheme({ coverColors: cover ? await extractColors(cover, 5, { signal: controller.signal }) : [] });
      let theme;
      if (appearance.generationSource === 'cover') theme = await coverTheme();
      else {
        const text = lyrics?.lines.map(line => line.fullText).join('\n').trim() ?? '';
        const title = song.name?.trim() || lyrics?.title?.trim() || '';
        const pure = !!song.isPureMusic || isPureMusicLyricText(text);
        const prompt = (pure ? title : text) || text;
        if (!prompt) { setStatus('empty'); return; }
        try { theme = await generateMobileAITheme({ lyricsText: prompt, songTitle: title, isPureMusic: pure }, controller.signal); }
        catch (error) {
          if (!(error instanceof MobileAIError) || error.code !== 'ai-key-missing') throw error;
          fallback = true; theme = await coverTheme();
        }
      }
      if (!current()) return;
      const applied = await appearance.saveGenerated(theme, guarded, fallback || appearance.generationSource === 'cover' ? 'fallback' : automatic ? 'auto' : 'manual');
      if (mounted.current && job.current === work) setStatus(!applied ? 'savedPinned' : fallback ? 'fallback' : 'applied');
    } catch (error) {
      if (mounted.current && job.current === work && current()) setStatus(error instanceof MobileAIError ? error.code : 'saveError');
    } finally {
      if (mounted.current && job.current === work) { job.current = null; setBusy(false); }
    }
  };
  useEffect(() => {
    if (!key || !visible || document.hidden || busy || coverLoading || !appearance.beginGeneration().ready) return;
    if (!shouldRequestSongThemeAutoGeneration({ enabled: appearance.autoGenerate, currentSong: song, lyrics,
      isLyricsLoading: appearance.generationSource === 'ai' && lyricsLoading, hasAttempted: attempted.current.has(key),
      hasCachedTheme: appearance.cached.kind !== 'none', requiresPromptSource: appearance.generationSource === 'ai' })) return;
    attempted.current.add(key);
    if (attempted.current.size > 256) attempted.current.delete(attempted.current.values().next().value!);
    void generate(true);
  });
  return { busy, status, generate: () => generate(), cancel: () => { cancel(); setStatus('ai-cancelled'); },
    ready: !!song && visible && !coverLoading && (appearance.generationSource === 'cover' || !lyricsLoading) && appearance.beginGeneration().ready };
}
export type MobileThemeGeneration = ReturnType<typeof useMobileThemeGeneration>;
