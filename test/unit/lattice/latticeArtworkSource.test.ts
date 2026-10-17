import { describe, expect, it, vi } from 'vitest';
import { createLatticeArtworkSource } from '../../../src/components/app/lattice/latticeArtworkSource';
import type { SongResult } from '../../../src/types';

// latticeArtworkSource.test.ts — resource leases only, not provider or audio acceptance.
const songs = [
    ['001fsNdn1zuZnA', '我不难过'], ['000BO3xy4fd8BJ', '我怀念的'], ['001WsiXr4FYlao', '我想我不会爱你'],
].map(([id, name]) => ({ id, name, artists: [], album: { id: '', name: '' }, durationMs: 0,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: id } } as SongResult));
const deferred = () => { let resolve!: (url: string | null) => void; const promise = new Promise<string | null>(r => { resolve = r; }); return { promise, resolve }; };

describe('wall artwork leases', () => {
    it('shows disk hits while both network slots are blocked by misses', async () => {
        const jobs = [deferred(), deferred()]; let index = 0;
        const load = vi.fn(() => jobs[index++].promise);
        const source = createLatticeArtworkSource(load, async song => song === songs[2] ? 'data:image/jpeg;base64,cached' : null);
        const a = source.acquire(songs[0]), b = source.acquire(songs[1]), c = source.acquire(songs[2]);
        expect(await c.promise).toBe('data:image/jpeg;base64,cached');
        await Promise.resolve(); expect(load).toHaveBeenCalledTimes(2);
        a.release(); b.release(); c.release();
        jobs[0].resolve(null); jobs[1].resolve(null); await Promise.all([a.promise, b.promise]);
    });
    it('deduplicates visible instances and releases an owned URL only after the final lease', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const load = vi.fn().mockResolvedValue('blob:cover');
        const source = createLatticeArtworkSource(load);
        const a = source.acquire(songs[0]), b = source.acquire(songs[0]);
        expect(await a.promise).toBe('blob:cover'); expect(await b.promise).toBe('blob:cover');
        expect(load).toHaveBeenCalledTimes(1);
        a.release(); a.release(); expect(revoke).not.toHaveBeenCalled();
        b.release(); expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:cover');
        revoke.mockRestore();
    });
    it('limits native work to two, dropping queued cards that leave the viewport', async () => {
        const jobs = [deferred(), deferred()]; let index = 0;
        const load = vi.fn(() => jobs[index++].promise);
        const source = createLatticeArtworkSource(load);
        const a = source.acquire(songs[0]), b = source.acquire(songs[1]), c = source.acquire(songs[2]);
        await Promise.resolve(); expect(load).toHaveBeenCalledTimes(2);
        c.release(); expect(await c.promise).toBeNull();
        jobs[0].resolve('data:image/jpeg;base64,a'); jobs[1].resolve(null);
        await Promise.all([a.promise, b.promise]); expect(load).toHaveBeenCalledTimes(2);
        a.release(); b.release();
    });
    it('continues after failure and discards late results from released cards', async () => {
        const late = deferred(); const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const load = vi.fn().mockRejectedValueOnce(Error('cover-unavailable')).mockReturnValueOnce(late.promise).mockResolvedValueOnce('data:image/jpeg;base64,c');
        const source = createLatticeArtworkSource(load);
        const a = source.acquire(songs[0]), b = source.acquire(songs[1]), c = source.acquire(songs[2]);
        b.release(); expect(await a.promise).toBeNull();
        expect(await c.promise).toBe('data:image/jpeg;base64,c');
        late.resolve('blob:late'); expect(await b.promise).toBeNull();
        expect(revoke).toHaveBeenCalledWith('blob:late'); a.release(); c.release(); revoke.mockRestore();
    });
});
