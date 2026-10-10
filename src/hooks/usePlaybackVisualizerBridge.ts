import { applyVisualizerIdle, applyVisualizerSpectrum } from '../utils/visualizerAudio';
import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import { findLatestActiveLineIndex } from '../utils/appPlaybackHelpers';
import { PlayerState } from '../types';
import type { AudioBands, LyricData } from '../types';
import { setCurrentLineIndex, setPlayerState } from '../stores/usePlaybackStore';
import { selectDisplayLyrics, usePlaybackStore } from '../stores/usePlaybackStore';
import { audioBands, audioPower, currentTime, lyricCurrentTime } from '../stores/motionSignals';

// src/hooks/usePlaybackVisualizerBridge.ts

type UsePlaybackVisualizerBridgeParams = {

    audioRef: MutableRefObject<HTMLAudioElement | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    animationFrameRef: MutableRefObject<number>;
    effectiveLoopMode: 'off' | 'all' | 'one';
    isNowPlayingStageActive: boolean;
    isPlayerCapStageActive: boolean;
    stageActiveEntryKind: string | null;
    stageLyricsSession: unknown;
    stageLyricsClockRef: MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    getSyntheticStageLyricsTime: () => number;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    getNowPlayingDisplayTime: () => number;
    getPlayerCapDisplayTime: () => number;
    syncNowPlayingClock: (progressSec: number, durationSec: number, paused: boolean) => void;
    lyricTimelineOffsetMs: number;
    /** True while an automix handover is in progress and a deck other than the active one sounds. */
    isTransitionAudible: () => boolean;
    /**
     * The deck the on-screen track is playing on while a transition holds the picture, else null.
     *
     * The clock below has to follow whatever is on screen. From the moment a blend arms, the
     * active deck is seconds into the NEXT track while the title, cover and lyrics still belong to
     * the one finishing - so reading the active deck here puts the progress bar and the lyric
     * read-head near zero under a song that is three minutes in.
     */
    getDisplayElement?: () => HTMLAudioElement | null;
};

