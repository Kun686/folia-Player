import Foundation
import QuartzCore

// NativeCrossfade.swift — original crossfade plans on the native identity queue, independent of WebView timers.
final class NativeCrossfade {
    private struct Key: Equatable {
        let epoch: Int, queueRevision: Int, profileRevision: Int, lyricRevision: Int, stemRevision: Int, planningSecond: Int
        let outgoing: ObjectIdentifier, incoming: ObjectIdentifier
        let fromDuration: Double, toDuration: Double
    }
    private struct Fade {
        var tail: StreamOccurrence?
        let tailSong: [String: Any]
        let sourceURL: URL
        var cached = false
        let epoch: Int, gainGeneration: UInt64
        let seconds: Double
        let cue: NativeTransitionCue
        let hold: Double
        let style: String
        var masterBalance: Bool
    }
    private weak var owner: PlaybackEngine?
    private let planner = NativeTransitionPlanner()
    private let balance = NativeBalanceCorrection()
    private let stemHandover = NativeStemHandover()
    private let profiles: NativeTrackProfiles
    private let stems: NativeTrackStems
    private let trace: NativeAnalysisTrace?
    private var beatModel: URL?
    private var stemModel: URL?
    private var clearingCache = false
    private let lyrics: NativeLyrics
    private var work: Task<Void, Never>?
    private var release: DispatchWorkItem?
    private var revision: UInt64 = 0
    private var key: Key?
    private var plan: NativeTransitionPlan?
    private var armed = false
    private var plannedFrom: [String: Any]?, plannedTo: [String: Any]?
    private var fade: Fade?
    private var preplay: NativeMutedPreplay?
    private weak var bending: StreamOccurrence?
    private(set) var mode = "crossfade"
    private(set) var enabled = false
    private(set) var maximumSeconds = 5.0
    private(set) var performance = false
    private(set) var stemPreparationStatus = "not-attempted"
    var isFading: Bool { fade != nil }
    // Bounded QA observations of the actual coordinator, without replacing resource notifications.
    var analysisDiagnostics: [String: Any] {
        ["profiles": profiles.diagnostics, "planning": work != nil, "armed": armed,
         "mode": mode, "enabled": enabled, "planKind": plan?.kind ?? "none",
         "planInStart": plan?.inStart ?? -1, "planOutStart": plan?.outStart ?? -1]
    }
    var isStemFading: Bool {
        guard let fade, let clock = owner?.streamOutput?.transitionGain.clock else { return false }
        return clock.generation == fade.gainGeneration && clock.stemActive
    }

    init(owner: PlaybackEngine, profiler: NativeTrackProfiler = NativeTrackProfiler(), lyrics: NativeLyrics? = nil,
         profiles: NativeTrackProfiles? = nil, stems: NativeTrackStems? = nil, trace: NativeAnalysisTrace? = nil) {
        self.owner = owner; self.trace = trace
        let profiles = profiles ?? NativeTrackProfiles(local: owner.local, profiler: profiler, configuration: owner.mediaNetworkConfiguration ?? .ephemeral, mediaCache: owner.mediaCache)
        self.profiles = profiles
        self.stems = stems ?? NativeTrackStems(local: owner.local, mediaCache: owner.mediaCache,
            profilesIdle: { [weak profiles] in profiles?.hasPending != true },
            providerBarrier: { [weak owner] in owner?.mediaCachePurges[$0] })
        self.lyrics = lyrics ?? NativeLyrics(local: owner.local, gateway: owner.gateway, cache: owner.lyricCache, coverCache: owner.coverCache)
        self.profiles.changed = { [weak self] in self?.tick() }
        self.lyrics.changed = { [weak self] in self?.tick() }
        self.lyrics.cacheChanged = { [weak owner] song in owner?.lyricsChanged?(song) }
        self.lyrics.localMatched = { [weak owner] id, song in
            owner?.localMatchChanged(id, song: song, automatic: true)
            owner?.localCatalogChanged?()
        }
        self.stems.changed = { [weak self] in self?.tick() }
    }
    deinit { work?.cancel(); release?.cancel(); balance.cancel(); preplay?.cancel(); fade?.tail?.dispose() }

