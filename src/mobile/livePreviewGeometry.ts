import { FULL_VIEWPORT_PRESENTATION, type ViewportPresentation } from '../types/viewportPresentation';

// livePreviewGeometry.ts — give the existing responsive scene the largest unobscured rectangle.
export interface PreviewRect { x: number; y: number; width: number; height: number }
export function fitLivePreview(stage: { width: number; height: number }, available: PreviewRect, panel: PreviewRect): ViewportPresentation {
  if (![stage.width, stage.height, ...Object.values(available), ...Object.values(panel)].every(Number.isFinite)
      || stage.width <= 0 || stage.height <= 0) return FULL_VIEWPORT_PRESENTATION;
  const gap = 12;
  const right = available.x + available.width, bottom = available.y + available.height;
  const candidates = [
    { ...available, height: Math.min(bottom, panel.y - gap) - available.y },
    { ...available, width: Math.min(right, panel.x - gap) - available.x },
    { ...available, x: Math.max(available.x, panel.x + panel.width + gap), width: right - Math.max(available.x, panel.x + panel.width + gap) },
    { ...available, y: Math.max(available.y, panel.y + panel.height + gap), height: bottom - Math.max(available.y, panel.y + panel.height + gap) },
  ];
  let best: ViewportPresentation = { x: available.x, y: available.y, width: 0, height: 0 };
  let bestArea = 0;
  for (const area of candidates) {
    if (area.width <= 0 || area.height <= 0 || area.width * area.height <= bestArea) continue;
    bestArea = area.width * area.height;
    best = area;
  }
  // Similar areas should favour the wide top region: a tall narrow rail crowds cover + lyrics on iPad.
  const above = candidates[0];
  if (above.width > 0 && above.height > 0 && above.width * above.height >= bestArea * .9) return above;
  return best;
}
