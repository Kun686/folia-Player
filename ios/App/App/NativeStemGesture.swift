import Foundation

// NativeStemGesture.swift — immutable original-rule output, prepared away from the audio render thread.
enum NativeStemName: String, CaseIterable { case vocals, drums, bass, other }

struct NativeStemSchedule: Codable {
    struct Sustain: Codable { let from: Double, to: Double, holdDb: Double }
    struct Exit: Codable {
        let from: Double, to: Double, loudDb: Double
        let kind: String
        let held: Sustain?
    }
    struct Handover: Codable {
        let swap: Double, bassAt: Double, vocalIn: Double, dueAt: Double
        let exit: Exit
    }
    struct Sweep: Codable { let fromHz: Double, toHz: Double, seconds: Double }
    let windowSec: Double
    let handover: Handover
    let otherSweep: Sweep
}

struct NativeStemGesture {
    let schedule: NativeStemSchedule
    let outgoing: [NativeStemName: [Float]]
    let incoming: [NativeStemName: [Float]]
}