    // Both original planners share this lifecycle; unavailable profiles remain unknown, never fabricated.
    func configure(enabled: Bool, maximumSeconds: Double, mode: String = "crossfade", performance: Bool = false) throws {
        guard ["crossfade", "automix"].contains(mode), maximumSeconds.isFinite, (1...25).contains(maximumSeconds) else {
            throw MobileFailure("invalid-transition-settings")
        }
        guard self.enabled != enabled || self.maximumSeconds != maximumSeconds || self.mode != mode || self.performance != performance else { return }
        self.enabled = enabled; self.maximumSeconds = maximumSeconds; self.mode = mode; self.performance = performance
        profiles.useBeatModel(enabled && mode == "automix" ? beatModel : nil)
        stems.useModel(enabled && mode == "automix" ? stemModel : nil)
        owner?.streamOutput?.setAnalysisEnabled(enabled)
        if !enabled { cancel(); owner?.prefetch() } else { invalidatePlan() }
        tick()
    }
    func invalidatePlan() {
        revision &+= 1
        if let bending { try? bending.requestTempo(rate: 1) }; bending = nil
        armed = false; plannedFrom = nil; plannedTo = nil
        work?.cancel(); work = nil; release?.cancel(); release = nil; key = nil; plan = nil
        if let preplay { discardPreplay(preplay) }
    }
    func cancel(preservingAnalysis: Bool = false, gainGeneration: UInt64? = nil) {
        balance.cancel()
        invalidatePlan()
        // Seeking unchanged decks invalidates timing, not their measured bytes. A fading tail is obsolete.
        if !preservingAnalysis || fade != nil { profiles.cancel(); lyrics.cancel(); stems.cancel() }
        fade?.tail?.dispose(); fade = nil
        if let gainGeneration { owner?.streamOutput?.transitionGain.cancel(ifCurrent: gainGeneration) }
        else { owner?.streamOutput?.transitionGain.cancel() }
    }
    func removeTail(where matches: ([String: Any]) -> Bool) {
        if let fade, matches(fade.tailSong) { cancel() }
    }
    func invalidateProvider(_ provider: String) { invalidatePlan(); profiles.invalidateProvider(provider); lyrics.invalidateProvider(provider); stems.remove(provider: provider) }
    func providerLyricsChanged(_ provider: String) {
        lyrics.invalidateProvider(provider)
        if !isFading { invalidatePlan(); tick() }
    }
    func songLyricsChanged(_ song: [String: Any], automatic: Bool = false) {
        lyrics.invalidateSong(song, selection: !automatic)
        if !isFading {
            // Optional provider updates follow the same arm lead as native matching callbacks.
            // A deliberate choice still replans, once its saved selection is available below.
            if !automatic || !armed { invalidatePlan() }
            tick()
        }
    }
    func cancelLyricRequests() { lyrics.cancel() }
    func cancelAnalysis() { profiles.cancel(); stems.cancel() }
    func modelsChanged(beat: URL?, stems model: URL? = nil) {
        beatModel = beat; stemModel = model
        let previous = stems.revision
        stems.useModel(enabled && mode == "automix" ? model : nil)
        // Crossfade needs measured silence edges, never model inference just because weights exist.
        let changed = profiles.useBeatModel(enabled && mode == "automix" ? beat : nil)
        guard changed || previous != stems.revision else { return }
        // An audible transition keeps its schedule; subsequent plans use the new measured capability.
        if !isFading { invalidatePlan(); tick() }
    }
    func mediaAvailable(_ identity: String) { profiles.mediaAvailable(identity); stems.mediaAvailable(identity); tick() }
    func clearingMediaCache(_ active: Bool) {
        clearingCache = active
        if active { profiles.cancel(); stems.cancel(); stems.clearOnline(); if !isFading { invalidatePlan() } }
        else { tick() }
    }
    func localMediaRemoved(_ id: String) { stems.remove(localID: id); if !isFading { invalidatePlan() } }
    func localMediaChanged() { stems.localMediaChanged(); if !isFading { invalidatePlan() } }
    func resourcePressure(_ active: Bool) {
        profiles.resourcePressure(active)
        stems.resourcePressure(active)
        // A cleared window also revokes its vocal-end evidence, including within the arm lead.
        if active, !isFading { invalidatePlan() }
    }
    func cacheSettingsChanged() { profiles.resetOnline(); if !isFading { invalidatePlan(); tick() } }
    func localLyricsChanged(_ id: String) {
        lyrics.invalidate(id)
        // An active handover keeps its audible schedule; the new file applies to subsequent planning.
        if !isFading { invalidatePlan(); tick() }
    }
    func localLyricsPriorityChanged(_ priority: String) {
        guard lyrics.setLocalPriority(priority) else { return }
        // Keep an audible handover; subsequent plans use the newly selected source.
        if !isFading { invalidatePlan(); tick() }
    }

