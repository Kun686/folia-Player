import AVFoundation
import MediaPlayer
import UIKit
import Network

// PlaybackSystem.swift — lock-screen, interruption, route and foreground reconciliation.
extension PlaybackEngine {
    func command(_ action: String, position: Double? = nil, mode: String? = nil) throws {
        switch action {
        case "play":
            guard queue.indices.contains(index) else { return }
            intentToPlay = true
            if player.currentItem == nil || player.currentItem?.status == .failed || error != nil { select(index, position: restoredPosition); restoredPosition = 0 }
            else { try activate(); player.play() }
        case "pause": intentToPlay = false; resumeAfterInterruption = false; networkResume = nil; player.pause()
        case "next": failures = 0; move(1)
        case "previous":
            if finiteTime(player.currentTime()) > 3 { try command("seek", position: 0) }
            else { failures = 0; move(-1) }
        case "seek":
            guard let position, position.isFinite, position >= 0 else { throw MobileFailure("invalid-position") }
            let duration = finiteTime(player.currentItem?.duration ?? .zero)
            player.seek(to: CMTime(seconds: min(position, duration), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) {
                [weak self] _ in DispatchQueue.main.async { self?.publish() }
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
        observers.append(center.addObserver(forName: .AVPlayerItemPlaybackStalled, object: nil, queue: .main) { [weak self] note in
            guard let self, let item = note.object as? AVPlayerItem, item === self.player.currentItem else { return }
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
            self.failures = 0
            if self.prepared == nil { self.move(1, automatic: true) }
        })
        observers.append(center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            guard let self, let item = note.object as? AVPlayerItem, item === self.player.currentItem else { return }
            self.failed(MobileFailure("audio-failed"), epoch: self.generation)
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self, let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
            if type == AVAudioSession.InterruptionType.began.rawValue {
                self.resumeAfterInterruption = self.intentToPlay
                self.intentToPlay = false; self.player.pause(); self.publish()
            } else {
                let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                if self.resumeAfterInterruption && AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) {
                    do { try self.command("play") } catch { self.stop("audio-session") }
                }
                self.resumeAfterInterruption = false
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            if (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                try? self?.command("pause")
            }
        })
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.persist() })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.publish() })
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
                guard let self else { return }
                if path.status != .satisfied && self.intentToPlay {
                    let pending = (self.index, self.finiteTime(self.player.currentTime()))
                    self.stop("network")
                    self.networkResume = pending
                } else if path.status == .satisfied, let pending = self.networkResume {
                    self.networkResume = nil; self.intentToPlay = true
                    self.select(pending.index, position: pending.position)
                }
            }
        }
        network.start(queue: DispatchQueue(label: "app.folia.network"))
    }
    func updateNowPlaying() {
        guard queue.indices.contains(index) else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        let song = queue[index]
        let artists = (song["artists"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }.joined(separator: " / ")
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: song["name"] as? String ?? "Folia",
            MPMediaItemPropertyArtist: artists,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: finiteTime(player.currentTime()),
            MPMediaItemPropertyPlaybackDuration: finiteTime(player.currentItem?.duration ?? .zero),
            MPNowPlayingInfoPropertyPlaybackRate: player.rate,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue]
    }
}
