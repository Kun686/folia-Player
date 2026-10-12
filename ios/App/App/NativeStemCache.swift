import Foundation

// NativeStemCache.swift — four original PCM windows, current-pair priority, and hard invalidation of late work.
actor NativeStemCache {
    struct Selection: Hashable {
        let source: String, role: NativeStemRole
        let provider: String?, localID: String?
        init(identity: NativeProfileIdentity, role: NativeStemRole) {
            source = identity.key; self.role = role; provider = identity.provider; localID = identity.localID
        }
        func matches(_ key: Key) -> Bool { source == key.source && role == key.role }
    }
    struct Key: Hashable {
        let source: String, mediaRevision: String, modelDigest: String
        let role: NativeStemRole
        let provider: String?, localID: String?
        // Revision is the complete media representation's digest; a URL, prefix or gridless profile is not one.
        init(identity: NativeProfileIdentity, mediaRevision: String, modelDigest: String, role: NativeStemRole) throws {
            let digest: (String) -> Bool = { $0.count == 64 && $0.allSatisfy { "0123456789abcdef".contains($0) } }
            guard digest(mediaRevision), digest(modelDigest) else { throw MobileFailure("invalid-stem-identity") }
            source = identity.key; provider = identity.provider; localID = identity.localID
            self.mediaRevision = mediaRevision; self.modelDigest = modelDigest; self.role = role
        }
    }
    struct Ticket { fileprivate let key: Key, token: UUID }
    static let limit = 4
    private var entries: [Key: NativeStemWindow] = [:]
    private var order: [Key] = [], wanted = Set<Key>()
    private var wantedSources: Set<Selection>?
    private var pending: [Key: UUID] = [:]
    var keys: [Key] { order }
    var storedBytes: Int { entries.values.reduce(0) { $0 + $1.storedBytes } }

    func setWanted(_ keys: [Key]) { wanted = Set(keys); wantedSources = nil }
    // The queue knows song/role before reading the complete media digest. Keep that pair protected too.
    func setWantedSources(_ sources: [Selection]) { wantedSources = Set(sources); wanted.removeAll() }
    private func isWanted(_ key: Key) -> Bool { wantedSources?.contains(where: { $0.matches(key) }) ?? wanted.contains(key) }
    func read(_ selection: Selection, modelDigest: String) -> NativeStemWindow? {
        guard let key = order.last(where: { selection.matches($0) && $0.modelDigest == modelDigest }) else { return nil }
        return read(key)
    }
    func read(_ key: Key) -> NativeStemWindow? {
        guard let value = entries[key] else { return nil }
        order.removeAll { $0 == key }; order.append(key)
        return value
    }
    // Call immediately before expensive work. Already cached or in-flight windows cost no second model run.
    func begin(_ key: Key) -> Ticket? {
        guard isWanted(key), entries[key] == nil, pending[key] == nil else { return nil }
        let token = UUID(); pending[key] = token
        return Ticket(key: key, token: token)
    }
    func abandon(_ ticket: Ticket) {
        if pending[ticket.key] == ticket.token { pending[ticket.key] = nil }
    }
    @discardableResult func finish(_ ticket: Ticket, window: NativeStemWindow) -> Bool {
        guard pending[ticket.key] == ticket.token else { return false }
        pending[ticket.key] = nil
        guard ticket.key.role == window.role else { return false }
        let key = ticket.key
        entries[key] = window; order.removeAll { $0 == key }; order.append(key)
        if order.count > Self.limit {
            // Original pickStemVictim: a paid-for late result is kept while a slot is free; in a full
            // cache it goes first if no longer wanted, otherwise evict the oldest unneeded window.
            let victim = !isWanted(key) ? key : order.first { !isWanted($0) } ?? order[0]
            entries[victim] = nil; order.removeAll { $0 == victim }
        }
        return entries[key] != nil
    }
    // Logout/source removal differ from a seek: neither cached PCM nor an already-running result may return.
    func remove(provider: String) { remove { $0.provider == provider }; wantedSources = wantedSources.map { Set($0.filter { $0.provider != provider }) } }
    func remove(localID: String) { remove { $0.localID == localID }; wantedSources = wantedSources.map { Set($0.filter { $0.localID != localID }) } }
    func remove(source: String) { remove { $0.source == source } }
    func removeOnline() { remove { $0.provider != nil } }
    func removeLocal() { remove { $0.localID != nil } }
    private func remove(where matches: (Key) -> Bool) {
        for key in Set(entries.keys).union(pending.keys).union(wanted) where matches(key) {
            entries[key] = nil; pending[key] = nil; wanted.remove(key)
        }
        order.removeAll(where: matches)
    }
    func clear() { entries.removeAll(); order.removeAll(); pending.removeAll(); wanted.removeAll(); wantedSources = nil }
}
