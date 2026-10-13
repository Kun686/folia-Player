//
//  Created by Dimitrios Chatzieleftheriou on 25/10/2020.
//  Copyright © 2020 Decimal. All rights reserved.
//

import Foundation

final class SeekRequest {
    struct Snapshot {
        var requested = false
        var version: UInt64 = 0
        var time: Double = 0
    }

    private let lock = UnfairLock()
    private var state = Snapshot()

    // Callers and packet decoders share one lock, including reads outside the source queue.
    var requested: Bool { lock.withLock { state.requested } }
    var snapshot: Snapshot { lock.withLock { state } }

    /// Publish a complete seek intent; return whether the source needs its initial suspension.
    func request(time: Double) -> Bool {
        lock.withLock {
            let firstRequest = !state.requested
            state.requested = true
            state.time = time
            state.version &+= 1
            return firstRequest
        }
    }

    /// A decoder finishing an older seek must not consume a newer position.
    func complete(version: UInt64) {
        lock.withLock {
            if state.version == version { state.requested = false }
        }
    }

    func cancel() {
        lock.withLock {
            state.requested = false
            state.version &+= 1
        }
    }
}
