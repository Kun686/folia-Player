import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { scopeR3fFrameReferences } from '../../../dev/mobile/r3fLoopLifetime';

// r3fLoopLifetime.test.ts — check actual vendor variable ownership and reject unreviewed source drift.
const require = createRequire(import.meta.url);
const source = readFileSync(join(dirname(require.resolve('@react-three/fiber/package.json')), 'dist/events-9ce18a08.esm.js'), 'utf8');
const names = new Set(['subscribers', 'subscription', 'state']);

function scratchScopes(code: string) {
  const file = parse(code, { sourceType: 'module' });
  const result: Record<string, string> = {};
  const collect = (statements: typeof file.program.body, owner: string) => {
    for (const statement of statements) {
      if (statement.type !== 'VariableDeclaration') continue;
      for (const declaration of statement.declarations) {
        if (declaration.id.type === 'Identifier' && names.has(declaration.id.name)) result[declaration.id.name] = owner;
      }
    }
  };
  collect(file.program.body, 'module');
  for (const statement of file.program.body) {
    if (statement.type === 'FunctionDeclaration' && statement.id && ['update', 'loop'].includes(statement.id.name)) {
      collect(statement.body.body, statement.id.name);
    }
  }
  return result;
}

// Execute the actual vendor frame functions with deterministic roots, clocks and scheduling.
function frameBehavior(code: string) {
  const temporaries = new Set([...names, 'running', 'useFrameInProgress', 'repeat', 'frame']);
  const statements = parse(code, { sourceType: 'module' }).program.body.filter(statement =>
    (statement.type === 'FunctionDeclaration' && statement.id && ['update', 'loop'].includes(statement.id.name)) ||
    (statement.type === 'VariableDeclaration' && statement.declarations.every(declaration =>
      declaration.id.type === 'Identifier' && temporaries.has(declaration.id.name))));
  const events: string[] = [];
  const makeState = (id: string, frames: number, priority = 0, active = true, xr = false) => {
    const state = {
      id, frameloop: 'demand', clock: { getDelta: () => 0.25, elapsedTime: 7, oldTime: 0 },
      scene: id, camera: `${id}-camera`,
      gl: { xr: { isPresenting: xr }, render: (scene: string, camera: string) => events.push(`render:${scene}:${camera}`) },
      internal: { frames, priority, active, subscribers: [] as unknown[] },
    };
    state.internal.subscribers = [0, 1].map(index => ({
      store: { getState: () => state },
      ref: { current: (received: typeof state, delta: number) => events.push(`frame:${received.id}:${index}:${delta}`) },
    }));
    return state;
  };
  const states = [makeState('normal', 2), makeState('manual', 1, 1),
    makeState('inactive', 10, 0, false), makeState('xr', 10, 0, true, true)];
  let request = 0;
  const runtime = runInNewContext(statements.map(statement => code.slice(statement.start!, statement.end!)).join('\n') +
    '\n({ loop, update })', {
    _roots: new Map(states.map(state => [state.id, { store: { getState: () => state } }])),
    requestAnimationFrame: () => ++request,
    cancelAnimationFrame: (id: number) => events.push(`cancel:${id}`),
    flushGlobalEffects: (type: string) => events.push(`effect:${type}`),
  }) as { loop: (time: number) => void; update: (time: number, state: ReturnType<typeof makeState>) => number };
  runtime.loop(1000); runtime.loop(1250);
  const manualClock = makeState('clock', 1);
  manualClock.frameloop = 'never';
  runtime.update(20, manualClock);
  return { events, remainingFrames: states.map(state => state.internal.frames),
    elapsedTime: manualClock.clock.elapsedTime, oldTime: manualClock.clock.oldTime };
}

describe('mobile R3F frame reference lifetime', () => {
  it('moves the actual frame temporaries from module ownership to their calls', () => {
    expect(scratchScopes(source)).toEqual({ subscribers: 'module', subscription: 'module', state: 'module' });
    expect(scratchScopes(scopeR3fFrameReferences(source))).toEqual({ subscribers: 'update', subscription: 'update', state: 'loop' });
  });
  it('refuses changed vendor source rather than applying a partial patch', () => {
    expect(() => scopeR3fFrameReferences(source + '\n')).toThrow('vendor source changed');
  });
  it('refuses a second patch application', () => {
    expect(() => scopeR3fFrameReferences(scopeR3fFrameReferences(source))).toThrow('vendor source changed');
  });
  it('preserves frame callbacks, multiple roots, demand cancellation, manual rendering and clocks', () => {
    const baseline = frameBehavior(source);
    expect(baseline.remainingFrames).toEqual([0, 0, 10, 10]);
    expect(baseline.events).toEqual([
      'effect:before', 'frame:normal:0:0.25', 'frame:normal:1:0.25', 'render:normal:normal-camera',
      'frame:manual:0:0.25', 'frame:manual:1:0.25', 'effect:after',
      'effect:before', 'frame:normal:0:0.25', 'frame:normal:1:0.25', 'render:normal:normal-camera',
      'effect:after', 'effect:tail', 'cancel:2', 'frame:clock:0:13', 'frame:clock:1:13', 'render:clock:clock-camera',
    ]);
    expect([baseline.elapsedTime, baseline.oldTime]).toEqual([20, 7]);
    expect(frameBehavior(scopeR3fFrameReferences(source))).toEqual(baseline);
  });
});
