import XCTest
@testable import App

// NativeStemCacheTests.swift — original eviction priority plus native account/source invalidation races.
@MainActor extension NativeTests {
    private func stemKey(_ id: String, provider: String = "qq", role: NativeStemRole = .tail,
                         revision: String = "a", model: String = "b") throws -> NativeStemCache.Key {
        try NativeStemCache.Key(identity: XCTUnwrap(NativeProfileIdentity(song(provider, id))),
            mediaRevision: String(repeating: revision, count: 64), modelDigest: String(repeating: model, count: 64), role: role)
    }
    func testStemCacheEvictionMatchesOriginalPolicies() async throws {
        let reference = try StemStorageReference.load(), window = try StemStorageReference.window(frames: 128)
        XCTAssertEqual(NativeStemCache.limit, reference.maxWindows)
        for policy in reference.policies {
            let cache = NativeStemCache(), mapping = try Dictionary(uniqueKeysWithValues: policy.keys.map { ($0, try stemKey($0)) })
            await cache.setWanted(Array(mapping.values))
            for name in policy.keys.dropLast() {
                let token = await cache.begin(mapping[name]!); let ticket = try XCTUnwrap(token)
                let kept = await cache.finish(ticket, window: window); XCTAssertTrue(kept)
            }
            let token = await cache.begin(mapping[policy.arriving]!), ticket = try XCTUnwrap(token)
            await cache.setWanted(policy.wanted.map { mapping[$0]! })
            let kept = await cache.finish(ticket, window: window)
            XCTAssertEqual(kept, policy.victim != policy.arriving)
            let actual = await cache.keys
            XCTAssertEqual(actual, policy.keys.filter { $0 != policy.victim }.map { mapping[$0]! })
        }
    }

    func testStemCacheRetainsPaidLateWorkAndTouchesOnRead() async throws {
        let cache = NativeStemCache(), keys = try ["a", "b", "c", "d", "e"].map { try stemKey($0) }
        let window = try StemStorageReference.window(frames: 128)
        await cache.setWanted(keys)
        for key in keys.prefix(4) {
            let token = await cache.begin(key), ticket = try XCTUnwrap(token)
            let duplicate = await cache.begin(key); XCTAssertNil(duplicate)
            await cache.setWanted([])
            let kept = await cache.finish(ticket, window: window); XCTAssertTrue(kept, "Paid-for late results survive while a slot is free")
            await cache.setWanted(keys)
        }
        let cached = await cache.begin(keys[0]); XCTAssertNil(cached)
        let hit = await cache.read(keys[0]); XCTAssertTrue(hit === window)
        let token = await cache.begin(keys[4]), ticket = try XCTUnwrap(token)
        await cache.setWanted([keys[4]])
        let kept = await cache.finish(ticket, window: window); XCTAssertTrue(kept)
        let order = await cache.keys, bytes = await cache.storedBytes
        XCTAssertEqual(order, [keys[2], keys[3], keys[0], keys[4]])
        XCTAssertEqual(bytes, 4 * 128 * 16)
    }

    func testStemCacheHardInvalidationRejectsOldAndReplacedTickets() async throws {
        let cache = NativeStemCache(), qq = try stemKey("same"), ne = try stemKey("same", provider: "netease")
        XCTAssertNotEqual(qq, ne); XCTAssertNotEqual(qq, try stemKey("same", revision: "c"))
        XCTAssertNotEqual(qq, try stemKey("same", model: "c")); XCTAssertNotEqual(qq, try stemKey("same", role: .head))
        let window = try StemStorageReference.window(frames: 128)
        await cache.setWanted([qq, ne])
        let oldToken = await cache.begin(qq), old = try XCTUnwrap(oldToken)
        let neToken = await cache.begin(ne), netease = try XCTUnwrap(neToken)
        let stored = await cache.finish(netease, window: window); XCTAssertTrue(stored)
        await cache.remove(provider: "qq")
        let afterLogout = await cache.finish(old, window: window); XCTAssertFalse(afterLogout)
        let preserved = await cache.read(ne); XCTAssertNotNil(preserved)
        await cache.setWanted([qq]); let newToken = await cache.begin(qq), fresh = try XCTUnwrap(newToken)
        await cache.abandon(old)
        let stale = await cache.finish(old, window: window), current = await cache.finish(fresh, window: window)
        XCTAssertFalse(stale); XCTAssertTrue(current)
        await cache.clear(); let remaining = await cache.keys; XCTAssertTrue(remaining.isEmpty)
        let reuse = await cache.finish(fresh, window: window); XCTAssertFalse(reuse)

        let localID = UUID().uuidString
        let localIdentity = try XCTUnwrap(NativeProfileIdentity(["sourceRef": ["kind": "local", "mediaId": localID]]))
        let local = try NativeStemCache.Key(identity: localIdentity, mediaRevision: String(repeating: "a", count: 64),
            modelDigest: String(repeating: "b", count: 64), role: .tail)
        await cache.setWanted([local]); let localToken = await cache.begin(local), ticket = try XCTUnwrap(localToken)
        await cache.remove(localID: localID); let removed = await cache.finish(ticket, window: window); XCTAssertFalse(removed)
        XCTAssertThrowsError(try NativeStemCache.Key(identity: localIdentity, mediaRevision: "url", modelDigest: "unknown", role: .head))
    }

    func testStemCacheReleasesWindowAndRejectsWrongRole() async throws {
        let cache = NativeStemCache(), key = try stemKey("release")
        var window: NativeStemWindow? = try StemStorageReference.window(frames: 128)
        weak var released = window
        await cache.setWanted([key]); let token = await cache.begin(key), ticket = try XCTUnwrap(token)
        let stored = await cache.finish(ticket, window: window!); XCTAssertTrue(stored)
        window = nil; XCTAssertNotNil(released)
        await cache.remove(provider: "qq"); XCTAssertNil(released)
        await cache.setWanted([key]); let next = await cache.begin(key), other = try XCTUnwrap(next)
        let wrong = try StemStorageReference.window(frames: 128, role: .head)
        let invalid = await cache.finish(other, window: wrong); XCTAssertFalse(invalid)
        let newRequest = await cache.begin(key); XCTAssertNotNil(newRequest)
        await cache.clear()
    }
}