    func lyricSettingsChanged(_ settings: NativeLyricSettings) {
        guard lyrics.setSettings(settings) else { return }
        if !isFading { invalidatePlan() }
        updateLyrics()
    }
    func updateLyrics() {
        guard let owner, owner.intentToPlay, let current = owner.currentSong else { lyrics.update([]); return }
        var songs = [current]
        if let next = owner.nextIndex(automatic: true), owner.queue.indices.contains(next),
           differentSongs(current, owner.queue[next]) { songs.append(owner.queue[next]) }
        lyrics.update(songs)
    }

    // Native media time decides readiness; the shared render clock decides when a scheduled fade is over.
    func tick() {
        updateLyrics()
        guard let owner else { return }
        if let fade {
            guard fade.epoch == owner.generation else { cancel(gainGeneration: fade.gainGeneration); return }
            let clock = owner.streamOutput?.transitionGain.clock
            // Tail EOF removes its stem source and revokes that generation. Waiting only for the
            // old curve's clock would then leave isFading stuck forever and prevent the next preload.
            if owner.streamOutput?.transitionGain.isCurrent(fade.gainGeneration) != true {
                cancel(gainGeneration: fade.gainGeneration); owner.prefetch(); owner.publish(); return
            }
            // The audio callback already returned the current deck. Never wait for an absolute
            // curve end from the old host timeline, or start balance correction for that curve.
            if clock?.generation == fade.gainGeneration, clock?.stemClockInvalid == true {
                cancel(gainGeneration: fade.gainGeneration); owner.prefetch(); owner.publish(); return
            }
            if !fade.masterBalance, clock?.generation == fade.gainGeneration, clock?.stemFailed == true,
               let output = owner.streamOutput, let outgoing = fade.tail, let incoming = owner.stream {
                self.fade?.masterBalance = true
                let elapsed = max(0, ((clock?.renderedEnd ?? 0) - (clock?.curveStart ?? 0)) / 44100)
                Task { @MainActor [weak self] in
                    guard let self, self.fade?.gainGeneration == fade.gainGeneration else { return }
                    self.startBalance(output: output, outgoing: outgoing, incoming: incoming, song: fade.tailSong,
                        seconds: max(0, fade.seconds - elapsed), generation: fade.gainGeneration)
                }
            }
            if clock?.generation == fade.gainGeneration, let start = clock?.curveStart, let end = clock?.renderedEnd,
               end >= start + (fade.seconds + 0.15) * 44100 {
                if !fade.cached { owner.cachePlayedSong(fade.tailSong, source: fade.sourceURL) }
                cancel(gainGeneration: fade.gainGeneration); owner.prefetch(); owner.publish()
            }
            return
        }
        guard enabled, mode != "automix" || !lyrics.awaitingSelection,
              owner.usesStereoOutput, owner.intentToPlay, owner.outputIsPlaying,
              owner.repeatMode != "one", owner.queue.count >= 2,
              owner.queue.indices.contains(owner.index) || owner.repeatMode == "all",
              let outgoing = owner.stream, !outgoing.seeking, !outgoing.hasEnded,
              let pending = owner.preparedStream, !pending.entry.hasFailed, !pending.entry.hasEnded,
              owner.nextIndex(automatic: true) == pending.index,
              let currentSong = owner.currentSong,
              differentSongs(currentSong, owner.queue[pending.index]) else { return }
        let upcomingSong = owner.queue[pending.index]
        var sources: [String: URL] = [:]
        for (song, url) in [(currentSong, outgoing.sourceURL), (upcomingSong, pending.entry.sourceURL)] {
            if let identity = NativeProfileIdentity(song) { sources[identity.key] = url }
        }
        if !clearingCache { profiles.update([currentSong, upcomingSong], sources: sources) }

        if mode == "automix", !clearingCache { stems.update(outgoing: currentSong, incoming: upcomingSong) }
        if Date().timeIntervalSince(pending.at) >= 120 {
            owner.discardPrepared(); owner.prefetch(); return
        }
        let fromDuration = owner.playbackDuration
        let toDuration = pending.entry.duration > 0 ? pending.entry.duration
            : (owner.queue[pending.index]["durationMs"] as? Double ?? 0) / 1000
        // Pin the original plan within its one-second arm lead. Replanning just past a bar line
        // can choose a later bar and postpone a valid handover forever.
        if let plan, plan.kind == "fade", owner.playbackPosition >= plan.outStart - 1 { armed = true }
        let current = Key(epoch: owner.generation, queueRevision: owner.queueRevision,
                          profileRevision: armed ? (key?.profileRevision ?? profiles.revision) : profiles.revision,
                          lyricRevision: armed ? (key?.lyricRevision ?? lyrics.revision) : lyrics.revision,
                          stemRevision: armed ? (key?.stemRevision ?? stems.revision) : stems.revision,
                          planningSecond: armed ? (key?.planningSecond ?? 0) : (mode == "automix" ? Int(owner.playbackPosition) : 0),
                          outgoing: ObjectIdentifier(outgoing), incoming: ObjectIdentifier(pending.entry),
                          fromDuration: fromDuration, toDuration: toDuration)
        if key != current {
            invalidatePlan(); key = current
            let position = owner.playbackPosition, maximum = maximumSeconds, selectedMode = mode
            work = Task { @MainActor [weak self] in
                guard let self else { return }
                guard !Task.isCancelled, self.matches(current) else { self.discardStale(current); return }
                do {
                    let measured = await owner.streamOutput?.deckState(outgoing.audio)
                    guard !Task.isCancelled, self.matches(current) else { self.discardStale(current); return }
                    let live = measured.flatMap { state in state.time.flatMap { CACurrentMediaTime() - $0 < 0.25 ? state : nil } }
                    let fromProfile = self.profiles.value(currentSong), toProfile = self.profiles.value(upcomingSong)
                    let tail = self.stems.value(currentSong, role: .tail)
                    let vocalEnd = tail.flatMap { window in window.vocalEnd.map { window.from + $0 } }
                    let bpm = fromProfile?["bpm"] as? Double ?? live?.tempo?.bpm
                    let request: [String: Any] = ["version": 1,
                        "settings": ["mode": selectedMode, "crossfadeMaxSec": maximum, "performance": self.performance],
                        "from": ["duration": fromDuration, "lines": self.lyrics.value(currentSong) as Any? ?? NSNull(), "profile": fromProfile as Any? ?? NSNull(), "vocalEnd": vocalEnd as Any? ?? NSNull()],
                        "to": ["duration": toDuration, "lines": self.lyrics.value(upcomingSong) as Any? ?? NSNull(), "profile": toProfile as Any? ?? NSNull()],
                        "bpm": bpm as Any? ?? NSNull(), "at": position]
                    let result = try await self.planner.plan(JSONSerialization.data(withJSONObject: request))
                    guard !Task.isCancelled else { return }
                    guard self.matches(current) else { self.discardStale(current); return }
                    if result.kind == "fade" { try await pending.entry.preparePosition(result.inStart) }
                    guard !Task.isCancelled else { return }
                    guard self.matches(current) else { self.discardStale(current); return }
                    self.work = nil; self.plan = result
                    self.plannedFrom = fromProfile; self.plannedTo = toProfile; self.tick()
                } catch { if !Task.isCancelled, self.key == current { self.work = nil } }
            }
            return
        }
        guard work == nil, let plan, plan.kind == "fade" else { return }
        // Original one-second arm lead also pays for stem observations while the next deck runs muted.
        let lead = pairedStems(currentSong, upcomingSong, plan: plan) == nil ? 0.0 : 1.0
        let delay = plan.outStart - owner.playbackPosition - lead
        if delay > 0 {
            if release == nil {
                let stamp = revision
                let release = DispatchWorkItem { [weak self] in
                    guard let self, self.revision == stamp else { return }
                    self.release = nil; self.tick()
                }
                self.release = release
                // A native deadline avoids quantizing the fade start to the 250ms UI snapshot timer.
                // tick rechecks media time after stalls; seek/pause/queue changes invalidate this deadline.
                DispatchQueue.main.asyncAfter(deadline: .now() + max(0.005, delay), execute: release)
            }
            return
        }
        release?.cancel(); release = nil
        begin(plan, key: current)
    }

