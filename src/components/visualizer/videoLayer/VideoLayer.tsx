import React, { useContext, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PlayerState } from '../../../types';
import { currentTime } from '../../../stores/motionSignals';
import { selectDisplayPlayerState, selectDisplaySong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { ensureVideoLayerFileRestored, useVideoLayerSettingsStore } from '../../../stores/useVideoLayerSettingsStore';
import { VideoLayerPlayback } from './VideoLayerPlayback';
import { isMainAppSurface } from '../../../utils/appSurface';

// src/components/visualizer/videoLayer/VideoLayer.tsx
// Built-in muted video behind the lyrics (above the background, under the lyrics). The video follows
// playback without any per-frame React work: play/pause follows the player state, a jump in the
// playback clock (seek, song change) re-aligns it, and slow drift is corrected every few seconds.
// The video position is the song position modulo the video length, so a short loop keeps cycling.

const DRIFT_CHECK_MS = 2000;
const DRIFT_TOLERANCE_SEC = 0.35;
// A clock step bigger than this between two ticks is a seek or a song change, not playback.
const CLOCK_JUMP_SEC = 1;

interface VideoLayerProps {
    /** The shell's pause signal (window hidden etc.); the video stops even while music plays. */
    paused: boolean;
}

const VideoLayer: React.FC<VideoLayerProps> = ({ paused }) => {
    const playback = useContext(VideoLayerPlayback);
    const clock = playback?.time ?? currentTime;
    const alternatePlayer = playback !== null;
    const playbackRef = useRef(playback); playbackRef.current = playback;
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    const { enabled, url, opacity, fit, localFileUrl } = useVideoLayerSettingsStore(useShallow(state => ({
        enabled: state.videoLayerEnabled,
        url: state.videoLayerUrl,
        opacity: state.videoLayerOpacity,
        fit: state.videoLayerFit,
        localFileUrl: state.localFileUrl,
    })));
    const source = localFileUrl ?? (url || null);
    const active = enabled && Boolean(source) && (isMainAppSurface || alternatePlayer);
    const isPlaying = () => playbackRef.current?.playing ?? (selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING);

    useEffect(() => {
        if (isMainAppSurface || alternatePlayer) ensureVideoLayerFileRestored();
    }, [alternatePlayer]);

    useEffect(() => {
        const video = videoRef.current;
        if (!active || !video) return;
        // Effect replay and reactivation must restore the resource released by cleanup.
        if (video.getAttribute('src') !== source) video.setAttribute('src', source!);

        const align = () => {
            if (!Number.isFinite(video.duration) || video.duration <= 0 || video.seeking) return;
            const target = Math.max(0, clock.get()) % video.duration;
            if (Math.abs(video.currentTime - target) > DRIFT_TOLERANCE_SEC) video.currentTime = target;
        };
        const followState = () => {
            if (isPlaying() && !pausedRef.current) void video.play().catch(() => {});
            else video.pause();
        };
        const onMetadata = () => {
            align();
            followState();
        };

        video.addEventListener('loadedmetadata', onMetadata);
        video.addEventListener('seeked', align);
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();

        const unsubscribeStore = alternatePlayer ? () => {} : usePlaybackStore.subscribe((state, previous) => {
            if (selectDisplayPlayerState(state) !== selectDisplayPlayerState(previous)) followState();
            if (selectDisplaySong(state) !== selectDisplaySong(previous)) align();
        });
        let lastClock = clock.get();
        const unsubscribeClock = clock.on('change', (value) => {
            if (Math.abs(value - lastClock) > CLOCK_JUMP_SEC) align();
            lastClock = value;
        });
        const drift = window.setInterval(align, DRIFT_CHECK_MS);

        return () => {
            window.clearInterval(drift);
            unsubscribeClock();
            unsubscribeStore();
            video.removeEventListener('loadedmetadata', onMetadata);
            video.removeEventListener('seeked', align);
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, [active, source, clock, alternatePlayer]);

    // The shell's pause flag changes without touching the source; only play/pause needs to follow.
    useEffect(() => {
        const video = videoRef.current;
        if (!active || !video) return;
        if (paused) {
            video.pause();
        } else if (isPlaying()) {
            void video.play().catch(() => {});
        } else video.pause();
    }, [active, paused, playback?.playing]);

    useEffect(() => {
        const video = videoRef.current;
        if (active && video && Number.isFinite(video.duration) && video.duration > 0 && !video.seeking) {
            video.currentTime = Math.max(0, clock.get()) % video.duration;
        }
    }, [active, clock, playback?.songKey]);

    if (!active || !source) return null;

    return (
        <video
            ref={videoRef}
            key={source}
            src={source}
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden
            className="absolute inset-0 h-full w-full pointer-events-none"
            style={{ opacity, objectFit: fit }}
        />
    );
};

export default VideoLayer;
