import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectNativeModels, type NativeModelsState } from '../../../src/mobile/nativeModels';

// nativeModels.test.ts — event ordering and disposal, without pretending this executes native inference.
const state = (revision: number): NativeModelsState => ({ revision, ready: true, analysisAvailable: true, models: [],
  capabilities: { beatGrid: false, stems: false, full: false, desktop: false } });
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
afterEach(() => vi.unstubAllGlobals());
describe('native model status', () => {
  it('keeps newer revisions and ignores late read failures', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    const report = vi.fn(), failed = vi.fn(), remove = vi.fn();
    const replies = Array.from({ length: 4 }, () => deferred<NativeModelsState>());
    let index = 0;
    const port = { getModels: vi.fn(() => replies[index++].promise), addListener: vi.fn(async () => ({ remove })) };
    const connection = connectNativeModels(port, report, failed);
    await Promise.resolve();
    replies[1].resolve(state(8)); await Promise.resolve(); await Promise.resolve();
    replies[0].resolve(state(2)); await Promise.resolve();
    expect(report.mock.calls.map(([value]) => value.revision)).toEqual([8]);
    const old = connection.refresh(), next = connection.refresh();
    replies[3].resolve(state(9)); await next; replies[2].reject(new Error('old read')); await old;
    expect(failed).not.toHaveBeenCalled(); expect(report).toHaveBeenLastCalledWith(state(9));
    connection.dispose(); await Promise.resolve(); expect(remove).toHaveBeenCalledOnce();
  });
  it('removes a late listener and does not restart reads after disposal', async () => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    const registration = deferred<{ remove: () => Promise<void> }>(), reply = deferred<NativeModelsState>();
    const report = vi.fn(), remove = vi.fn(async () => {}), failed = vi.fn();
    const port = { getModels: vi.fn(() => reply.promise), addListener: vi.fn(() => registration.promise) };
    const connection = connectNativeModels(port, report, failed); connection.dispose();
    registration.resolve({ remove }); reply.resolve(state(5));
    await Promise.resolve(); await Promise.resolve();
    expect(report).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledOnce(); expect(port.getModels).toHaveBeenCalledOnce();
  });
});
