import type { ProviderCollection, ProviderUser } from '../types/onlineMusic';
import type { omni } from '../services/onlineMusic/omni';
import { createHomeFeedResource, loadAllFavoriteAlbums } from '../library/core/services/onlineHomeFeeds';

// mobileAccountLibrary.ts — original account feeds, explicitly routed and scoped to the opening session.
export type AccountLibraryKind = 'albums' | 'cloud';
export function createMobileAccountLibrary(provider: string, user: ProviderUser, kind: AccountLibraryKind,
  api: Pick<typeof omni, 'getProviderUserAlbums' | 'getProviderCloudCollection'>, sameSession: () => boolean) {
  const resource = createHomeFeedResource<ProviderCollection[]>({
    label: 'account library', empty: [],
    load: async (_owner, current) => {
      const check = () => {
        if (!sameSession()) { resource.setOwner(null); throw new DOMException('Session changed', 'AbortError'); }
        if (!current()) throw new DOMException('View closed', 'AbortError');
      };
      try {
        check();
        const collections = kind === 'albums' ? await loadAllFavoriteAlbums({
          getUserAlbums: async (userId, page) => {
            check();
            const result = await api.getProviderUserAlbums(provider, userId, page);
            check(); return result;
          },
        }, user.id, () => current() && sameSession()) : [await api.getProviderCloudCollection(provider, user)].filter((item): item is ProviderCollection => !!item);
        check(); return collections;
      } catch {
        check();
        // Original feed diagnostics must never receive raw responses or session-bearing transport errors.
        throw new Error('account-library-unavailable');
      }
    },
  });
  resource.setOwner({ providerId: provider, userId: user.id });
  return resource;
}
