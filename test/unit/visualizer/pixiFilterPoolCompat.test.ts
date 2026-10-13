import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import * as pixi from 'pixi.js';
import { installPixiFilterPoolCompat } from '@/components/visualizer/pixiFilterPoolCompat';

// test/unit/visualizer/pixiFilterPoolCompat.test.ts
// Exercise real Pixi pools and bind groups without needing a WebGL context.
type FilterSystem = pixi.FilterSystem & { init: () => void };
const SCREEN = 991001;
const OTHER_SCREEN = 991002;
let systems: FilterSystem[];
let warn: MockInstance<typeof console.warn>;

/** Simulates the last filter pass with the actual texture and sampler change listeners. */
const createSystem = () => {
    const system = new pixi.FilterSystem({} as pixi.WebGLRenderer) as FilterSystem;
    system.init();
    systems.push(system);
    const group = (system as unknown as { _globalFilterBindGroup: pixi.BindGroup })._globalFilterBindGroup;
    const bind = (texture: pixi.Texture) => {
        group.setResource(texture.source, 1);
        group.setResource(texture.source.style, 2);
        group.setResource(texture.source, 3);
    };
    return { system, group, bind };
};

const expectUnbound = (group: pixi.BindGroup) => {
    expect(group.getResource(1)).toBe(pixi.Texture.EMPTY.source);
    expect(group.getResource(2)).toBe(pixi.Texture.EMPTY.source.style);
    expect(group.getResource(3)).toBe(pixi.Texture.EMPTY.source);
};

type FilterFrame = { inputTexture: pixi.Texture | null; backTexture: pixi.Texture | null };
type FilterStack = {
    _filterStackIndex: number;
    _pushFilterData(): FilterFrame;
    _popFilterData(): FilterFrame;
    _findFilterResolution(root: number): number;
};

