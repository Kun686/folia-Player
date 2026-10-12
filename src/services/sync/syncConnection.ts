import type { SyncProviderConfig } from './syncTypes';

// syncConnection.ts — optional native session, captured once per operation; desktop config remains a plain serializable value.
export interface SyncConnection extends SyncProviderConfig {
  nativeSession?: {
    hasToken: boolean;
    scope: string;
    assertCurrent(): void;
    request(path: string, init: RequestInit): Promise<Response>;
  };
}
export const assertSyncCurrent = (connection: SyncConnection) => connection.nativeSession?.assertCurrent();
export const syncStorageKey = (connection: SyncConnection, key: string) => connection.nativeSession
  ? `${key}:${connection.nativeSession.scope}` : key;