    private func matches(_ expected: Key) -> Bool {
        guard let owner, enabled, owner.intentToPlay, owner.outputIsPlaying, key == expected,
              owner.generation == expected.epoch, owner.queueRevision == expected.queueRevision,
              (armed || profiles.revision == expected.profileRevision),
              (armed || lyrics.revision == expected.lyricRevision),
              (armed || stems.revision == expected.stemRevision),
              let current = owner.stream, let next = owner.preparedStream,
              ObjectIdentifier(current) == expected.outgoing, ObjectIdentifier(next.entry) == expected.incoming,
              owner.nextIndex(automatic: true) == next.index else { return false }
        return true
    }
    private func discardStale(_ expected: Key) {
        if key == expected { invalidatePlan() }
    }
    private func discardPreplay(_ session: NativeMutedPreplay) {
        guard preplay === session else { return }
        preplay = nil
        if owner?.preparedStream?.entry === session.incoming { owner?.preparedStream = nil }
        session.cancel()
    }
    private func differentSongs(_ first: [String: Any], _ second: [String: Any]) -> Bool {
        guard let a = first["sourceRef"] as? [String: Any], let b = second["sourceRef"] as? [String: Any] else { return false }
        // Same identity contract as getPlaybackSongKey: provider metadata and URL are not song identity.
        return a["kind"] as? String != b["kind"] as? String
            || a["providerId"] as? String != b["providerId"] as? String
            || a["mediaId"] as? String != b["mediaId"] as? String
    }
    private func pairedStems(_ from: [String: Any], _ to: [String: Any], plan: NativeTransitionPlan)
        -> (outgoing: NativeStemWindow, incoming: NativeStemWindow)? {
        guard mode == "automix", plan.style != "beatCut", plan.overlap >= 0.8,
              let out = stems.value(from, role: .tail), let input = stems.value(to, role: .head) else { return nil }
        return (out, input)
    }
    @MainActor private func prepareStems(_ pair: (outgoing: NativeStemWindow, incoming: NativeStemWindow)?,
        session: NativeMutedPreplay, handover: NativeMasterHandover, plan: NativeTransitionPlan, expected: Key) async throws -> NativeLiveStemHandover? {
        guard let pair, let envelope = handover.envelope, envelope.overlap >= 0.8 else { return nil }
        guard let original = handover.sourceClock else {
            if let trace, let owner, let output = owner.streamOutput, let outgoing = owner.stream {
                let state = outgoing.tempoState
                trace.mark("preplay.source", operation: UUID(), metrics: [
                    "raw": NSNumber(value: state?.phase == .raw), "rate": NSNumber(value: state?.rate ?? -1),
                    "frame": NSNumber(value: state?.mediaClock?.sampleEnd ?? -1),
                    "renderedEnd": NSNumber(value: output.transitionGain.clock.renderedEnd ?? -1),
                    "bufferedSeconds": NSNumber(value: outgoing.audio.bufferedDuration),
                    "playing": NSNumber(value: outgoing.playing), "seeking": NSNumber(value: outgoing.seeking),
                    "ended": NSNumber(value: outgoing.hasEnded)])
            }
            stemPreparationStatus = "clock-unavailable:source"; return nil
        }
        guard let clocks = try await session.clocks(current: { [weak self] in self?.matches(expected) == true }, trace: trace) else {
            stemPreparationStatus = "clock-unavailable:pair"; return nil
        }
        guard clocks.outgoing.source == original.source, clocks.outgoing.epoch == original.epoch else {
            stemPreparationStatus = "clock-unavailable:changed"; return nil
        }
        guard let start = NativeStemAlignment.start(clock: original, hold: envelope.hold),
              let outAt = clocks.outgoing.position(at: start), let inAt = clocks.incoming.position(at: start) else { return nil }
        func bar(_ profile: [String: Any]?) -> Double? {
            guard let bpm = profile?["bpm"] as? Double, bpm > 0 else { return nil }
            return 60 / bpm * ((profile?["beatsPerBar"] as? Double).flatMap { $0 > 0 ? $0 : nil } ?? 4)
        }
        let context = NativeStemAnalysisContext(windowSec: envelope.overlap, outAt: outAt, inAt: inAt,
            outgoingBarSec: bar(plannedFrom), incomingBarSec: bar(plannedTo),
            outgoingBpm: plannedFrom?["bpm"] as? Double, outgoingDownbeat: plannedFrom?["downbeatOffset"] as? Double,
            outgoingBeatsPerBar: plannedFrom?["beatsPerBar"] as? Double,
            incomingSectionStart: plannedTo?["sectionStart"] as? Double, expansion: plan.expansion,
            keysClash: plan.relation == "clashing")
        let prepared = try await stemHandover.prepareLive(outgoing: pair.outgoing, incoming: pair.incoming,
            options: context, clocks: clocks, plannedStart: start, planner: planner)
        stemPreparationStatus = prepared == nil
            ? "uncovered out=\(outAt) in=\(inAt) seconds=\(envelope.overlap) tail=\(pair.outgoing.frames) head=\(pair.incoming.frames)" : (prepared?.expansion == nil ? "ready" : "ready-expansion")
        return prepared
    }
    @MainActor private func startBalance(output: StreamMixOutput, outgoing: StreamOccurrence, incoming: StreamOccurrence,
                              song: [String: Any], seconds: Double, generation: UInt64) {
        balance.start(planner: planner, output: output, outgoing: outgoing, incoming: incoming,
            outgoingReference: profiles.value(song)?["loudness"] as? Double,
            incomingReference: owner?.currentSong.flatMap { profiles.value($0)?["loudness"] as? Double },
            overlap: seconds, generation: generation,
            current: { [weak self] in
                guard let self, let fade = self.fade, let owner = self.owner else { return false }
                return fade.gainGeneration == generation && fade.epoch == owner.generation && owner.intentToPlay
            })
    }

