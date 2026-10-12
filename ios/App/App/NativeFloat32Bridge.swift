import Foundation
import JavaScriptCore

// NativeFloat32Bridge.swift — shared JSC typed-array ownership and bounded copies outside the audio callback.
enum NativeFloat32Bridge {
    // JSC holds the immutable PCM owner until its typed array dies, without copying or JSON-boxing samples.
    static func make(_ data: NSData, in context: JSContext, errorCode: String) throws -> JSValue {
        if data.length == 0 {
            // Empty NSData has no usable storage pointer; JSC provides a length-based constructor for this case.
            var exception: JSValueRef?
            guard let object = JSObjectMakeTypedArray(context.jsGlobalContextRef, kJSTypedArrayTypeFloat32Array, 0, &exception),
                  exception == nil, let value = JSValue(jsValueRef: object, in: context) else { throw MobileFailure(errorCode) }
            return value
        }
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
        try copy(value, count: count, limit: 1_323_000, type: kJSTypedArrayTypeFloat32Array, element: Float.self)
    }
    static func copyDoubles(_ value: JSValue, count: Int) throws -> [Double] {
        try copy(value, count: count, limit: 2_646_000, type: kJSTypedArrayTypeFloat64Array, element: Double.self)
    }
    private static func copy<T>(_ value: JSValue, count: Int, limit: Int, type: JSTypedArrayType, element: T.Type) throws -> [T] {
        guard (1...limit).contains(count), let context = value.context, let raw = value.jsValueRef else {
            throw MobileFailure("invalid-expansion-pcm")
        }
        let ctx = context.jsGlobalContextRef
        var error: JSValueRef?
        guard JSValueGetTypedArrayType(ctx, raw, &error) == type, error == nil,
              let object = JSValueToObject(ctx, raw, &error), error == nil,
              JSObjectGetTypedArrayLength(ctx, object, &error) == count, error == nil,
              let bytes = JSObjectGetTypedArrayBytesPtr(ctx, object, &error), error == nil else {
            throw MobileFailure("invalid-expansion-pcm")
        }
        // The pointer is valid only until the next JSC call; finish the native copy immediately.
        return Array(UnsafeBufferPointer(start: bytes.assumingMemoryBound(to: T.self), count: count))
    }
}
