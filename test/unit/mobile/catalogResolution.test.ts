import { beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '../../../src/services/onlineMusic/omni';
import { resolveOnlineCatalog } from '../../../src/mobile/onlineCatalog';
import type { ProviderCollection } from '../../../src/types/onlineMusic';

// catalogResolution.test.ts — recommendation cards must obtain canonical ownership before actions become available.
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: { getCollectionDetail: vi.fn() } }));
const collection = { source: 'online' as const, providerId: 'netease', type: 'playlist', id: 8, name: 'Card' };
const detail: ProviderCollection = { ...collection, name: 'Detail', creator: { id: 9, nickname: 'Owner' } };
beforeEach(() => vi.clearAllMocks());
describe('mobile collection resolution', () => {
  it('resolves the card through Omni and retains canonical creator and identity', async () => {
    vi.mocked(omni.getCollectionDetail).mockResolvedValue(detail);
    expect(await resolveOnlineCatalog({ collection })).toEqual({ ...detail, source: 'online' });
    expect(omni.getCollectionDetail).toHaveBeenCalledExactlyOnceWith(collection);
  });
  it.each([null, { ...detail, providerId: 'qq' }, { ...detail, id: 9 }, { ...detail, type: 'album' },
    { ...detail, creator: undefined }, ...[0, '0', ''].map(id => ({ ...detail, creator: { id, nickname: '' } }))])('rejects unknown ownership or mismatched detail %j', async value => {
    vi.mocked(omni.getCollectionDetail).mockResolvedValue(value);
    await expect(resolveOnlineCatalog({ collection })).rejects.toThrow('catalog-unavailable');
  });
  it('does not add a playlist lookup to existing album navigation', async () => {
    const album = { ...collection, type: 'album' };
    expect(await resolveOnlineCatalog({ collection: album })).toBe(album); expect(omni.getCollectionDetail).not.toHaveBeenCalled();
  });
});
