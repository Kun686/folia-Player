import AVFoundation
import AudioToolbox

// AudioEffectUnit.swift — audible AVAudioEngine insert reusing Folia's EQ, effects and spectrum.
final class AudioEffectUnit: AUAudioUnit {
    static let component = AudioComponentDescription(componentType: kAudioUnitType_Effect,
        componentSubType: 0x66656678, componentManufacturer: 0x466F6C69, componentFlags: 0, componentFlagsMask: 0)
    private static let registration: Void = {
        AUAudioUnit.registerSubclass(AudioEffectUnit.self, as: component, name: "Folia: Effects", version: 1)
    }()
    static func makeNode() async throws -> AVAudioUnit {
        _ = registration
        return try await withCheckedThrowingContinuation { continuation in
            AVAudioUnit.instantiate(with: component, options: []) { node, error in
                if let node { continuation.resume(returning: node) }
                else { continuation.resume(throwing: error ?? NSError(domain: NSOSStatusErrorDomain, code: Int(kAudioUnitErr_FailedInitialization))) }
            }
        }
    }

    private let input: AUAudioUnitBus
    private let output: AUAudioUnitBus
    private var inputs: AUAudioUnitBusArray!
    private var outputs: AUAudioUnitBusArray!
    private let renderState = EffectRenderState()
    var meter: AudioMeter { renderState.meter }
    func requestDiscontinuity() { renderState.requestReset() }
    override var inputBusses: AUAudioUnitBusArray { inputs }
    override var outputBusses: AUAudioUnitBusArray { outputs }

    override init(componentDescription: AudioComponentDescription, options: AudioComponentInstantiationOptions = []) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        input = try AUAudioUnitBus(format: format)
        output = try AUAudioUnitBus(format: format)
        try super.init(componentDescription: componentDescription, options: options)
        inputs = AUAudioUnitBusArray(audioUnit: self, busType: .input, busses: [input])
        outputs = AUAudioUnitBusArray(audioUnit: self, busType: .output, busses: [output])
        maximumFramesToRender = 8192
    }

    override func allocateRenderResources() throws {
        let format = output.format
        guard input.format == format, format.commonFormat == .pcmFormatFloat32, !format.isInterleaved,
              format.channelCount == 2, AudioEffectSources.validRate(format.sampleRate),
              maximumFramesToRender > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: maximumFramesToRender) else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(kAudioUnitErr_FormatNotSupported))
        }
        try super.allocateRenderResources()
        renderState.storage = buffer
        renderState.needsReset = true
        renderState.endSample = nil
        meter.prepare(format.streamDescription.pointee)
    }

    override func deallocateRenderResources() {
        meter.unprepare()
        renderState.storage = nil
        renderState.endSample = nil
        super.deallocateRenderResources()
    }

    override func reset() {
        super.reset()
        // AU hosts serialize reset with rendering. Histories clear on the next PCM block.
        renderState.needsReset = true
    }

    override var internalRenderBlock: AUInternalRenderBlock {
        let state = renderState
        return { flags, timestamp, frames, bus, output, _, pull in
            state.render(flags, timestamp, frames, bus, output, pull)
        }
    }
}

// Buffers are allocated before render starts; no FFT, allocation or blocking lock in this adapter.
private final class EffectRenderState {
    let meter = AudioMeter()
    var storage: AVAudioPCMBuffer?
    var needsReset = true
    var endSample: Double?
    private let resetLock = NSLock()
    private var requestedReset = false
    func requestReset() { resetLock.lock(); requestedReset = true; resetLock.unlock() }

    func render(_ flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>, _ timestamp: UnsafePointer<AudioTimeStamp>,
                _ frames: AUAudioFrameCount, _ bus: Int, _ output: UnsafeMutablePointer<AudioBufferList>,
                _ pull: AURenderPullInputBlock?) -> AUAudioUnitStatus {
        guard bus == 0 else { return kAudioUnitErr_InvalidElement }
        guard let storage else { return kAudioUnitErr_Uninitialized }
        guard frames <= storage.frameCapacity else { return kAudioUnitErr_TooManyFramesToProcess }
        guard let pull else { return kAudioUnitErr_NoConnection }
        storage.frameLength = frames
        let destination = UnsafeMutableAudioBufferListPointer(output)
        let scratch = UnsafeMutableAudioBufferListPointer(storage.mutableAudioBufferList)
        guard destination.count == scratch.count else { return kAudioUnitErr_FormatNotSupported }
        for i in 0..<destination.count {
            let bytes = scratch[i].mDataByteSize
            if destination[i].mData == nil { destination[i].mData = scratch[i].mData }
            else if destination[i].mDataByteSize < bytes { return kAudioUnitErr_TooManyFramesToProcess }
            destination[i].mNumberChannels = scratch[i].mNumberChannels
            destination[i].mDataByteSize = bytes
        }
        let status = pull(flags, timestamp, frames, 0, output)
        guard status == noErr else { needsReset = true; return status }
        // Silence flags do not require an upstream unit to overwrite its reusable buffer.
        if flags.pointee.contains(.unitRenderAction_OutputIsSilence) {
            for buffer in destination {
                if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) }
            }
        }
        let time = timestamp.pointee
        let validTime = time.mFlags.contains(.sampleTimeValid) && time.mSampleTime.isFinite
        if resetLock.try() {
            if requestedReset { needsReset = true; requestedReset = false }
            resetLock.unlock()
        }
        let discontinuity = needsReset || (validTime && endSample.map { abs($0 - time.mSampleTime) > 0.5 } == true)
        meter.process(output, frames: Int(frames), discontinuity: discontinuity)
        needsReset = false
        endSample = validTime ? time.mSampleTime + Double(frames) : nil
        // Noise/reverb can produce output even if upstream was marked silent.
        flags.pointee.remove(.unitRenderAction_OutputIsSilence)
        return noErr
    }
}
