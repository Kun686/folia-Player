import { createContext } from 'react';
import type { MotionValue } from 'framer-motion';

// VideoLayerPlayback.ts — an alternate player supplies its clock without mutating the desktop playback store.
export const VideoLayerPlayback = createContext<{
    time: MotionValue<number>;
    playing: boolean;
    songKey: string;
} | null>(null);
