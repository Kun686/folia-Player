import AVFoundation
import AudioToolbox

// NativeTempoProcessor.swift — Apple's pitch-preserving converter in a manually rendered system graph.
// The owner serializes render/reset/close and stops rendering before releasing this processor.
final class NativeTempoProcessor {
    static let maximumFrames: AVAudioFrameCount = 4096
    private let engine = AVAudioEngine()
    private let pitch = AVAudioUnitTimePitch()
    private let input: TempoInput
    private var renderBlock: AVAudioEngineManualRenderingBlock
    private let schedule: AUScheduleParameterBlock
    private let lock = NSLock()
    private var pendingRate: Float?
    private var closed = false
    // Render-owner only: the rate actually adopted, not a still-pending control request.
    private(set) var appliedRate: Double
    // Query on the control side. Latency is deliberately NOT discarded PCM: all startup and tail
    // samples are returned. The caller must map the rendered output clock to the decoder's media time.
    var latency: TimeInterval { pitch.auAudioUnit.latency }
    var tailTime: TimeInterval { pitch.auAudioUnit.tailTime }
    var renderedFrames: AVAudioFramePosition { engine.manualRenderingSampleTime }

    init(format sourceFormat: AVAudioFormat, rate: Double = 1, input: @escaping AURenderPullInputBlock) throws {
        guard AudioEffectSources.validRate(sourceFormat.sampleRate), Self.valid(rate),
              sourceFormat.commonFormat == .pcmFormatFloat32, sourceFormat.channelCount == 2,
              let format = AVAudioFormat(standardFormatWithSampleRate: sourceFormat.sampleRate, channels: 2) else {
            throw MobileFailure("invalid-tempo-format")
        }
        let state = TempoInput(format: sourceFormat, render: input)
        self.input = state
        appliedRate = Double(Float(rate))
        // Like StreamRenderSource, AVAudioSourceNode converts the decoder's interleaved layout.
        let source = AVAudioSourceNode(format: sourceFormat) { silence, time, frames, output in
            var flags: AudioUnitRenderActionFlags = []
            let status = state.render(&flags, time, frames, output)
            silence.pointee = ObjCBool(status != noErr || flags.contains(.unitRenderAction_OutputIsSilence))
            return status
        }
        // Preserve the system's default smoothness/coherence/transient processing. Pitch stays zero.
        pitch.pitch = 0; pitch.rate = Float(rate)
        engine.attach(source); engine.attach(pitch)
        engine.connect(source, to: pitch, format: format)
        engine.connect(pitch, to: engine.mainMixerNode, format: format)
        try engine.enableManualRenderingMode(.realtime, format: format, maximumFrameCount: Self.maximumFrames)
        engine.prepare(); try engine.start()
        renderBlock = engine.manualRenderingBlock
        schedule = pitch.auAudioUnit.scheduleParameterBlock
    }

    // The original planner chooses the rate; no tempo classification or fallback policy lives here.
    // Last request wins. Rendering never waits on the control-side mailbox.
    func request(rate: Double) throws {
        guard Self.valid(rate) else { throw MobileFailure("invalid-tempo-rate") }
        lock.lock(); defer { lock.unlock() }
        guard !closed else { throw MobileFailure("tempo-unavailable") }
        pendingRate = Float(rate)
    }
    private static func valid(_ rate: Double) -> Bool { rate.isFinite && (0.88...1.12).contains(rate) }

