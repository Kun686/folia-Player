import Foundation
import AVFoundation

// AudioEffectController.swift — bounded control/render handoff; slow preparation and retirement never run in process().
final class AudioEffectController {
    struct Status {
        let requested: UInt64, prepared: UInt64, applied: UInt64
        let available: Bool, pending: Bool
        let error: String?
    }
    private struct Request {
        let generation: UInt64, revision: UInt64, rate: Double, values: [String: Double], needsGraph: Bool
    }
    private final class Update {
        let request: Request, program: AudioEffectProgram, graph: AudioEffectGraph?
        init(request: Request, program: AudioEffectProgram, graph: AudioEffectGraph?) {
            self.request = request; self.program = program; self.graph = graph
        }
    }
    private let lock = NSLock()
    private let control = DispatchQueue(label: "app.folia.effects.control", qos: .userInitiated)
    private let build: (Double, [String: Double], AudioEffectProgram.Reuse) -> AudioEffectProgram?
    private var wake: DispatchSourceUserDataAdd!
    private let prepareOnDemand: Bool
    private var activated: Bool
    private var values = NativeEqualizerSettings.neutral
    private var rate: Double?
    private var generation: UInt64 = 0, revision: UInt64 = 0, built: UInt64 = 0, applied: UInt64 = 0
    private var activeGeneration: UInt64?
    private var scheduled = false
    private var error: String?
    private var ready: Update?, active: Update?, retired: Update?
    private var noiseLive = false, reverbLive = false
    // prepare/unprepare/process are serialized by the tap host. Only process mutates a live graph.
    private var renderGraph: AudioEffectGraph?

