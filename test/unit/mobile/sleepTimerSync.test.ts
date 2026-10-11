import { describe, expect, it, vi } from 'vitest';
import { createSleepTimerSync } from '../../../src/mobile/sleepTimerSync';
import type { NativeSleepTimerState } from '../../../src/mobile/bridge';

// sleepTimerSync.test.ts — asynchronous event/ack ordering and expiry while editing.
const value = (revision = 0): NativeSleepTimerState => ({ hours: 0, minutes: 5, enabled: true, deadlineMs: 300000, revision });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
describe('native sleep timer synchronization', () => {
  it('loads without activating and ignores an older foreground snapshot', async () => {
    const save = vi.fn(), report = vi.fn();
    const sync = createSleepTimerSync({ load: async () => value(), save }, report);
    await sync.refresh(); expect(save).not.toHaveBeenCalled();
    sync.receive({ ...value(2), enabled: false, deadlineMs: null });
    sync.receive(value(1)); expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, revision: 2 }), false);
    sync.dispose();
  });
  it('coalesces rapid edits but never sends the old enabled flag with a duration', async () => {
    let finish!: (state: NativeSleepTimerState) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ ...value(4), minutes: 9, enabled: false, deadlineMs: null });
    const report = vi.fn(), sync = createSleepTimerSync({ load: async () => value(), save }, report);
    await sync.refresh(); sync.change({ minutes: 6 }); sync.change({ minutes: 8 }); sync.change({ minutes: 9 });
    sync.receive({ ...value(3), enabled: false, deadlineMs: null });
    finish({ ...value(1), minutes: 6 }); await flush();
    expect(save.mock.calls).toEqual([[{ minutes: 6 }], [{ minutes: 9 }]]);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, minutes: 9 }), false); sync.dispose();
  });
  it('retains a later cancel after a rejected earlier edit', async () => {
    let fail!: (error: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }))
      .mockResolvedValue({ ...value(1), enabled: false, deadlineMs: null });
    const report = vi.fn(), sync = createSleepTimerSync({ load: async () => value(), save }, report);
    await sync.refresh(); sync.change({ minutes: 10 }); sync.change({ enabled: false });
    fail(Error('offline')); await flush();
    expect(save).toHaveBeenLastCalledWith({ enabled: false });
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ minutes: 5, enabled: false }), false); sync.dispose();
  });
  it('rolls back failed edits and never writes after disposal or a failed load', async () => {
    const save = vi.fn().mockRejectedValue(Error('unavailable')), report = vi.fn();
    const sync = createSleepTimerSync({ load: async () => value(), save }, report);
    await sync.refresh(); sync.change({ minutes: 10 }); await flush();
    expect(report).toHaveBeenLastCalledWith(value(), true);
    sync.dispose(); sync.change({ enabled: false }); expect(save).toHaveBeenCalledTimes(1);
    const empty = createSleepTimerSync({ load: async () => { throw Error(); }, save }, report);
    await empty.refresh(); empty.change({ enabled: true }); expect(save).toHaveBeenCalledTimes(1); empty.dispose();
  });
});
