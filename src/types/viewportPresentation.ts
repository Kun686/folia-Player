// viewportPresentation.ts — an opt-in scene viewport; the mounted renderer keeps its playback clock.
export interface ViewportPresentation { x: number; y: number; width: number | null; height: number | null }
export const FULL_VIEWPORT_PRESENTATION: ViewportPresentation = { x: 0, y: 0, width: null, height: null };