    // Validate the awaited envelope against queue intent, then hand over ownership without replacing the output graph.
    private func begin(_ plan: NativeTransitionPlan, key expected: Key) {
        guard let owner else { return }
        guard min(owner.playbackDuration, plan.outStart + plan.overlap) > owner.playbackPosition else { self.plan = nil; return }
        work = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                guard self.matches(expected), let output = self.owner?.streamOutput,
                      let outgoing = self.owner?.stream, let pending = owner.preparedStream,
                      let song = owner.currentSong else { self.discardStale(expected); return }
                let pair = self.pairedStems(song, owner.queue[pending.index], plan: plan)
                self.stemPreparationStatus = pair == nil ? "no-pair" : "awaiting-clock"
                // Retain ownership before awaiting audio-thread acknowledgement. Intent cancellation
                // can remove the muted source synchronously, before another plan can reuse it.
                let session = try NativeMutedPreplay(output: output, outgoing: outgoing, incoming: pending.entry)
                self.preplay = session
                defer { self.discardPreplay(session) }
                try await session.start(current: { [weak self] in self?.matches(expected) == true })
                self.bending = outgoing
                var handover = try await NativeMasterTransition.prepare(planner: self.planner, plan: plan,
                    output: output, outgoing: outgoing, duration: owner.playbackDuration,
                    fromProfile: self.plannedFrom, toProfile: self.plannedTo,
                    stems: pair,
                    current: { [weak self] in self?.matches(expected) == true })
                guard var envelope = handover.envelope, var cue = handover.cue else { throw MobileFailure("transition-cancelled") }
                guard !Task.isCancelled else { return }
                guard self.matches(expected) else { self.discardStale(expected); return }
                let prepared: NativeLiveStemHandover?
                do { prepared = try await self.prepareStems(pair, session: session, handover: handover, plan: plan, expected: expected) }
                catch {
                    try Task.checkCancellation()
                    guard self.matches(expected) else { self.discardStale(expected); return }
                    self.stemPreparationStatus = "failed:" + ((error as? MobileFailure)?.code ?? "unknown")
                    // Optional observations failing must preserve the original master schedule.
                    prepared = nil
                }
                if pair != nil, prepared == nil {
                    // Recompute remaining time after optional observation work; do not replay an old hold.
                    handover = try await NativeMasterTransition.prepare(planner: self.planner, plan: plan,
                        output: output, outgoing: outgoing, duration: owner.playbackDuration,
                        fromProfile: self.plannedFrom, toProfile: self.plannedTo, stems: pair,
                        current: { [weak self] in self?.matches(expected) == true })
                    guard let updated = handover.envelope, let updatedCue = handover.cue else { throw MobileFailure("transition-cancelled") }
                    envelope = updated; cue = updatedCue
                }
                let gainGeneration: UInt64
                if let prepared {
                    gainGeneration = try session.commit(prepared, fallback: envelope, current: { [weak self] in self?.matches(expected) == true })
                } else { gainGeneration = try session.commit(envelope, current: { [weak self] in self?.matches(expected) == true }) }
                self.preplay = nil
                owner.listening.finishOccurrence()
                outgoing.clearEvents()
                owner.task?.cancel(); owner.preload?.cancel(); owner.stalledRecovery?.cancel(); owner.stalledRecovery = nil
                owner.generation += 1; owner.preparedStream = nil
                owner.stream = pending.entry; owner.meter = pending.entry.meter
                owner.index = pending.index; owner.detachedSong = owner.queue[pending.index]
                owner.restoredPosition = pending.entry.position
                owner.error = nil; owner.retried = false; owner.failures = 0
                self.fade = Fade(tail: outgoing, tailSong: song, sourceURL: outgoing.sourceURL, epoch: owner.generation,
                                 gainGeneration: gainGeneration, seconds: envelope.overlap, cue: cue, hold: envelope.hold,
                                 style: envelope.style, masterBalance: prepared == nil)
                self.bending = nil
                if prepared == nil { self.startBalance(output: output, outgoing: outgoing, incoming: pending.entry,
                    song: song, seconds: handover.mediaOverlap, generation: gainGeneration) }
                // Early tail EOF does not truncate the incoming gain curve.
                outgoing.ended = { [weak self, weak outgoing] in self?.releaseTail(outgoing) }
                outgoing.failed = { [weak self, weak outgoing] in self?.releaseTail(outgoing) }
                owner.observeStream(pending.entry, epoch: owner.generation)
                self.work = nil; self.plan = nil
                owner.persist(); owner.publish()
            } catch {
                // Optional transition failure leaves the current song playing; normal EOF resolves next afresh.
                if !Task.isCancelled, self.key == expected {
                    if let bending = self.bending { try? bending.requestTempo(rate: 1) }; self.bending = nil
                    self.work = nil; self.plan = nil
                }
            }
        }
    }
    var cueSnapshot: [String: Any]? {
        guard let fade, let clock = owner?.streamOutput?.transitionGain.clock,
              clock.generation == fade.gainGeneration, !clock.stemClockInvalid,
              let start = clock.curveStart, let end = clock.renderedEnd else { return nil }
        let elapsed = max(0, (end - start) / 44100 + fade.hold)
        guard elapsed < fade.cue.seconds else { return nil }
        return ["id": fade.epoch, "style": fade.style, "seconds": fade.cue.seconds, "crossover": fade.cue.crossover,
                "periodSec": fade.cue.periodSec as Any? ?? NSNull(), "plain": fade.cue.plain ?? false, "elapsed": elapsed]
    }

    private func releaseTail(_ entry: StreamOccurrence?) {
        guard let entry, fade?.tail === entry else { return }
        if entry.hasEnded, let fade { owner?.cachePlayedSong(fade.tailSong, source: fade.sourceURL); self.fade?.cached = true }
        // A failed tail must not be counted as a fully played song.
        if entry.hasFailed { fade?.cached = true }
        entry.dispose(); fade?.tail = nil
    }
}
