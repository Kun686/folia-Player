import Foundation
import JavaScriptCore

// NativeFloat32Bridge.swift — shared JSC typed-array ownership and bounded copies outside the audio callback.
enum NativeFloat32Bridge {
    // JSC holds the immutable PCM owner until its typed array dies, without copying or JSON-boxing samples.
    static func make(_ data: NSData, in context: JSContext, errorCode: String) throws -> JSValue {
        let owner = Unmanaged.passRetained(data).toOpaque()
        var exception: JSValueRef?
        let object = JSObjectMakeTypedArrayWithBytesNoCopy(context.jsGlobalContextRef, kJSTypedArrayTypeFloat32Array,
            UnsafeMutableRawPointer(mutating: data.bytes), data.length, { _, owner in
                if let owner { Unmanaged<NSData>.fromOpaque(owner).release() }
            }, owner, &exception)
        // The documented C API invokes the deallocator even on exception.
        guard exception == nil, let object, let value = JSValue(jsValueRef: object, in: context) else {
            throw MobileFailure(errorCode)
        }
        return value
    }

    static func copy(_ value: JSValue, count: Int) throws -> [Float] {
        guard (1...1_323_000).contains(count), let context = value.context, let raw = value.jsValueRef else {
            throw MobileFailure("invalid-expansion-pcm")
        }
        let ctx = context.jsGlobalContextRef
        var error: JSValueRef?
        guard JSValueGetTypedArrayType(ctx, raw, &error) == kJSTypedArrayTypeFloat32Array, error == nil,
              let object = JSValueToObject(ctx, raw, &error), error == nil,
              JSObjectGetTypedArrayLength(ctx, object, &error) == count, error == nil,
              let bytes = JSObjectGetTypedArrayBytesPtr(ctx, object, &error), error == nil else {
            throw MobileFailure("invalid-expansion-pcm")
        }
        // The pointer is valid only until the next JSC call; finish the native copy immediately.
        return Array(UnsafeBufferPointer(start: bytes.assumingMemoryBound(to: Float.self), count: count))
    }
}
