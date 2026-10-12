import type { Album, Artist, SongResult } from '../types';
import type { OnlineGridViewCollectionDescriptor } from '../library/core/contracts/collection';
import { resolveSongCatalogRef } from '../services/onlineMusic/catalogRefs';

// onlineCatalog.ts — retain the original provider's canonical album/artist identity.
export type OnlineCatalogTarget = { song: SongResult; kind: 'album' | 'artist'; entity: Album | Artist }
  | { collection: OnlineGridViewCollectionDescriptor };
export async function resolveOnlineCatalog(target: OnlineCatalogTarget): Promise<OnlineGridViewCollectionDescriptor> {
  if ('collection' in target) return target.collection;
  const { sourceRef } = target.song;
  if (sourceRef?.kind !== 'online') throw new Error('catalog-unavailable');
  const ref = await resolveSongCatalogRef({ ...target.song, sourceRef }, target.kind, target.entity);
  if (!ref) throw new Error('catalog-unavailable');
  return { source: 'online', providerId: ref.providerId, id: ref.id, type: ref.kind, name: target.entity.name };
}
