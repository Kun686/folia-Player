import type { Page } from '@playwright/test';

// visualizer-lifecycle-probe.ts — test-only observations of stage-owned resources, not heap/GPU memory measurements.
export async function installVisualizerLifecycleProbe(page: Page) {
  await page.addInitScript(() => {
    const contexts: {
      canvas: WeakRef<HTMLCanvasElement>; gl: WeakRef<WebGLRenderingContext>; stage: boolean;
      programs: number; draws: number;
    }[] = [];
    const seenContexts = new WeakSet<WebGLRenderingContext>();
    const observations = new Map<ResizeObserver, Set<Element>>();
    const stageTargets = new WeakSet<Element>();
    const inStage = (target: Element) => !!target.closest('.lyric-stage');
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...options: unknown[]) {
      const result = Reflect.apply(getContext, this, [id, ...options]) as RenderingContext | null;
      if (['webgl', 'webgl2', 'experimental-webgl'].includes(id) && result) {
        const gl = result as WebGLRenderingContext;
        if (seenContexts.has(gl)) return result;
        seenContexts.add(gl);
        // A probe must not keep removed canvases or GL objects alive and cause context-limit failures itself.
        const entry = { canvas: new WeakRef(this), gl: new WeakRef(gl), stage: inStage(this), programs: 0, draws: 0 };
        contexts.push(entry);
        const programs = new WeakSet<WebGLProgram>();
        const create = gl.createProgram.bind(gl), remove = gl.deleteProgram.bind(gl);
        const arrays = gl.drawArrays.bind(gl), elements = gl.drawElements.bind(gl);
        gl.createProgram = () => {
          const program = create();
          if (program) { programs.add(program); entry.programs++; }
          return program;
        };
        gl.deleteProgram = program => {
          remove(program);
          if (program && programs.delete(program)) entry.programs--;
        };
        gl.drawArrays = (...args) => { entry.draws++; return arrays(...args); };
        gl.drawElements = (...args) => { entry.draws++; return elements(...args); };
      }
      return result;
    } as typeof getContext;
    const Observer = window.ResizeObserver;
    window.ResizeObserver = class extends Observer {
      observe(target: Element, options?: ResizeObserverOptions) {
        super.observe(target, options);
        if (inStage(target)) stageTargets.add(target);
        const targets = observations.get(this) ?? new Set<Element>();
        targets.add(target); observations.set(this, targets);
      }
      unobserve(target: Element) {
        super.unobserve(target); observations.get(this)?.delete(target);
      }
      disconnect() {
        super.disconnect(); observations.delete(this);
      }
    };
    (window as any).visualizerLifecycleSnapshot = () => {
      for (const entry of contexts) {
        const canvas = entry.canvas.deref(); if (canvas) entry.stage ||= inStage(canvas);
      }
      for (const targets of observations.values()) for (const target of targets) {
        if (inStage(target)) stageTargets.add(target);
      }
      const stageContexts = contexts.filter(entry => entry.stage);
      const live = (entry: typeof contexts[number]) => entry.gl.deref()?.isContextLost() === false;
      return {
        createdStageContexts: stageContexts.length,
        liveStageContexts: stageContexts.filter(live).length,
        // Some renderers delete their programs without forcing context loss. Both are valid teardown paths.
        liveStagePrograms: stageContexts.reduce((count, entry) => count + (live(entry) ? entry.programs : 0), 0),
        stageDraws: stageContexts.reduce((count, entry) => count + entry.draws, 0),
        observedStageTargets: [...observations.values()].reduce((count, targets) =>
          count + [...targets].filter(target => stageTargets.has(target)).length, 0),
        canvases: document.querySelectorAll('.lyric-stage canvas').length,
        audioRequests: (window as any).visualizerAudioRequests ?? 0,
      };
    };
  });
}

export async function observeVisualizerAudio(page: Page) {
  await page.evaluate(() => {
    const win = window as any;
    const original = win.Capacitor.nativePromise;
    win.visualizerAudioRequests = 0;
    win.Capacitor.nativePromise = (...args: unknown[]) => {
      if (args[1] === 'audioLevels') win.visualizerAudioRequests++;
      return original(...args);
    };
  });
}

export const visualizerLifecycleSnapshot = (page: Page) => page.evaluate(() =>
  (window as any).visualizerLifecycleSnapshot() as {
    createdStageContexts: number; liveStageContexts: number; observedStageTargets: number;
    canvases: number; audioRequests: number; liveStagePrograms: number; stageDraws: number;
  });
