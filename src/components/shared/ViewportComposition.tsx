import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import type { ViewportPresentation } from '../../types/viewportPresentation';
import { colorWithAlpha } from '../visualizer/colorMix';

// ViewportComposition.tsx — reuse each renderer's responsive layout without scaling lyrics into illegible miniatures.
export default function ViewportComposition({ presentation, overlay = false, protectionColor, children }: {
  presentation?: ViewportPresentation; overlay?: boolean; protectionColor?: string; children: ReactNode;
}) {
  const reduced = useReducedMotionFor('uiMicroMotion');
  if (!presentation) return children;
  return <motion.div data-viewport-composition={overlay ? 'overlay' : 'scene'} initial={false}
    animate={{ x: presentation.x, y: presentation.y }}
    transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 340, damping: 38 }}
    style={{ position: 'absolute', top: 0, left: 0, width: presentation.width ?? '100%', height: presentation.height ?? '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', transformOrigin: '0 0', overflow: 'hidden', zIndex: overlay ? 20 : 1,
      pointerEvents: overlay ? 'none' : undefined }}>
    {protectionColor && <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none',
      // End at the sides: the default farthest-corner radius leaves a visible tint at the clipped edges.
      background: `radial-gradient(ellipse closest-side at center, ${colorWithAlpha(protectionColor, .8)} 0%, ${colorWithAlpha(protectionColor, .5)} 55%, transparent 100%)` }} />}
    {children}
  </motion.div>;
}