// Runs the requestAnimationFrame loop for audio-reactive visuals and lyric timing.
export function usePlaybackVisualizerBridge({
    audioRef,
    analyserRef,
    animationFrameRef,
    effectiveLoopMode,
    isNowPlayingStageActive,
    isPlayerCapStageActive,
    stageActiveEntryKind,
    stageLyricsSession,
    stageLyricsClockRef,
    getSyntheticStageLyricsTime,
    syncStageLyricsClock,
    getNowPlayingDisplayTime,
    getPlayerCapDisplayTime,
    syncNowPlayingClock,
    lyricTimelineOffsetMs,
    isTransitionAudible,
    getDisplayElement,
}: UsePlaybackVisualizerBridgeParams) {
    // Read here rather than passed in: store fields and the module-level motion signals.
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const playerState = usePlaybackStore(state => state.playerState);
    const duration = usePlaybackStore(state => state.duration);
    // The lyrics on screen, matching the deck getDisplayElement points at.
    const lyrics = usePlaybackStore(selectDisplayLyrics);

    const currentLineIndexRef = useRef(-1);

    const updateLoop = useCallback(() => {
        // Normally the active deck; the outgoing one for as long as a blend holds the picture on
        // the track it is finishing, so that clock and picture never describe different songs.
        const audioElement = getDisplayElement?.() ?? audioRef.current;
        const isActuallyPlaying = Boolean(audioElement && !audioElement.paused && !audioElement.ended);
        // Mid-handover a deck can be loading while the other one is still sounding. The analyser
        // is downstream of both, so it has real signal: dropping to the idle breath here would put
        // a visible stutter at exactly the moment meant to be seamless.
        const hasAudibleSignal = isActuallyPlaying || isTransitionAudible();

        if (hasAudibleSignal && analyserRef.current) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteFrequencyData(dataArray);
            // Preserve the original desktop band boundaries; native uses its actual sample rate.
            applyVisualizerSpectrum(dataArray, 21.5, audioPower, audioBands);
        } else {
            applyVisualizerIdle(audioPower, audioBands, Date.now());
        }

        if (isActuallyPlaying && audioElement) {
            const time = audioElement.currentTime;
            currentTime.set(time);

            const effectiveLyricTime = time - lyricTimelineOffsetMs / 1000;
            lyricCurrentTime.set(effectiveLyricTime);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime);
                if (foundIndex !== currentLineIndexRef.current) {
                    currentLineIndexRef.current = foundIndex;
                    setCurrentLineIndex(foundIndex);
                }
            }
        } else if (isNowPlayingStageActive) {
            const nextTime = getNowPlayingDisplayTime();
            const hasReachedEnd = playerState === PlayerState.PLAYING && duration > 0 && nextTime >= duration;

            currentTime.set(nextTime);

            const effectiveLyricTime = nextTime - lyricTimelineOffsetMs / 1000;
            lyricCurrentTime.set(effectiveLyricTime);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime);
                if (foundIndex !== currentLineIndexRef.current) {
                    currentLineIndexRef.current = foundIndex;
                    setCurrentLineIndex(foundIndex);
                }
            } else if (currentLineIndexRef.current !== -1) {
                currentLineIndexRef.current = -1;
                setCurrentLineIndex(-1);
            }

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncNowPlayingClock(0, duration, false);
                    currentTime.set(0);
                    if (lyrics) {
                        const restartedLineIndex = findLatestActiveLineIndex(lyrics.lines, 0);
                        if (restartedLineIndex !== currentLineIndexRef.current) {
                            currentLineIndexRef.current = restartedLineIndex;
                            setCurrentLineIndex(restartedLineIndex);
                        }
                    }
                } else {
                    syncNowPlayingClock(duration, duration, true);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        } else if (isPlayerCapStageActive) {
            // PlayerCap: clock extrapolated from progress×duration; a passive source, looping/ending is driven by the external player, so no end/loop handling here.
            const nextTime = getPlayerCapDisplayTime();
            currentTime.set(nextTime);

            const effectiveLyricTime = nextTime - lyricTimelineOffsetMs / 1000;
            lyricCurrentTime.set(effectiveLyricTime);

            if (lyrics) {
                const foundIndex = findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime);
                if (foundIndex !== currentLineIndexRef.current) {
                    currentLineIndexRef.current = foundIndex;
                    setCurrentLineIndex(foundIndex);
                }
            } else if (currentLineIndexRef.current !== -1) {
                currentLineIndexRef.current = -1;
                setCurrentLineIndex(-1);
            }
        } else if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && stageLyricsSession && lyrics) {
            const nextTime = getSyntheticStageLyricsTime();
            const clock = stageLyricsClockRef.current;
            const hasReachedEnd = playerState === PlayerState.PLAYING && nextTime >= clock.endTimeSec;

            currentTime.set(nextTime);

            const foundIndex = findLatestActiveLineIndex(lyrics.lines, nextTime);
            if (foundIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = foundIndex;
                setCurrentLineIndex(foundIndex);
            }

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncStageLyricsClock(clock.startTimeSec, clock.endTimeSec, PlayerState.PLAYING, clock.startTimeSec);
                    currentTime.set(clock.startTimeSec);
                    const restartedLineIndex = findLatestActiveLineIndex(lyrics.lines, clock.startTimeSec);
                    if (restartedLineIndex !== currentLineIndexRef.current) {
                        currentLineIndexRef.current = restartedLineIndex;
                        setCurrentLineIndex(restartedLineIndex);
                    }
                } else {
                    syncStageLyricsClock(clock.endTimeSec, clock.endTimeSec, PlayerState.PAUSED, clock.startTimeSec);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        }

        animationFrameRef.current = requestAnimationFrame(updateLoop);
    }, [
        activePlaybackContext,
        analyserRef,
        animationFrameRef,
        audioBands,
        audioPower,
        audioRef,
        currentTime,
        duration,
        effectiveLoopMode,
        getNowPlayingDisplayTime,
        getPlayerCapDisplayTime,
        getSyntheticStageLyricsTime,
        isNowPlayingStageActive,
        isPlayerCapStageActive,
        lyrics,
        playerState,
        setCurrentLineIndex,
        setPlayerState,
        stageActiveEntryKind,
        stageLyricsClockRef,
        stageLyricsSession,
        syncNowPlayingClock,
        syncStageLyricsClock,
        lyricTimelineOffsetMs,
        lyricCurrentTime,
        isTransitionAudible,
        getDisplayElement,
    ]);

    useEffect(() => {
        animationFrameRef.current = requestAnimationFrame(updateLoop);
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [animationFrameRef, updateLoop]);
}
