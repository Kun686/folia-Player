import Foundation

// AudioEffectProgram.swift — validated, prebuilt effect changes transferred from the control owner to the render owner.
final class AudioEffectProgram {
    struct Reuse {
        let curves: AudioEffectProgram?
        let noise: AudioNoiseBuffer?, reverb: AudioReverbKernel?
    }
    let rate: Double
    let values: [String: Double]
    let drive: [Float], crush: [Float]
    let noise: AudioNoiseBuffer?, reverb: AudioReverbKernel?
    // Set once when adopted by the render owner. Keep fading resources alive until control-side reclamation.
    private(set) var retainedNoise: AudioNoiseBuffer?
    private(set) var retainedReverb: AudioReverbKernel?

    init?(rate: Double, values: [String: Double], noise: AudioNoiseBuffer? = nil, reverb: AudioReverbKernel? = nil,
          reusingCurves previous: AudioEffectProgram? = nil,
          random: () -> Double = { Double.random(in: 0..<1) }) {
        var settings = NativeEqualizerSettings(); settings.effects = values
        guard AudioEffectSources.validRate(rate), (try? settings.validate()) != nil,
              noise == nil || noise?.rate == rate, reverb == nil || reverb?.rate == rate else { return nil }
        self.rate = rate; self.values = values
        drive = previous?.values["drive"] == values["drive"] ? previous!.drive : AudioEffectSources.saturation(values["drive"]!) ?? []
        crush = previous?.values["crush"] == values["crush"] ? previous!.crush : AudioEffectSources.bitCrush(values["crush"]!) ?? []
        // Match effectChain.ts: the noise branch is created before the reverb branch.
        if values["noise"]! > 0 {
            guard let source = noise ?? AudioNoiseBuffer(rate: rate, samples: AudioEffectSources.vinylNoise(rate: rate, random: random)) else { return nil }
            self.noise = source
        } else { self.noise = noise }
        if values["space"]! > 0 {
            guard let kernel = reverb ?? AudioReverbKernel(rate: rate, impulse: AudioEffectSources.reverbImpulse(rate: rate, random: random)) else { return nil }
            self.reverb = kernel
        } else { self.reverb = reverb }
    }
    func retainActiveBranches(noise: AudioNoiseBuffer?, reverb: AudioReverbKernel?) {
        retainedNoise = noise; retainedReverb = reverb
    }
}
