import Accelerate
import JavaScriptCore

// NativeProfileFFT.swift — system double-precision forward FFT; all profile decisions stay in the original analyser.
final class NativeProfileFFT {
    enum Size: Int { case beat = 1024, profile = 2048 }
    private let count: Int
    private let setup: vDSP_DFT_SetupD?
    private var real: [Double], imag: [Double], outReal: [Double], outImag: [Double]
    init(size: Size = .profile) {
        count = size.rawValue
        setup = vDSP_DFT_zop_CreateSetupD(nil, vDSP_Length(size.rawValue), .FORWARD)
        real = [Double](repeating: 0, count: size.rawValue); imag = real; outReal = real; outImag = real
    }
    deinit { if let setup { vDSP_DFT_DestroySetupD(setup) } }

    // JSC only guarantees a typed-array pointer until the next API call. Copy each span immediately.
    private func transfer(_ value: JSValue, samples: inout [Double], writing: Bool) throws {
        guard let context = value.context, let raw = value.jsValueRef else { throw MobileFailure("invalid-profile-fft") }
        let ctx = context.jsGlobalContextRef
        var error: JSValueRef?
        guard JSValueGetTypedArrayType(ctx, raw, &error) == kJSTypedArrayTypeFloat64Array, error == nil,
              let object = JSValueToObject(ctx, raw, &error), error == nil,
              JSObjectGetTypedArrayLength(ctx, object, &error) == count, error == nil,
              let bytes = JSObjectGetTypedArrayBytesPtr(ctx, object, &error), error == nil else {
            throw MobileFailure("invalid-profile-fft")
        }
        samples.withUnsafeMutableBytes { span in
            if writing { bytes.copyMemory(from: span.baseAddress!, byteCount: span.count) }
            else { span.baseAddress!.copyMemory(from: bytes, byteCount: span.count) }
        }
    }
    func transform(real: JSValue, imag: JSValue) throws {
        try Task.checkCancellation()
        guard let setup else { throw MobileFailure("profile-fft-unavailable") }
        try transfer(real, samples: &self.real, writing: false)
        try transfer(imag, samples: &self.imag, writing: false)
        vDSP_DFT_ExecuteD(setup, self.real, self.imag, &outReal, &outImag)
        try transfer(real, samples: &outReal, writing: true)
        try transfer(imag, samples: &outImag, writing: true)
    }
}