    init(prepareOnDemand: Bool = false,
         build: @escaping (Double, [String: Double], AudioEffectProgram.Reuse) -> AudioEffectProgram? = {
             AudioEffectProgram(rate: $0, values: $1, noise: $2.noise, reverb: $2.reverb, reusingCurves: $2.curves)
         }) {
        self.build = build; self.prepareOnDemand = prepareOnDemand; activated = !prepareOnDemand
        wake = DispatchSource.makeUserDataAddSource(queue: control)
        wake.setEventHandler { [weak self] in self?.prepareLatest() }
        wake.resume()
    }
    deinit {
        wake.cancel()
        let garbage = (renderGraph, ready, active, retired)
        control.async { withExtendedLifetime(garbage) {} }
    }
    var status: Status {
        lock.lock(); defer { lock.unlock() }
        return Status(requested: revision, prepared: built, applied: applied,
                      available: activeGeneration == generation && activeGeneration != nil,
                      pending: activated && rate != nil && applied != revision && error == nil, error: error)
    }
    var configuredValues: [String: Double] { lock.lock(); defer { lock.unlock() }; return values }
    @discardableResult func configure(_ values: [String: Double]) -> Bool {
        var settings = NativeEqualizerSettings(); settings.effects = values
        guard (try? settings.validate()) != nil else { return false }
        lock.lock()
        // Existing EQ-only playback remains an exact bypass until the first non-neutral effect request.
        // Once activated, neutral settings fade the running graph instead of abruptly discarding its tail.
        if values != self.values || (!activated && values != NativeEqualizerSettings.neutral) || error == "audio-effect-preparation-failed" {
            activated = true
            self.values = values; revision &+= 1
            if rate != nil { error = nil }
            scheduleLocked()
        }
        lock.unlock()
        return true
    }
    func prepare(rate: Double, channels: Int) {
        replaceFormat(rate: AudioEffectSources.validRate(rate) && channels == 2 ? rate : nil,
                      error: AudioEffectSources.validRate(rate) && channels == 2 ? nil : "unsupported-effect-format")
    }
    func unprepare() { replaceFormat(rate: nil, error: nil) }
    private func replaceFormat(rate: Double?, error: String?) {
        lock.lock()
        let previous = (renderGraph, ready, active, retired)
        renderGraph = nil; ready = nil; active = nil; retired = nil
        noiseLive = false; reverbLive = false
        generation &+= 1; revision &+= 1; applied = 0; activeGeneration = nil
        activated = !prepareOnDemand || values != NativeEqualizerSettings.neutral
        self.rate = rate; self.error = error
        scheduleLocked()
        lock.unlock()
        // Hold the final references until this block executes on the control queue.
        control.async { withExtendedLifetime(previous) {} }
    }
    private func scheduleLocked() {
        guard !scheduled else { return }
        scheduled = true
        // A single pre-created, coalescing source carries render-to-control notifications.
        // Unlike async { ... }, signalling it creates no callback-sized closure or work item.
        wake.add(data: 1)
    }
    private func prepareLatest() {
        while true {
            lock.lock()
            let garbage = retired; retired = nil
            guard activated, let rate, revision != built else {
                scheduled = false; lock.unlock(); withExtendedLifetime(garbage) {}; return
            }
            let request = Request(generation: generation, revision: revision, rate: rate, values: values,
                                  needsGraph: activeGeneration != generation)
            // A prepared graph with an older settings revision cannot be adopted anymore.
            // Reuse its unplayed material too, so editing a paused player does not repeatedly build IRs.
            let waiting = request.needsGraph && ready?.request.generation == generation ? ready?.program : nil
            let reuse = AudioEffectProgram.Reuse(curves: active?.program ?? waiting,
                noise: values["noise"]! > 0 ? (noiseLive ? active?.program.retainedNoise : waiting?.noise) : nil,
                reverb: values["space"]! > 0 ? (reverbLive ? active?.program.retainedReverb : waiting?.reverb) : nil)
            lock.unlock()
            withExtendedLifetime(garbage) {}
            let candidate = build(request.rate, request.values, reuse)
            let program = candidate.flatMap { $0.rate == request.rate && $0.values == request.values ? $0 : nil }
            let graph = request.needsGraph ? program.flatMap(AudioEffectGraph.init) : nil
            let update: Update? = program.flatMap { request.needsGraph && graph == nil ? nil : Update(request: request, program: $0, graph: graph) }
            lock.lock()
            if request.generation == generation && request.revision == revision {
                ready = update; built = revision
                error = update == nil ? "audio-effect-preparation-failed" : nil
            }
            lock.unlock()
        }
    }
    // Render owner, while holding the mailbox. Closing a branch invalidates any prepared reuse
    // of its old material; the control thread supplies a fresh source if it was just re-enabled.
    private func reconcileResourcesLocked() {
        guard let graph = renderGraph else { return }
        let lostNoise = noiseLive && !graph.hasNoise, lostReverb = reverbLive && !graph.hasReverb
        noiseLive = graph.hasNoise; reverbLive = graph.hasReverb
        if lostNoise || lostReverb {
            revision &+= 1
            scheduleLocked()
        }
    }
    @discardableResult func process(_ buffers: UnsafeMutablePointer<AudioBufferList>, frames: Int, discontinuity: Bool = false) -> Bool {
        // Reject incomplete/mono buffers before advancing automation or adopting a request.
        guard AudioCutoffFilters.valid(UnsafeMutableAudioBufferListPointer(buffers), frames: frames, channels: 2) else { return false }
        if lock.try() {
            reconcileResourcesLocked()
            if let next = ready, next.request.generation == generation, next.request.revision == revision, retired == nil {
                if let graph = renderGraph {
                    guard graph.apply(next.program) else {
                        error = "audio-effect-preparation-failed"
                        lock.unlock()
                        graph.process(buffers, frames: frames, discontinuity: discontinuity)
                        return true
                    }
                } else { renderGraph = next.graph }
                if renderGraph != nil {
                    retired = active; active = next; ready = nil
                    applied = next.request.revision; activeGeneration = generation
                    noiseLive = renderGraph?.hasNoise == true; reverbLive = renderGraph?.hasReverb == true
                    if retired != nil { scheduleLocked() }
                }
            }
            lock.unlock()
        }
        guard let graph = renderGraph else { return false }
        graph.process(buffers, frames: frames, discontinuity: discontinuity)
        if lock.try() { reconcileResourcesLocked(); lock.unlock() }
        return true
    }
}
