import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { usePlayerChromeActivity } from './usePlayerChromeActivity';
import type { PlayerChromeVisibilityMode } from '../types/remoteControl';

// src/hooks/usePlayerChromeAutoHide.ts
// Coordinates persisted player-chrome modes with the legacy auto-hide setting.
const PLAYER_CHROME_VISIBILITY_MODE_STORAGE_KEY = 'player_chrome_visibility_mode';

const isPlayerChromeVisibilityMode = (value: string | null): value is PlayerChromeVisibilityMode => (
    value === 'always-hidden' || value === 'always-visible' || value === 'auto-hide'
);
type UsePlayerChromeAutoHideOptions = {
    autoHidePlayerChrome: boolean;
    initialPlayerChromeHidden: boolean;
    suppressPointerReveal?: boolean;
    setIsPlayerChromeHidden: React.Dispatch<React.SetStateAction<boolean>>;
    setAutoHidePlayerChromePreference: (enabled: boolean) => void;
    onModeChange?: (mode: PlayerChromeVisibilityMode) => void;
};

const getNextPlayerChromeVisibilityMode = (mode: PlayerChromeVisibilityMode): PlayerChromeVisibilityMode => {
    if (mode === 'always-hidden') return 'always-visible';
    if (mode === 'always-visible') return 'auto-hide';
    return 'always-hidden';
};

const getInitialPlayerChromeVisibilityMode = (autoHidePlayerChrome: boolean, initialPlayerChromeHidden: boolean): PlayerChromeVisibilityMode => {
    const storedMode = localStorage.getItem(PLAYER_CHROME_VISIBILITY_MODE_STORAGE_KEY);
    if (isPlayerChromeVisibilityMode(storedMode)) {
        return storedMode;
    }

    if (autoHidePlayerChrome) return 'auto-hide';
    return initialPlayerChromeHidden ? 'always-hidden' : 'always-visible';
};

export const usePlayerChromeAutoHide = ({
    autoHidePlayerChrome,
    initialPlayerChromeHidden,
    suppressPointerReveal = false,
    setIsPlayerChromeHidden,
    setAutoHidePlayerChromePreference,
    onModeChange,
}: UsePlayerChromeAutoHideOptions) => {
    const [playerChromeVisibilityMode, setPlayerChromeVisibilityMode] = useState<PlayerChromeVisibilityMode>(() => (
        getInitialPlayerChromeVisibilityMode(autoHidePlayerChrome, initialPlayerChromeHidden)
    ));
    const playerChromeVisibilityModeRef = useRef(playerChromeVisibilityMode);
    const isSynchronizingPreferenceRef = useRef(false);
    const hasInitializedPreferenceSyncRef = useRef(false);

    const cyclePlayerChromeVisibilityMode = useCallback(() => {
        const nextMode = getNextPlayerChromeVisibilityMode(playerChromeVisibilityModeRef.current);
        const shouldAutoHide = nextMode === 'auto-hide';
        playerChromeVisibilityModeRef.current = nextMode;
        setPlayerChromeVisibilityMode(nextMode);
        if (autoHidePlayerChrome !== shouldAutoHide) {
            isSynchronizingPreferenceRef.current = true;
            setAutoHidePlayerChromePreference(shouldAutoHide);
        }
        onModeChange?.(nextMode);
    }, [autoHidePlayerChrome, onModeChange, setAutoHidePlayerChromePreference]);

    useEffect(() => {
        localStorage.setItem(PLAYER_CHROME_VISIBILITY_MODE_STORAGE_KEY, playerChromeVisibilityMode);
    }, [playerChromeVisibilityMode]);

    useEffect(() => {
        if (!hasInitializedPreferenceSyncRef.current) {
            hasInitializedPreferenceSyncRef.current = true;
            const shouldAutoHide = playerChromeVisibilityModeRef.current === 'auto-hide';
            if (autoHidePlayerChrome !== shouldAutoHide) {
                isSynchronizingPreferenceRef.current = true;
                setAutoHidePlayerChromePreference(shouldAutoHide);
            }
            return;
        }

        if (isSynchronizingPreferenceRef.current) {
            isSynchronizingPreferenceRef.current = false;
            return;
        }

        const nextMode = autoHidePlayerChrome ? 'auto-hide' : 'always-visible';
        playerChromeVisibilityModeRef.current = nextMode;
        setPlayerChromeVisibilityMode(nextMode);
    }, [autoHidePlayerChrome, setAutoHidePlayerChromePreference]);

    usePlayerChromeActivity(playerChromeVisibilityMode === 'auto-hide' && !suppressPointerReveal, setIsPlayerChromeHidden);
    useEffect(() => {
        if (playerChromeVisibilityMode === 'always-visible') setIsPlayerChromeHidden(false);
        // Click-through still forwards mouse-move into the renderer, so auto-hide would read the
        // cursor passing over an untouchable window as user presence and pop the chrome back up.
        if (playerChromeVisibilityMode === 'always-hidden' || (playerChromeVisibilityMode === 'auto-hide' && suppressPointerReveal)) setIsPlayerChromeHidden(true);
    }, [playerChromeVisibilityMode, suppressPointerReveal, setIsPlayerChromeHidden]);

    return { playerChromeVisibilityMode, cyclePlayerChromeVisibilityMode };
};
