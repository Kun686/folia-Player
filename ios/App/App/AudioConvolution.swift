import Accelerate
import Foundation

// AudioConvolution.swift — zero-latency FIR head plus two FFT partition sizes using the existing Accelerate framework.
private final class ConvolutionStorage {
    let pointer: UnsafeMutablePointer<Float>
    let count: Int
    init(_ count: Int) { self.count = count; pointer = .allocate(capacity: count); pointer.initialize(repeating: 0, count: count) }
    deinit { pointer.deinitialize(count: count); pointer.deallocate() }
    func clear() { pointer.update(repeating: 0, count: count) }
}

// A partition stage starts no earlier than its block size, so its FFT never delays an audible output sample.
private final class ConvolutionPartitions {
    private let block: Int, length: Int, bins: Int, partitions: Int, offset: Int
    private let forward: vDSP_DFT_Setup, inverse: vDSP_DFT_Setup
    private let input: ConvolutionStorage, zero: ConvolutionStorage, real: ConvolutionStorage, imag: ConvolutionStorage
    private let inverseReal: ConvolutionStorage, inverseImag: ConvolutionStorage, output: ConvolutionStorage
    private let kernelReal: ConvolutionStorage, kernelImag: ConvolutionStorage
    private let historyReal: ConvolutionStorage, historyImag: ConvolutionStorage
    private var fill = 0, historyCursor = 0, outputCursor = 0

    init?(impulse: ArraySlice<Float>, block: Int, offset: Int) {
        guard !impulse.isEmpty, block > 0, offset >= block,
              let forward = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(2 * block), .FORWARD) else { return nil }
        guard let inverse = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(2 * block), .INVERSE) else {
            vDSP_DFT_DestroySetup(forward); return nil
        }
        self.forward = forward; self.inverse = inverse
        self.block = block; length = 2 * block; bins = block + 1; self.offset = offset
        partitions = (impulse.count + block - 1) / block
        input = ConvolutionStorage(length); zero = ConvolutionStorage(length)
        real = ConvolutionStorage(length); imag = ConvolutionStorage(length)
        inverseReal = ConvolutionStorage(length); inverseImag = ConvolutionStorage(length)
        output = ConvolutionStorage(offset + length)
        kernelReal = ConvolutionStorage(partitions * bins); kernelImag = ConvolutionStorage(partitions * bins)
        historyReal = ConvolutionStorage(partitions * bins); historyImag = ConvolutionStorage(partitions * bins)
        for partition in 0..<partitions {
            input.clear()
            for i in 0..<min(block, impulse.count - partition * block) {
                input.pointer[i] = impulse[impulse.startIndex + partition * block + i]
            }
            vDSP_DFT_Execute(forward, input.pointer, zero.pointer, real.pointer, imag.pointer)
            kernelReal.pointer.advanced(by: partition * bins).update(from: real.pointer, count: bins)
            kernelImag.pointer.advanced(by: partition * bins).update(from: imag.pointer, count: bins)
        }
        reset()
    }
    deinit { vDSP_DFT_DestroySetup(forward); vDSP_DFT_DestroySetup(inverse) }
    func reset() {
        input.clear(); historyReal.clear(); historyImag.clear(); output.clear()
        fill = 0; historyCursor = 0; outputCursor = 0
    }
    func process(_ sample: Float) -> Float {
        let value = output.pointer[outputCursor]; output.pointer[outputCursor] = 0
        input.pointer[fill] = sample; fill += 1
        if fill == block { renderPartition(); fill = 0 }
        outputCursor = (outputCursor + 1) % output.count
        return value
    }
    private func renderPartition() {
        vDSP_DFT_Execute(forward, input.pointer, zero.pointer, real.pointer, imag.pointer)
        historyReal.pointer.advanced(by: historyCursor * bins).update(from: real.pointer, count: bins)
        historyImag.pointer.advanced(by: historyCursor * bins).update(from: imag.pointer, count: bins)
        real.clear(); imag.clear()
        var sum = DSPSplitComplex(realp: real.pointer, imagp: imag.pointer)
        for partition in 0..<partitions {
            let index = ((historyCursor - partition + partitions) % partitions) * bins
            var x = DSPSplitComplex(realp: historyReal.pointer.advanced(by: index), imagp: historyImag.pointer.advanced(by: index))
            var h = DSPSplitComplex(realp: kernelReal.pointer.advanced(by: partition * bins), imagp: kernelImag.pointer.advanced(by: partition * bins))
            // Separate pointer structs refer to the same preallocated accumulator; vDSP supports in-place maps.
            var destination = sum
            vDSP_zvma(&x, 1, &h, 1, &sum, 1, &destination, 1, vDSP_Length(bins))
        }
        // Real signals have conjugate symmetry. Store only nonnegative bins, including DC and Nyquist separately.
        for index in bins..<length {
            real.pointer[index] = real.pointer[length - index]; imag.pointer[index] = -imag.pointer[length - index]
        }
        vDSP_DFT_Execute(inverse, real.pointer, imag.pointer, inverseReal.pointer, inverseImag.pointer)
        let start = outputCursor + offset - block + 1, scale = 1 / Float(length)
        for index in 0..<length {
            output.pointer[(start + index) % output.count] += inverseReal.pointer[index] * scale
        }
        historyCursor = (historyCursor + 1) % partitions
    }
}

final class AudioConvolution {
    private let coefficients = ConvolutionStorage(128), history = ConvolutionStorage(256)
    private let early: ConvolutionPartitions?, late: ConvolutionPartitions?
    private var cursor = 0

    // Build FFT kernels and buffers on the control owner; the render owner only processes and resets history.
    init?(impulse: [Float]) {
        guard !impulse.isEmpty, impulse.count <= 422400, impulse.allSatisfy(\.isFinite) else { return nil }
        if impulse.count > 128 {
            guard let stage = ConvolutionPartitions(impulse: impulse[128..<min(2048, impulse.count)], block: 128, offset: 128) else { return nil }
            early = stage
        } else { early = nil }
        if impulse.count > 2048 {
            guard let stage = ConvolutionPartitions(impulse: impulse[2048...], block: 1024, offset: 2048) else { return nil }
            late = stage
        } else { late = nil }
        for i in 0..<min(128, impulse.count) { coefficients.pointer[127 - i] = impulse[i] }
    }
    func reset() { history.clear(); cursor = 0; early?.reset(); late?.reset() }
    func process(_ input: Float) -> Float {
        let value = input.isFinite ? input : 0
        history.pointer[cursor] = value; history.pointer[cursor + 128] = value
        var result: Float = 0
        vDSP_dotpr(history.pointer.advanced(by: cursor + 1), 1, coefficients.pointer, 1, &result, 128)
        result += early?.process(value) ?? 0
        result += late?.process(value) ?? 0
        cursor = (cursor + 1) & 127
        return result.isFinite ? result : 0
    }
}
