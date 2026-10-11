import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PartitaStageFit from '@/components/visualizer/partita/PartitaStageFit';
import { partitaStageScale, type FitWord } from '@/components/visualizer/partita/partitaFitGeometry';

// partitaStageFit.test.ts — opt-in isolation and finite geometry at narrow/hidden host boundaries.
const word: FitWord = { box: { x: -9, y: 155, width: 400, height: 49 }, motion: [-5, 3, 0, 1.3, 10],
  chunk: { x: -17, y: 152, width: 429, height: 55 }, chunkMotion: [-20, 0, 0, 1.3, 3], entranceX: -40 };
describe('Partita mobile stage fit', () => {
  it('adds no wrapper or markup to existing hosts unless explicitly enabled', () => {
    const child = React.createElement('span', null, 'unchanged desktop composition');
    expect(renderToStaticMarkup(React.createElement(PartitaStageFit, { stage: { current: null }, children: child })))
      .toBe(renderToStaticMarkup(child));
  });
  it('fits the active long word with its chunk offset, without mutating the layout', () => {
    const before = structuredClone(word), stage = { width: 382, height: 314 }, content = { width: 318, height: 384 };
    const scale = partitaStageScale(stage, content, [word]);
    const activeHalfWidth = word.box.width * 1.3 * 1.4 / 2;
    const center = word.box.x + word.box.width / 2 - content.width / 2 - 5 - 20;
    expect(scale).toBeGreaterThan(0); expect(scale).toBeLessThan(1);
    expect((Math.abs(center) + activeHalfWidth) * scale).toBeLessThan(stage.width / 2);
    expect(word).toEqual(before);
  });
  it('does not enlarge content and recovers from a hidden host or an empty line', () => {
    expect(partitaStageScale({ width: 2000, height: 1200 }, { width: 318, height: 384 }, [word])).toBe(1);
    expect(partitaStageScale({ width: 0, height: 0 }, { width: 0, height: 0 }, [word])).toBe(1);
    expect(partitaStageScale({ width: 1, height: 1 }, { width: 318, height: 384 }, [word])).toBeGreaterThan(0);
    expect(partitaStageScale({ width: 382, height: 314 }, { width: 318, height: 384 }, [])).toBe(1);
  });
});
