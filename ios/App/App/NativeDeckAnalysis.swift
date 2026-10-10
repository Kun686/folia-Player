import Foundation
import QuartzCore

// NativeDeckAnalysis.swift — native 25ms sampler, independent of visualizer demand and WKWebView timers.
final class NativeDeckAnalysis {
    private struct Entry { let capture: NativeDeckCapture; var measurements: NativeDeckMeasurements?; var failed = false }
    private let queue = DispatchQueue(label: "app.folia.deck-analysis", qos: .userInitiated)
    private var entries: [UUID: Entry] = [:]
    private var enabled = false, running = false
    private var timer: DispatchSourceTimer?

    func add(_ capture: NativeDeckCapture) {
        queue.async { [self] in
            entries[capture.identity] = Entry(capture: capture)
            capture.enable(enabled); updateTimer()
        }
    }
    func remove(_ capture: NativeDeckCapture) {
        capture.enable(false)
        queue.async { [self] in capture.enable(false); entries.removeValue(forKey: capture.identity); updateTimer() }
    }
    func configure(enabled: Bool? = nil, running: Bool? = nil) {
        queue.async { [self] in
            if let enabled, self.enabled != enabled {
                self.enabled = enabled
                for id in Array(entries.keys) {
                    entries[id]?.capture.enable(enabled)
                    entries[id]?.measurements = nil; entries[id]?.failed = false
                }
            }
            if let running { self.running = running }
            updateTimer()
        }
    }
    func snapshot(_ capture: NativeDeckCapture, history: Bool = false) async -> NativeDeckState? {
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                guard enabled, let entry = entries[capture.identity],
                      let measurements = entry.measurements, measurements.matches(capture) else {
                    continuation.resume(returning: nil); return
                }
                continuation.resume(returning: try? measurements.snapshot(at: CACurrentMediaTime(), history: history))
            }
        }
    }
    private func updateTimer() {
        guard enabled, running, !entries.isEmpty else { timer?.cancel(); timer = nil; return }
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(25), leeway: .milliseconds(2))
        timer.setEventHandler { [weak self] in self?.sample() }
        self.timer = timer; timer.resume()
    }
    private func sample() {
        guard enabled, running else { return }
        for id in Array(entries.keys) {
            guard var entry = entries[id], !entry.failed else { continue }
            do {
                if let frame = entry.capture.snapshot(after: entry.measurements?.revision) {
                    if entry.measurements == nil { entry.measurements = try NativeDeckMeasurements(rate: entry.capture.rate) }
                    try entry.measurements?.tick(frame)
                }
            } catch {
                // Analysis failure must not stop or attenuate music. A new deck/enable resets this failure.
                entry.failed = true; entry.measurements = nil; entry.capture.enable(false)
            }
            entries[id] = entry
        }
    }
    func close() {
        queue.sync {
            timer?.cancel(); timer = nil
            for entry in entries.values { entry.capture.enable(false) }
            entries.removeAll(); enabled = false; running = false
        }
    }
    deinit { timer?.cancel() }
}
