import Foundation

// PlaybackTransportFade.swift — transport intent around the original scheduler and actual decoder state.
extension PlaybackEngine {
    func makePlaybackFade() -> NativePlaybackFade? {
        try? NativePlaybackFade(enabled: { [weak self] in self?.audioSettings.playbackFadeEnabled == true },
            running: { [weak self] in
                guard let self, self.usesStereoOutput, let output = self.streamOutput else { return false }
                return output.running || self.preparingPlaybackFade
            }, ramp: { [weak self] value, seconds in self?.streamOutput?.unit.transportGain.ramp(to: value, seconds: seconds) })
    }
    func resumeStream(_ entry: StreamOccurrence) throws {
        // Only skip decoder resume while sound is still flowing; a route rebuild can stop the host mid-fade.
        if playbackFade?.cancelPendingPause() == true && outputIsPlaying { return }
        if outputIsPlaying { return }
        // A paused AVAudioEngine does not tick. Stage silence before starting its first render block.
        preparingPlaybackFade = true
        playbackFadeToken = playbackFade?.prepareFadeIn()
        preparingPlaybackFade = false
        do {
            try entry.play()
            finishPlaybackFadeIn()
        } catch {
            if let token = playbackFadeToken { playbackFade?.abortFadeIn(token) }
            playbackFadeToken = nil; throw error
        }
    }
    func finishPlaybackFadeIn() {
        guard intentToPlay, outputIsPlaying, let token = playbackFadeToken else { return }
        playbackFadeToken = nil; playbackFade?.runFadeIn(token)
    }
    func pauseWithFade() {
        let audible = outputIsPlaying || crossfade?.isFading == true
        intentToPlay = false; resumeAfterInterruption = false; networkResume = nil
        let epoch = generation
        if audible, playbackFade?.fadeOutThen({ [weak self] in
            guard let self, self.generation == epoch else { return }
            self.pauseOutput(preservingFade: true); self.persist(); self.publish()
        }) == true { return }
        pauseOutput()
    }
}
