import UIKit

// PlaybackStreaming.swift — Folia's identity queue, independently cancellable buffers and one shared audio output.
extension PlaybackEngine {
    func selectStream(_ target: Int, refresh: Bool, position: Double) {
        guard let song = queue.indices.contains(target) ? queue[target] : (target == -1 ? detachedSong : nil) else { return }
        generation += 1; let epoch = generation
        task?.cancel(); preload?.cancel(); stalledRecovery?.cancel(); stalledRecovery = nil; networkResume = nil
        let cache = preparedStream
        preparedStream = nil
        let reusable = !refresh && position == 0 && cache?.index == target && Date().timeIntervalSince(cache!.at) < 120
            && cache?.entry.hasFailed == false
        let cached = reusable ? cache?.entry : nil
        if !reusable { cache?.entry.dispose() }
        clearOutput()
        index = target; detachedSong = song; restoredPosition = position; error = nil
        if !refresh { retried = false }
        publish()
        task = Task { @MainActor [weak self] in
            guard let self else { cached?.dispose(); return }
            let background = UIApplication.shared.beginBackgroundTask(withName: "Folia stream resolve") { [weak self] in
                if self?.generation == epoch { self?.stop("network-timeout") }
            }
            defer { if background != .invalid { UIApplication.shared.endBackgroundTask(background) } }
            do {
                let output: StreamMixOutput
                if let existing = self.streamOutput { output = existing }
                else { output = try await StreamMixOutput.make() }
                guard epoch == self.generation, !Task.isCancelled else { cached?.dispose(); return }
                self.streamOutput = output
                output.configurationChanged = { [weak self, weak output] in
                    guard let self, let output, self.streamOutput === output else { return }
                    if self.intentToPlay && self.stream != nil {
                        do { try self.activate(); try output.start() }
                        catch { self.stop("audio-session") }
                    }
                    self.publish()
                }
                let entry: StreamOccurrence
                if let cached { entry = cached }
                else { entry = try await StreamOccurrence.prepare(url: self.resolve(song), position: position, output: output) }
                guard epoch == self.generation, !Task.isCancelled else { entry.dispose(); return }
                self.stream = entry; self.meter = entry.meter
                entry.apply(self.audioSettings)
                self.observeStream(entry, epoch: epoch)
                if self.intentToPlay { try self.activate(); try entry.play() }
                self.prefetch(); self.persist(); self.publish()
            } catch {
                cached?.dispose()
                if !Task.isCancelled { self.failed(error, epoch: epoch) }
            }
        }
    }

    func prefetchStream() {
        guard stream != nil, let output = streamOutput, let next = nextIndex(automatic: true), let song = queue.indices.contains(next) ? queue[next] : detachedSong else { return }
        preload?.cancel()
        let epoch = generation
        preload = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let entry = try await StreamOccurrence.prepare(url: self.resolve(song), output: output)
                guard epoch == self.generation, !Task.isCancelled else { entry.dispose(); return }
                self.preparedStream?.entry.dispose()
                self.preparedStream = (next, entry, Date())
            } catch { /* Active audio is preserved. Selecting this identity resolves it afresh. */ }
        }
    }

    func observeStream(_ entry: StreamOccurrence, epoch: Int) {
        entry.changed = { [weak self, weak entry] in
            guard let self, let entry, epoch == self.generation, self.stream === entry else { return }
            if self.intentToPlay && !entry.playing && !entry.hasEnded && !entry.hasFailed {
                if self.stalledRecovery == nil {
                    let recovery = DispatchWorkItem { [weak self, weak entry] in
                        guard let self, let entry, epoch == self.generation, self.stream === entry,
                              self.intentToPlay, !entry.playing else { return }
                        self.stalledRecovery = nil
                        self.failed(MobileFailure("network"), epoch: epoch)
                    }
                    self.stalledRecovery = recovery
                    DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: recovery)
                }
            } else { self.stalledRecovery?.cancel(); self.stalledRecovery = nil }
            self.publish()
        }
        entry.ended = { [weak self, weak entry] in
            guard let self, let entry, epoch == self.generation, self.stream === entry, self.intentToPlay else { return }
            self.failures = 0; self.move(1, automatic: true)
        }
        entry.failed = { [weak self, weak entry] in
            guard let self, let entry, epoch == self.generation, self.stream === entry else { return }
            self.failed(MobileFailure("audio-failed"), epoch: epoch)
        }
    }
}
