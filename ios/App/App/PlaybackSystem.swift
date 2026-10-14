import AVFoundation
import MediaPlayer
import UIKit
import Network

// PlaybackSystem.swift — lock-screen, interruption, route and foreground reconciliation.
extension PlaybackEngine {
    func command(_ action: String, position: Double? = nil, mode: String? = nil) throws {
        launchResume = .finished
        sleepTimer.reconcile()
        switch action {
        case "play":
            guard currentSong != nil else {
                if !queue.isEmpty { intentToPlay = true; select(0) }
                return
            }
            intentToPlay = true
            if usesStereoOutput {
                if let stream, !stream.hasEnded, !stream.hasFailed, error == nil {
                    observeStream(stream, epoch: generation)
                    try activate(); try resumeStream(stream)
                    if preparedStream == nil { prefetch() }
                } else {
                    // Retry at the live/seek position; a naturally finished song is replayed from the beginning.
                    let position = stream?.hasEnded == true ? 0 : playbackPosition
                    select(index, position: position)
                }
                break
            }
            if player.currentItem == nil || player.currentItem?.status == .failed || error != nil { select(index, position: restoredPosition) }
            else {
                if let item = player.currentItem { observeStatus(item, epoch: generation) }
                try activate(); player.play()
            }
        case "pause": personalFM.cancelPending(); pauseWithFade()
        case "next": personalFM.cancelSelection(); failures = 0; move(1)
        case "previous": personalFM.cancelSelection(); failures = 0; move(-1)
        case "seek":
            guard let position, position.isFinite, position >= 0 else { throw MobileFailure("invalid-position") }
            personalFM.cancelSelection()
            playbackFade?.flush(); playbackFadeToken = nil
            let duration = playbackDuration, target = duration > 0 ? min(position, duration) : position
            if usesStereoOutput {
                if let stream {
                    guard stream.audio.isSeekable else { throw MobileFailure("unsupported-seek") }
                    listening.seek(from: playbackPosition, to: target)
                    crossfade?.cancel(preservingAnalysis: true); try stream.seek(to: target)
                    if preparedStream == nil { prefetch() }
                } else { restoredPosition = target }
            } else if player.currentItem == nil { restoredPosition = target }
            else {
                listening.seek(from: playbackPosition, to: target)
                let ticket = UUID(), epoch = generation; listeningSeek = ticket
                player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) {
                    [weak self] _ in DispatchQueue.main.async {
                        guard let self, self.generation == epoch, self.listeningSeek == ticket else { return }
                        self.listeningSeek = nil; self.listening.discontinuity(); self.publish()
                    }
                }
            }
        case "repeat":
            guard let mode, ["off", "all", "one"].contains(mode) else { throw MobileFailure("invalid-repeat") }
            repeatMode = mode; discardPrepared(); prefetch()
        default: throw MobileFailure("invalid-command")
        }
        persist(); publish()
    }
    func setupSystem() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
            self?.crossfade?.resourcePressure(true)
        })
        observers.append(center.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.crossfade?.resourcePressure(ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue)
        })
        crossfade?.resourcePressure(ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue)
        observers.append(center.addObserver(forName: .AVPlayerItemPlaybackStalled, object: nil, queue: .main) { [weak self] note in
            guard let self, let item = note.object as? AVPlayerItem,
                  item === self.observedItem, item === self.player.currentItem else { return }
            let epoch = self.generation
            self.stalledRecovery?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self, epoch == self.generation, self.intentToPlay, self.player.timeControlStatus != .playing else { return }
                self.failed(MobileFailure("network"), epoch: epoch)
            }
            self.stalledRecovery = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: work)
        })
        observers.append(center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            guard let self, let item = note.object as? AVPlayerItem,
                  item === self.observedItem else { return }
            self.finishListeningOccurrence(ended: true)
            self.failures = 0
            if self.prepared == nil { self.move(1, automatic: true) }
        })
        observers.append(center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            guard let self, let item = note.object as? AVPlayerItem,
                  item === self.observedItem, item === self.player.currentItem else { return }
            self.failed(MobileFailure("audio-failed"), epoch: self.generation)
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self, let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
            if type == AVAudioSession.InterruptionType.began.rawValue {
                self.launchResume = .finished
                self.resumeAfterInterruption = self.intentToPlay
                self.intentToPlay = false; self.pauseOutput(); self.publish()
            } else {
                self.sleepTimer.reconcile()
                let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                if self.resumeAfterInterruption && AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) {
                    do { try self.command("play") } catch { self.stop("audio-session") }
                }
                self.resumeAfterInterruption = false
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            if (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                guard let self else { return }
                self.launchResume = .finished
                self.personalFM.cancelPending(); self.intentToPlay = false
                self.resumeAfterInterruption = false; self.networkResume = nil
                self.pauseOutput(); self.persist(); self.publish()
            }
        })
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.persist() })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.crossfade?.resourcePressure(ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue)
            self?.listening.retryUnavailable()
            self?.sleepTimer.reconcile(); self?.publish()
            Task { @MainActor [weak self] in self?.resumeLaunchPlaybackIfReady() }
        })
        let remote = MPRemoteCommandCenter.shared()
        for (command, action) in [(remote.playCommand, "play"), (remote.pauseCommand, "pause"),
                                  (remote.nextTrackCommand, "next"), (remote.previousTrackCommand, "previous"),
                                  (remote.togglePlayPauseCommand, "toggle")] {
            command.isEnabled = true
            let target = command.addTarget { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self else { return }
                    do { try self.command(action == "toggle" ? (self.intentToPlay ? "pause" : "play") : action) }
                    catch { self.stop("audio-session") }
                }
                return .success
            }
            remoteTargets.append((command, target))
        }
        remote.changePlaybackPositionCommand.isEnabled = true
        let target = remote.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            DispatchQueue.main.async { try? self?.command("seek", position: event.positionTime) }
            return .success
        }
        remoteTargets.append((remote.changePlaybackPositionCommand, target))
    }
    func setupNetwork() {
        network.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.networkChanged(connected: path.status == .satisfied)
            }
        }
        network.start(queue: DispatchQueue(label: "app.folia.network"))
    }
    func networkChanged(connected: Bool) {
        sleepTimer.reconcile()
        if connected { listening.retryUnavailable() }
        // A decoder's complete cache lease remains playable even after the cache index is cleared.
        let hasOfflineSource = currentIsLocal || (usesStereoOutput && stream?.cachedMedia != nil)
        if !connected && intentToPlay && !hasOfflineSource {
            let pending = playbackPosition
            stop("network"); networkResume = pending
        } else if connected, let pending = networkResume {
            networkResume = nil; intentToPlay = true
            select(index, refresh: true, position: pending)
        }
    }
    func updateNowPlaying() {
        artwork.update(currentSong, allowNetwork: intentToPlay || outputIsPlaying)
        guard let song = currentSong else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        let artists = (song["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }.joined(separator: " / ")
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: song["name"] as? String ?? "Folia",
            MPMediaItemPropertyArtist: artists,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: playbackPosition,
            MPMediaItemPropertyPlaybackDuration: playbackDuration,
            MPNowPlayingInfoPropertyPlaybackRate: usesStereoOutput ? (intentToPlay && outputIsPlaying ? (stream?.rate ?? 1) : 0.0) : Double(player.rate),
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue]
        if let image = artwork.image { info[MPMediaItemPropertyArtwork] = image }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
