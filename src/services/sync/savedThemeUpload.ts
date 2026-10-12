import type { SongResult } from '../../types';
import { putRemoteThemes } from './syncClient';
import { assertSyncCurrent, type SyncConnection } from './syncConnection';
import { getSyncConfig, isSyncConfigured, setSyncStatus } from './syncConfig';
import { createSongSyncFingerprint } from './syncFingerprint';
import { readSavedThemeForSync } from './syncLocalStore';

// savedThemeUpload.ts — the desktop save-triggered upload policy, using already-committed mobile records and a bounded serial queue.
type Upload = (fingerprint: string, config: SyncConnection) => Promise<void>;
type ReportFailure = (config: SyncConnection) => void;
const reportFailure: ReportFailure = config => {
  try { assertSyncCurrent(config); setSyncStatus({ state: 'error', lastError: 'sync-upload-failed' }, config); }
  catch { /* Old connections and unavailable status storage must not undo a successful local edit. */ }
};
const upload: Upload = async (fingerprint, config) => {
  assertSyncCurrent(config);
  const record = await readSavedThemeForSync(fingerprint, config);
  if (!record) return; // The song/theme may have been removed before the queued upload starts.
  await putRemoteThemes(config, [record]);
  setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null }, config);
};

export class SavedThemeUploadQueue {
  private pending = new Map<string, { fingerprint: string; config: SyncConnection }>();
  private running: Promise<void> | null = null;
  constructor(private send: Upload = upload, private failed: ReportFailure = reportFailure) {}
  enqueue(fingerprint: string, config: SyncConnection): Promise<void> {
    if (!fingerprint || !config.nativeSession || !isSyncConfigured(config)) return Promise.resolve();
    try { assertSyncCurrent(config); } catch { return Promise.resolve(); }
    const key = `${config.nativeSession.scope}\0${fingerprint}`;
    if (this.pending.size >= 128 && !this.pending.has(key)) {
      this.failed(config); // Local registry remains the retry source for the next startup/manual sync.
      return Promise.resolve();
    }
    this.pending.set(key, { fingerprint, config });
    if (!this.running) this.running = Promise.resolve().then(() => this.drain());
    return this.running;
  }
  private async drain() {
    try {
      while (this.pending.size) {
        const [key, entry] = this.pending.entries().next().value!;
        this.pending.delete(key);
        try { assertSyncCurrent(entry.config); await this.send(entry.fingerprint, entry.config); }
        catch { this.failed(entry.config); }
      }
    } finally {
      // Clear synchronously when the queue empties so an enqueue during promise settlement starts a new drain.
      this.running = null;
    }
  }
}
const savedThemeUploads = new SavedThemeUploadQueue();
export function scheduleSavedThemeUpload(song: SongResult, config = getSyncConfig()) {
  const fingerprint = createSongSyncFingerprint(song);
  if (fingerprint) void savedThemeUploads.enqueue(fingerprint, config);
}