describe('Pixi 8.21.0 filter pool compatibility', () => {
    beforeAll(() => installPixiFilterPoolCompat(pixi));
    beforeEach(() => {
        systems = [];
        pixi.TexturePool.clear();
        pixi.TexturePool.setScreenSize(SCREEN, 301, 201);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        systems.forEach(system => system.destroy());
        pixi.TexturePool.removeScreen(SCREEN);
        pixi.TexturePool.removeScreen(OTHER_SCREEN);
        pixi.TexturePool.clear();
        const boundWarnings = warn.mock.calls.filter(args => args.join(' ').includes('destroyed while still bound'));
        warn.mockRestore();
        expect(boundWarnings).toEqual([]);
    });

    it.each([
        ['resize', () => pixi.TexturePool.setScreenSize(SCREEN, 347, 229)],
        ['resolution change', () => pixi.TexturePool.setScreenSize(SCREEN, 602, 402)],
        ['renderer removal', () => pixi.TexturePool.removeScreen(SCREEN)],
        ['pool clear', () => pixi.TexturePool.clear()],
    ])('unbinds textures and samplers before %s destroys idle textures', (_, prune) => {
        const { group, bind } = createSystem();
        const texture = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        bind(texture);
        pixi.TexturePool.returnTexture(texture);

        prune();

        expect(texture.destroyed).toBe(true);
        expectUnbound(group);
    });

    it('unbinds every live filter system when a shared screen bucket is pruned', () => {
        pixi.TexturePool.setScreenSize(OTHER_SCREEN, 600, 400);
        const first = createSystem();
        const second = createSystem();
        const texture = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        first.bind(texture);
        second.bind(texture);
        pixi.TexturePool.returnTexture(texture);

        pixi.TexturePool.removeScreen(SCREEN);

        expect(texture.destroyed).toBe(true);
        expectUnbound(first.group);
        expectUnbound(second.group);
    });

    it('releases a checked-out texture returned after its bucket was pruned', () => {
        const { group, bind } = createSystem();
        const texture = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        pixi.TexturePool.setScreenSize(SCREEN, 347, 229);
        expect(texture.destroyed).toBe(false);
        bind(texture);

        pixi.TexturePool.returnTexture(texture);

        expect(texture.destroyed).toBe(true);
        expectUnbound(group);
    });

    it('keeps normal texture returns and retained power-of-two buckets bound', () => {
        const { group, bind } = createSystem();
        const texture = pixi.TexturePool.getOptimalTexture({ width: 128, height: 128 });
        bind(texture);
        const setResource = vi.spyOn(group, 'setResource');

        pixi.TexturePool.returnTexture(texture);
        pixi.TexturePool.setScreenSize(SCREEN, 347, 229);

        expect(setResource).not.toHaveBeenCalled();
        expect(texture.destroyed).toBe(false);
        expect(group.getResource(1)).toBe(texture.source);
        setResource.mockRestore();
    });

    it('destroys filter bind groups and removes their listeners when the renderer is destroyed', () => {
        const source = pixi.Texture.EMPTY.source;
        const before = [source.listenerCount('change'), source.style.listenerCount('change')];
        const { system, group } = createSystem();
        pixi.TexturePool.returnTexture(pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 }));
        pixi.TexturePool.clear();
        expect(source.listenerCount('change')).toBe(before[0]! + 2);
        expect(source.style.listenerCount('change')).toBe(before[1]! + 1);

        system.destroy();
        systems = [];
        expect(group.resources).toBeNull();
        expect([source.listenerCount('change'), source.style.listenerCount('change')]).toEqual(before);
        // Clearing again must not revisit the destroyed group.
        pixi.TexturePool.returnTexture(pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 }));
        expect(() => pixi.TexturePool.clear()).not.toThrow();
    });

    it('installs once and leaves other Pixi versions untouched', () => {
        const init = (pixi.FilterSystem.prototype as FilterSystem).init;
        const returnTexture = pixi.TexturePool.returnTexture;
        installPixiFilterPoolCompat(pixi);
        expect((pixi.FilterSystem.prototype as FilterSystem).init).toBe(init);
        expect(pixi.TexturePool.returnTexture).toBe(returnTexture);

        const OtherFilterSystem = class { init = vi.fn(); };
        const otherPixi = { ...pixi, VERSION: '8.22.0', FilterSystem: OtherFilterSystem } as unknown as typeof pixi;
        installPixiFilterPoolCompat(otherPixi);
        expect(Object.getOwnPropertySymbols(OtherFilterSystem.prototype)).toEqual([]);
    });

    it.each([
        ['resize', () => pixi.TexturePool.setScreenSize(SCREEN, 347, 229)],
        ['resolution change', () => pixi.TexturePool.setScreenSize(SCREEN, 602, 402)],
        ['renderer removal', () => pixi.TexturePool.removeScreen(SCREEN)],
        ['pool clear', () => pixi.TexturePool.clear()],
    ])('does not reuse a destroyed nested filter texture after %s', (_, prune) => {
        const stack = createSystem().system as unknown as FilterStack;
        const texture = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        stack._pushFilterData();
        const frame = stack._pushFilterData();
        frame.inputTexture = texture;
        stack._popFilterData(); stack._popFilterData();
        pixi.TexturePool.returnTexture(texture);
        prune();

        expect(texture.destroyed).toBe(true);
        stack._pushFilterData(); stack._pushFilterData();
        // Pixi reads the reused slot before assigning its new input texture on the next draw.
        expect(() => stack._findFilterResolution(1.5)).not.toThrow();
        expect(stack._findFilterResolution(1.5)).toBe(1.5);
        expect(frame.inputTexture).toBeNull();
    });

    it('preserves checked-out parent textures when an idle nested frame is pruned', () => {
        const stack = createSystem().system as unknown as FilterStack;
        const parent = stack._pushFilterData(), child = stack._pushFilterData();
        const live = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        const idle = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        parent.inputTexture = live; child.inputTexture = idle;
        stack._popFilterData();
        pixi.TexturePool.returnTexture(idle);
        pixi.TexturePool.setScreenSize(SCREEN, 347, 229);

        expect(parent.inputTexture).toBe(live);
        expect(live.destroyed).toBe(false);
        expect(child.inputTexture).toBeNull();
        stack._popFilterData(); pixi.TexturePool.returnTexture(live);
        expect(parent.inputTexture).toBeNull();
    });

    it('returning an orphaned backdrop keeps the input alive until its own return', () => {
        const stack = createSystem().system as unknown as FilterStack;
        const frame = stack._pushFilterData();
        const input = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        const backdrop = pixi.TexturePool.getOptimalTexture({ width: 301, height: 201 });
        frame.inputTexture = input; frame.backTexture = backdrop;
        pixi.TexturePool.setScreenSize(SCREEN, 347, 229);
        stack._popFilterData();
        pixi.TexturePool.returnTexture(backdrop);

        expect(frame.backTexture).toBeNull();
        expect(frame.inputTexture).toBe(input);
        expect(input.destroyed).toBe(false);
        // This order mirrors FilterSystem.pop: backdrop first, then input.
        pixi.TexturePool.returnTexture(frame.inputTexture!);
        expect(frame.inputTexture).toBeNull();
        expect(input.destroyed).toBe(true);
    });
});