    // No read-ahead is hidden or trimmed here. Supply zeros after EOF to drain the system converter.
    // This graph owns its local output clock; the enclosing graph still owns the common deck clock.
    func render(_ output: UnsafeMutablePointer<AudioBufferList>, frames: AVAudioFrameCount, rate: Double? = nil) -> OSStatus {
        guard !closed, frames > 0, frames <= Self.maximumFrames else { return kAudioUnitErr_InvalidParameter }
        if let rate, !Self.valid(rate) { return kAudioUnitErr_InvalidParameter }
        let buffers = UnsafeMutableAudioBufferListPointer(output)
        guard buffers.count == 2, buffers.allSatisfy({ $0.mNumberChannels == 1 && $0.mData != nil
            && $0.mDataByteSize >= frames * UInt32(MemoryLayout<Float>.size) }) else { return kAudioUnitErr_FormatNotSupported }
        if lock.try() {
            if let rate = pendingRate {
                schedule(AUEventSampleTimeImmediate, 0, AUParameterAddress(kNewTimePitchParam_Pitch), 0)
                schedule(AUEventSampleTimeImmediate, 0, AUParameterAddress(kNewTimePitchParam_Rate), rate)
                appliedRate = Double(rate)
                pendingRate = nil
            }
            lock.unlock()
        }
        // A containing renderer may already own its control mailbox. Applying its adopted value
        // here avoids taking a blocking control-side lock from that renderer's audio callback.
        if let rate, Double(Float(rate)) != appliedRate {
            schedule(AUEventSampleTimeImmediate, 0, AUParameterAddress(kNewTimePitchParam_Rate), Float(rate))
            appliedRate = Double(Float(rate))
        }
        input.error = noErr
        var error: OSStatus = noErr
        let result = renderBlock(frames, output, &error)
        let status = input.error != noErr ? input.error : error != noErr ? error
            : result == .success ? noErr : kAudioUnitErr_CannotDoInCurrentContext
        if status != noErr { for buffer in buffers { memset(buffer.mData!, 0, Int(frames) * MemoryLayout<Float>.size) } }
        return status
    }

    // Host must stop calling render before a seek/new source reset. Old audio and rate requests expire.
    func reset(rate: Double = 1) throws {
        guard Self.valid(rate) else { throw MobileFailure("invalid-tempo-rate") }
        lock.lock(); defer { lock.unlock() }
        guard !closed else { throw MobileFailure("tempo-unavailable") }
        engine.stop(); engine.reset(); pendingRate = nil
        pitch.pitch = 0; pitch.rate = Float(rate)
        appliedRate = Double(Float(rate))
        engine.prepare(); try engine.start()
        renderBlock = engine.manualRenderingBlock
    }
    func close() {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { return }
        closed = true; pendingRate = nil; engine.stop(); input.clear()
    }
    deinit { close() }
}

// AVAudioSourceNode supplies the declared input layout. A converter may ask for more input than
// output; validate the actual input size and silence flag before returning it to the system unit.
private final class TempoInput {
    private var source: AURenderPullInputBlock?
    private let count: Int, channels: UInt32
    var error: OSStatus = noErr
    init(format: AVAudioFormat, render: @escaping AURenderPullInputBlock) {
        source = render; count = format.isInterleaved ? 1 : 2; channels = format.isInterleaved ? 2 : 1
    }
    func clear() { source = nil }
    func render(_ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>, _ time: UnsafePointer<AudioTimeStamp>,
                _ frames: AVAudioFrameCount, _ output: UnsafeMutablePointer<AudioBufferList>) -> OSStatus {
        guard frames <= NativeTempoProcessor.maximumFrames * 2 else { error = kAudioUnitErr_TooManyFramesToProcess; return error }
        let buffers = UnsafeMutableAudioBufferListPointer(output)
        let bytes = frames * channels * UInt32(MemoryLayout<Float>.size)
        guard buffers.count == count, buffers.allSatisfy({ $0.mNumberChannels == channels && $0.mData != nil && $0.mDataByteSize >= bytes }) else {
            error = kAudioUnitErr_FormatNotSupported; return error
        }
        error = source?(flags, time, frames, 0, output) ?? kAudioUnitErr_NoConnection
        if error != noErr || flags.pointee.contains(.unitRenderAction_OutputIsSilence) {
            for buffer in buffers { memset(buffer.mData!, 0, Int(bytes)) }
        }
        return error
    }
}
