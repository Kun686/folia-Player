import UIKit

// PlaybackLaunchResume.swift — the original opt-in launch intent, independent of WebView reloads.
enum PlaybackLaunchState { case idle, pending, finished }

extension PlaybackEngine {
    // The host calls this once after wiring its native services. Library reconciliation may still be pending.
    @MainActor func prepareLaunchPlayback() {
        guard launchResume == .idle else { return }
        launchResume = audioSettings.autoPlayOnLaunch && currentSong != nil ? .pending : .finished
        resumeLaunchPlaybackIfReady()
    }

    @MainActor func resumeLaunchPlaybackIfReady() {
        guard launchResume == .pending, launchLibraryReady, launchIsActive() else { return }
        // Reconcile first: an expired sleep timer may cancel the pending launch via its pause command.
        sleepTimer.reconcile()
        guard launchResume == .pending else { return }
        launchResume = .finished
        guard audioSettings.autoPlayOnLaunch, currentSong != nil, !intentToPlay else { return }
        do { try command("play") }
        catch { stop((error as? MobileFailure)?.code ?? "audio-session") }
    }
}
