import AVFoundation
import Capacitor
import CryptoKit
import Foundation
import MediaPlayer
import UIKit

private let defaultAlbumLabel = "全部歌曲"
private let defaultListeningTimezone = "Asia/Kuala_Lumpur"
private let defaultCoverRoot = "https://utbabuddha.com/api/music/album_cover"
private let musicPageSize = 200

@objc(NativeMusicPlugin)
public class NativeMusicPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeMusicPlugin"
    public let jsName = "NativeMusic"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bootstrap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refreshLibrary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCachedTrackSources", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playMusic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "togglePlayback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendToQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeFromQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playFromQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playRelative", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "toggleShuffle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cycleRepeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlaylist", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipToIndex", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRepeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProgress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let backgroundQueue = DispatchQueue(label: "com.xinya.native-music", qos: .utility)
    private var albums: [IOSAlbumRecord] = []
    private var musics: [IOSMusicRecord] = []
    private var musicById: [Int: IOSMusicRecord] = [:]
    private var queueIds: [Int] = []
    private var cachedTrackUrls: [Int: String] = [:]
    private var storedCurrentMusicId: Int?
    private var baseUrl = ""
    private var repeatMode = "off"
    private var shuffleEnabled = false
    private var listeningSessions: [IOSListeningSessionRecord] = []
    private var listeningTimezone = defaultListeningTimezone
    private var listeningTotalMinutes = 0
    private var listeningUniqueListeners = 0

    private var player: AVPlayer?
    private var currentItemEndObserver: NSObjectProtocol?
    private var nowPlayingArtworkUrl: String?
    private var artworkCacheRoot: URL?
    private var playbackMinuteTimer: Timer?
    private var legacyPlaylist: [IOSPlaylistItem] = []

    @objc override public func load() {
        configureAudioSession()
        configureRemoteCommands()
    }

    @objc func ready(_ call: CAPPluginCall) {
        let requestedBaseUrl = call.getString("baseUrl", "")
        if !requestedBaseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            baseUrl = IOSNativeMusicRepository.normalizeBaseUrl(requestedBaseUrl)
        }
        call.resolve()
    }

    @objc func bootstrap(_ call: CAPPluginCall) {
        let requestedBaseUrl = call.getString("baseUrl", "")
        let normalizedBaseUrl = IOSNativeMusicRepository.normalizeBaseUrl(requestedBaseUrl)
        let includeListening = call.getBool("includeListening", false)
        if normalizedBaseUrl.isEmpty {
            call.reject("baseUrl is required")
            return
        }

        backgroundQueue.async { [weak self] in
            guard let self else { return }
            do {
                let authorizationHeader = nativeAuthorizationHeader()
                let cookie = authorizationHeader == nil
                    ? self.cookieHeaderBlocking(for: "\(normalizedBaseUrl)/api/music/albums")
                    : nil
                let library = try IOSNativeMusicRepository.loadLibrary(
                    baseUrl: normalizedBaseUrl,
                    cookie: cookie,
                    authorizationHeader: authorizationHeader,
                    includeListening: includeListening
                )
                let queue = IOSNativeMusicRepository.loadQueueState(
                    baseUrl: normalizedBaseUrl,
                    cookie: cookie,
                    authorizationHeader: authorizationHeader,
                    musics: library.musics
                )
                DispatchQueue.main.async {
                    self.baseUrl = normalizedBaseUrl
                    self.applyLibraryPayload(library, restoreQueue: queue)
                    self.updateNowPlayingInfo()
                    call.resolve(self.buildSnapshot())
                }
            } catch {
                self.rejectOnMain(call, error)
            }
        }
    }

    @objc func refreshLibrary(_ call: CAPPluginCall) {
        let includeListening = call.getBool("includeListening", !listeningSessions.isEmpty)
        let baseUrlSnapshot = baseUrl
        if baseUrlSnapshot.isEmpty {
            call.reject("baseUrl is required before loading native music data")
            return
        }

        backgroundQueue.async { [weak self] in
            guard let self else { return }
            do {
                let authorizationHeader = nativeAuthorizationHeader()
                let cookie = authorizationHeader == nil
                    ? self.cookieHeaderBlocking(for: "\(baseUrlSnapshot)/api/music/albums")
                    : nil
                let library = try IOSNativeMusicRepository.loadLibrary(
                    baseUrl: baseUrlSnapshot,
                    cookie: cookie,
                    authorizationHeader: authorizationHeader,
                    includeListening: includeListening
                )
                DispatchQueue.main.async {
                    self.applyLibraryPayload(library, restoreQueue: nil)
                    self.updateNowPlayingInfo()
                    call.resolve(self.buildSnapshot())
                }
            } catch {
                self.rejectOnMain(call, error)
            }
        }
    }

    @objc func getSnapshot(_ call: CAPPluginCall) {
        call.resolve(buildSnapshot())
    }

    @objc func setCachedTrackSources(_ call: CAPPluginCall) {
        var nextCachedTrackUrls: [Int: String] = [:]
        for rawItem in call.getArray("items", []) {
            guard let item = rawItem as? JSObject else { continue }
            guard let id = jsInt(item["id"]), id > 0 else { continue }
            guard let url = item["url"] as? String else { continue }
            let trimmedUrl = url.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedUrl.isEmpty {
                nextCachedTrackUrls[id] = trimmedUrl
            }
        }
        cachedTrackUrls = nextCachedTrackUrls
        call.resolve()
    }

    @objc func playMusic(_ call: CAPPluginCall) {
        guard let musicId = call.getInt("musicId") else {
            call.reject("musicId is required")
            return
        }

        var nextQueueIds = normalizeQueueIds(call.getArray("queueIds", []).compactMap(jsInt))
        if nextQueueIds.isEmpty {
            nextQueueIds = normalizeQueueIds([musicId])
        } else if !nextQueueIds.contains(musicId) {
            nextQueueIds.insert(musicId, at: 0)
        }
        if !musicById.keys.contains(musicId) {
            call.reject("musicId does not exist")
            return
        }

        queueIds = nextQueueIds
        storedCurrentMusicId = musicId
        loadCurrentTrack(positionMs: 0, playWhenReady: true) { [weak self] error in
            guard let self else { return }
            if let error {
                call.reject(error.localizedDescription)
                return
            }
            self.persistQueueStateAsync()
            call.resolve(self.buildSnapshot(preferredCurrentMusicId: musicId))
        }
    }

    @objc func togglePlayback(_ call: CAPPluginCall) {
        if isPlaying {
            player?.pause()
            updatePlaybackMinuteReporting()
            updateNowPlayingInfo()
            emitPlayStateChanged(false)
            call.resolve(buildSnapshot())
            return
        }

        if player?.currentItem != nil, resolveCurrentMusicId() != nil {
            configureAudioSession()
            player?.play()
            updatePlaybackMinuteReporting()
            updateNowPlayingInfo()
            emitPlayStateChanged(true)
            call.resolve(buildSnapshot())
            return
        }

        if storedCurrentMusicId == nil, let firstId = queueIds.first {
            storedCurrentMusicId = firstId
        }
        loadCurrentTrack(positionMs: 0, playWhenReady: true) { [weak self] error in
            guard let self else { return }
            if let error {
                call.reject(error.localizedDescription)
                return
            }
            self.persistQueueStateAsync()
            call.resolve(self.buildSnapshot())
        }
    }

    @objc func appendToQueue(_ call: CAPPluginCall) {
        guard let musicId = call.getInt("musicId") else {
            call.reject("musicId is required")
            return
        }
        if musicById[musicId] == nil {
            call.reject("musicId does not exist")
            return
        }
        if !queueIds.contains(musicId) {
            queueIds.append(musicId)
        }
        if storedCurrentMusicId == nil {
            storedCurrentMusicId = queueIds.first
        }
        persistQueueStateAsync()
        call.resolve(buildSnapshot())
    }

    @objc func removeFromQueue(_ call: CAPPluginCall) {
        guard let musicId = call.getInt("musicId") else {
            call.reject("musicId is required")
            return
        }
        queueIds.removeAll { $0 == musicId }
        if queueIds.isEmpty {
            storedCurrentMusicId = nil
            stopPlayback()
        } else if storedCurrentMusicId == musicId {
            storedCurrentMusicId = queueIds.first
            loadCurrentTrack(positionMs: 0, playWhenReady: isPlaying) { _ in }
        }
        persistQueueStateAsync()
        call.resolve(buildSnapshot())
    }

    @objc func clearQueue(_ call: CAPPluginCall) {
        queueIds.removeAll()
        storedCurrentMusicId = nil
        stopPlayback()
        persistQueueStateAsync()
        call.resolve(buildSnapshot())
    }

    @objc func playFromQueue(_ call: CAPPluginCall) {
        guard let musicId = call.getInt("musicId") else {
            call.reject("musicId is required")
            return
        }
        if !queueIds.contains(musicId) {
            call.reject("musicId is not in queue")
            return
        }
        storedCurrentMusicId = musicId
        loadCurrentTrack(positionMs: 0, playWhenReady: true) { [weak self] error in
            guard let self else { return }
            if let error {
                call.reject(error.localizedDescription)
                return
            }
            self.persistQueueStateAsync()
            call.resolve(self.buildSnapshot(preferredCurrentMusicId: musicId))
        }
    }

    @objc func playRelative(_ call: CAPPluginCall) {
        guard let step = call.getInt("step"), step == -1 || step == 1 else {
            call.reject("step must be -1 or 1")
            return
        }

        if step < 0, currentPositionMs > 3_000 {
            player?.seek(to: .zero)
            updateNowPlayingInfo()
            call.resolve(buildSnapshot())
            return
        }

        guard let nextId = resolveRelativeMusicId(step: step) else {
            call.resolve(buildSnapshot())
            return
        }

        storedCurrentMusicId = nextId
        loadCurrentTrack(positionMs: 0, playWhenReady: true) { [weak self] error in
            guard let self else { return }
            if let error {
                call.reject(error.localizedDescription)
                return
            }
            self.persistQueueStateAsync()
            call.resolve(self.buildSnapshot(preferredCurrentMusicId: nextId))
        }
    }

    @objc func toggleShuffle(_ call: CAPPluginCall) {
        shuffleEnabled.toggle()
        call.resolve(buildSnapshot())
    }

    @objc func cycleRepeat(_ call: CAPPluginCall) {
        if repeatMode == "off" {
            repeatMode = "all"
        } else if repeatMode == "all" {
            repeatMode = "one"
        } else {
            repeatMode = "off"
        }
        call.resolve(buildSnapshot())
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        guard let positionMs = call.getDouble("positionMs") else {
            call.reject("positionMs is required")
            return
        }
        seekToMs(positionMs)
        call.resolve(buildSnapshot())
    }

    @objc func setPlaylist(_ call: CAPPluginCall) {
        let tracks = call.getArray("tracks", [])
        if tracks.isEmpty {
            call.reject("tracks array is required")
            return
        }
        legacyPlaylist = tracks.compactMap { rawItem in
            guard let item = rawItem as? JSObject else { return nil }
            return IOSPlaylistItem(
                id: jsInt(item["id"]) ?? -1,
                url: (item["url"] as? String) ?? "",
                title: (item["title"] as? String) ?? "",
                album: (item["album"] as? String) ?? defaultAlbumLabel,
                coverUrl: (item["coverUrl"] as? String) ?? ""
            )
        }
        repeatMode = normalizeRepeatMode(call.getString("repeatMode", "off"))
        let startIndex = min(max(call.getInt("startIndex", 0), 0), max(legacyPlaylist.count - 1, 0))
        loadLegacyPlaylistItem(at: startIndex, playWhenReady: true) { [weak self] error in
            guard let self else { return }
            if let error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(self.buildSnapshot())
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), !url.isEmpty else {
            call.reject("url is required")
            return
        }
        legacyPlaylist = [
            IOSPlaylistItem(
                id: -1,
                url: url,
                title: call.getString("title", ""),
                album: call.getString("album", defaultAlbumLabel),
                coverUrl: call.getString("coverUrl", "")
            )
        ]
        loadLegacyPlaylistItem(at: 0, playWhenReady: true) { error in
            if let error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve()
        }
    }

    @objc func skipToIndex(_ call: CAPPluginCall) {
        guard let index = call.getInt("index") else {
            call.reject("index is required")
            return
        }
        if !legacyPlaylist.isEmpty {
            loadLegacyPlaylistItem(at: index, playWhenReady: true) { error in
                if let error {
                    call.reject(error.localizedDescription)
                    return
                }
                call.resolve()
            }
            return
        }
        if index >= 0, index < queueIds.count {
            storedCurrentMusicId = queueIds[index]
            loadCurrentTrack(positionMs: 0, playWhenReady: true) { error in
                if let error {
                    call.reject(error.localizedDescription)
                    return
                }
                call.resolve()
            }
            return
        }
        call.reject("index is out of range")
    }

    @objc func setRepeat(_ call: CAPPluginCall) {
        repeatMode = normalizeRepeatMode(call.getString("mode", "off"))
        call.resolve(buildSnapshot())
    }

    @objc func pause(_ call: CAPPluginCall) {
        player?.pause()
        updatePlaybackMinuteReporting()
        updateNowPlayingInfo()
        emitPlayStateChanged(false)
        call.resolve(buildSnapshot())
    }

    @objc func resume(_ call: CAPPluginCall) {
        configureAudioSession()
        player?.play()
        updatePlaybackMinuteReporting()
        updateNowPlayingInfo()
        emitPlayStateChanged(true)
        call.resolve(buildSnapshot())
    }

    @objc func getProgress(_ call: CAPPluginCall) {
        call.resolve([
            "positionMs": currentPositionMs,
            "durationMs": currentDurationMs,
            "isPlaying": isPlaying,
            "currentTrackId": resolveCurrentMusicId() ?? -1
        ])
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopPlayback()
        call.resolve(buildSnapshot())
    }

    private func applyLibraryPayload(_ payload: IOSLibraryPayload, restoreQueue: IOSQueuePayload?) {
        albums = payload.albums
        musics = payload.musics
        musicById = Dictionary(uniqueKeysWithValues: payload.musics.map { ($0.id, $0) })
        listeningSessions = payload.listeningSessions
        listeningTimezone = payload.listeningTimezone
        listeningTotalMinutes = payload.listeningTotalMinutes
        listeningUniqueListeners = payload.listeningUniqueListeners

        if let restoreQueue {
            queueIds = normalizeQueueIds(restoreQueue.queueIds)
            if let currentMusicId = restoreQueue.currentMusicId, musicById[currentMusicId] != nil {
                storedCurrentMusicId = currentMusicId
            } else {
                storedCurrentMusicId = queueIds.first
            }
            return
        }

        queueIds = normalizeQueueIds(queueIds)
        if let currentMusicId = storedCurrentMusicId, musicById[currentMusicId] == nil {
            storedCurrentMusicId = queueIds.first
        }
    }

    private func buildSnapshot(preferredCurrentMusicId: Int? = nil) -> JSObject {
        let currentMusicId = resolveCurrentMusicId(preferredCurrentMusicId: preferredCurrentMusicId)
        let currentMusic = currentMusicId.flatMap { musicById[$0] }
        let queue = queueIds.compactMap { musicById[$0]?.jsObject() }
        return [
            "albums": albums.map { $0.jsObject() },
            "musics": musics.map { $0.jsObject() },
            "queue": queue,
            "currentMusic": jsNullable(currentMusic?.jsObject()),
            "currentMusicId": jsNullable(currentMusicId),
            "isPlaying": isPlaying,
            "hasPlaybackSession": currentMusicId != nil && !queueIds.isEmpty,
            "shuffleEnabled": shuffleEnabled,
            "repeatMode": repeatMode,
            "progressMs": currentPositionMs,
            "durationMs": currentDurationMs,
            "listeningTimezone": listeningTimezone,
            "listeningSessions": listeningSessions.map { $0.jsObject() },
            "listeningTotalMinutes": listeningTotalMinutes,
            "listeningUniqueListeners": listeningUniqueListeners
        ]
    }

    private func loadCurrentTrack(
        positionMs: Double,
        playWhenReady: Bool,
        completion: @escaping (Error?) -> Void
    ) {
        guard let currentMusicId = resolveCurrentMusicId(), let music = musicById[currentMusicId] else {
            completion(NSError(domain: "NativeMusic", code: 1, userInfo: [NSLocalizedDescriptionKey: "Playback queue is empty"]))
            return
        }

        let playbackUrl = cachedTrackUrls[music.id] ?? "\(baseUrl)/api/music/download/\(music.id)"
        let item = IOSPlaylistItem(
            id: music.id,
            url: playbackUrl,
            title: music.title,
            album: music.album?.name ?? defaultAlbumLabel,
            coverUrl: resolveMusicCoverUrl(music)
        )
        loadPlayerItem(item, positionMs: positionMs, playWhenReady: playWhenReady) { [weak self] error in
            guard let self else { return }
            if error == nil {
                self.storedCurrentMusicId = music.id
                self.notifyListeners("trackChanged", data: ["id": music.id, "index": self.currentQueueIndex])
            }
            completion(error)
        }
    }

    private func loadLegacyPlaylistItem(
        at requestedIndex: Int,
        playWhenReady: Bool,
        completion: @escaping (Error?) -> Void
    ) {
        if requestedIndex < 0 || requestedIndex >= legacyPlaylist.count {
            completion(NSError(domain: "NativeMusic", code: 2, userInfo: [NSLocalizedDescriptionKey: "index is out of range"]))
            return
        }
        let item = legacyPlaylist[requestedIndex]
        storedCurrentMusicId = item.id > 0 ? item.id : nil
        loadPlayerItem(item, positionMs: 0, playWhenReady: playWhenReady, completion: completion)
    }

    private func loadPlayerItem(
        _ item: IOSPlaylistItem,
        positionMs: Double,
        playWhenReady: Bool,
        completion: @escaping (Error?) -> Void
    ) {
        guard let url = URL(string: item.url) else {
            completion(NSError(domain: "NativeMusic", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid playback URL"]))
            return
        }

        configureAudioSession()
        resolveHttpHeaders(for: item.url) { [weak self] httpHeaders in
            guard let self else { return }
            let assetOptions = self.assetOptions(for: url, httpHeaders: httpHeaders)
            let asset = AVURLAsset(url: url, options: assetOptions)
            let playerItem = AVPlayerItem(asset: asset)
            self.installEndObserver(for: playerItem)
            if let player = self.player {
                player.replaceCurrentItem(with: playerItem)
            } else {
                self.player = AVPlayer(playerItem: playerItem)
                self.player?.allowsExternalPlayback = true
            }
            if positionMs > 0 {
                self.player?.seek(to: CMTime(seconds: max(positionMs, 0) / 1000, preferredTimescale: 600))
            }
            self.nowPlayingArtworkUrl = nil
            self.updateNowPlayingInfo(for: item)
            if playWhenReady {
                self.player?.play()
            } else {
                self.player?.pause()
            }
            self.updatePlaybackMinuteReporting()
            self.emitPlayStateChanged(playWhenReady)
            completion(nil)
        }
    }

    private func installEndObserver(for item: AVPlayerItem) {
        if let currentItemEndObserver {
            NotificationCenter.default.removeObserver(currentItemEndObserver)
        }
        currentItemEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.handleTrackEnded()
        }
    }

    private func handleTrackEnded() {
        updatePlaybackMinuteReporting()
        if repeatMode == "one" {
            player?.seek(to: .zero)
            player?.play()
            return
        }

        guard let nextId = resolveRelativeMusicId(step: 1) else {
            emitPlayStateChanged(false)
            notifyListeners("trackEnded", data: [:])
            updateNowPlayingInfo()
            return
        }

        storedCurrentMusicId = nextId
        loadCurrentTrack(positionMs: 0, playWhenReady: true) { [weak self] _ in
            self?.persistQueueStateAsync()
        }
    }

    private func resolveRelativeMusicId(step: Int) -> Int? {
        guard !queueIds.isEmpty else { return nil }
        if shuffleEnabled, queueIds.count > 1 {
            let currentId = resolveCurrentMusicId()
            let candidates = queueIds.filter { $0 != currentId }
            return candidates.randomElement()
        }
        let currentIndex = currentQueueIndex >= 0 ? currentQueueIndex : 0
        let nextIndex = currentIndex + step
        if nextIndex >= 0 && nextIndex < queueIds.count {
            return queueIds[nextIndex]
        }
        if repeatMode == "all" {
            return step > 0 ? queueIds.first : queueIds.last
        }
        return nil
    }

    private var currentQueueIndex: Int {
        guard let currentMusicId = storedCurrentMusicId else { return -1 }
        return queueIds.firstIndex(of: currentMusicId) ?? -1
    }

    private func resolveCurrentMusicId(preferredCurrentMusicId: Int? = nil) -> Int? {
        if let preferredCurrentMusicId, musicById[preferredCurrentMusicId] != nil {
            storedCurrentMusicId = preferredCurrentMusicId
            return preferredCurrentMusicId
        }
        if let storedCurrentMusicId, musicById[storedCurrentMusicId] != nil {
            return storedCurrentMusicId
        }
        if let firstId = queueIds.first {
            storedCurrentMusicId = firstId
            return firstId
        }
        return nil
    }

    private func normalizeQueueIds(_ rawQueueIds: [Int]) -> [Int] {
        var seen = Set<Int>()
        var normalized: [Int] = []
        for musicId in rawQueueIds where musicById[musicId] != nil {
            if !seen.contains(musicId) {
                seen.insert(musicId)
                normalized.append(musicId)
            }
        }
        return normalized
    }

    private func persistQueueStateAsync() {
        let baseUrlSnapshot = baseUrl
        let queueIdsSnapshot = queueIds
        let currentMusicIdSnapshot = resolveCurrentMusicId()
        if baseUrlSnapshot.isEmpty {
            return
        }
        backgroundQueue.async { [weak self] in
            guard let self else { return }
            do {
                let authorizationHeader = nativeAuthorizationHeader()
                let cookie = authorizationHeader == nil
                    ? self.cookieHeaderBlocking(for: "\(baseUrlSnapshot)/api/music/queue")
                    : nil
                try IOSNativeMusicRepository.saveQueueState(
                    baseUrl: baseUrlSnapshot,
                    cookie: cookie,
                    authorizationHeader: authorizationHeader,
                    queueIds: queueIdsSnapshot,
                    currentMusicId: currentMusicIdSnapshot
                )
            } catch {
                NSLog("NativeMusic saveQueueState failed: \(error.localizedDescription)")
            }
        }
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            NSLog("NativeMusic AVAudioSession failed: \(error.localizedDescription)")
        }
    }

    private func configureRemoteCommands() {
        UIApplication.shared.beginReceivingRemoteControlEvents()
        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.nextTrackCommand.isEnabled = true
        commandCenter.previousTrackCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.isEnabled = true

        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.resumeFromRemote()
            return .success
        }
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.pauseFromRemote()
            return .success
        }
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.playRelativeFromRemote(step: 1)
            return .success
        }
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.playRelativeFromRemote(step: -1)
            return .success
        }
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.seekToMs(event.positionTime * 1000)
            return .success
        }
    }

    private func resumeFromRemote() {
        DispatchQueue.main.async {
            self.configureAudioSession()
            self.player?.play()
            self.updatePlaybackMinuteReporting()
            self.updateNowPlayingInfo()
            self.emitPlayStateChanged(true)
        }
    }

    private func pauseFromRemote() {
        DispatchQueue.main.async {
            self.player?.pause()
            self.updatePlaybackMinuteReporting()
            self.updateNowPlayingInfo()
            self.emitPlayStateChanged(false)
        }
    }

    private func playRelativeFromRemote(step: Int) {
        DispatchQueue.main.async {
            guard let nextId = self.resolveRelativeMusicId(step: step) else { return }
            self.storedCurrentMusicId = nextId
            self.loadCurrentTrack(positionMs: 0, playWhenReady: true) { [weak self] _ in
                self?.persistQueueStateAsync()
            }
        }
    }

    private func seekToMs(_ positionMs: Double) {
        let target = CMTime(seconds: max(positionMs, 0) / 1000, preferredTimescale: 600)
        player?.seek(to: target)
        updateNowPlayingInfo()
    }

    private func stopPlayback() {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        if let currentItemEndObserver {
            NotificationCenter.default.removeObserver(currentItemEndObserver)
            self.currentItemEndObserver = nil
        }
        legacyPlaylist.removeAll()
        nowPlayingArtworkUrl = nil
        updatePlaybackMinuteReporting()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        emitPlayStateChanged(false)
    }

    private func updateNowPlayingInfo(for item: IOSPlaylistItem? = nil) {
        let currentItem = item ?? currentNowPlayingItem()
        guard let currentItem else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: currentItem.title.isEmpty ? "Untitled" : currentItem.title,
            MPMediaItemPropertyAlbumTitle: currentItem.album.isEmpty ? defaultAlbumLabel : currentItem.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentPositionMs / 1000,
            MPMediaItemPropertyPlaybackDuration: currentDurationMs / 1000,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]
        if let existingArtwork = MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork] {
            info[MPMediaItemPropertyArtwork] = existingArtwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        loadArtworkIfNeeded(currentItem.coverUrl)
    }

    private func currentNowPlayingItem() -> IOSPlaylistItem? {
        if !legacyPlaylist.isEmpty, let legacyId = storedCurrentMusicId {
            return legacyPlaylist.first { $0.id == legacyId }
        }
        guard let currentMusicId = resolveCurrentMusicId(), let music = musicById[currentMusicId] else {
            return nil
        }
        return IOSPlaylistItem(
            id: music.id,
            url: cachedTrackUrls[music.id] ?? "\(baseUrl)/api/music/download/\(music.id)",
            title: music.title,
            album: music.album?.name ?? defaultAlbumLabel,
            coverUrl: resolveMusicCoverUrl(music)
        )
    }

    private func loadArtworkIfNeeded(_ coverUrl: String) {
        let trimmedUrl = coverUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedUrl.isEmpty || nowPlayingArtworkUrl == trimmedUrl {
            return
        }
        nowPlayingArtworkUrl = trimmedUrl
        backgroundQueue.async { [weak self] in
            guard let self else { return }
            if let image = self.loadCachedArtworkImage(trimmedUrl) {
                let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                DispatchQueue.main.async {
                    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                    info[MPMediaItemPropertyArtwork] = artwork
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
                }
            }
        }
    }

    private func loadCachedArtworkImage(_ urlString: String) -> UIImage? {
        do {
            let root = try ensureArtworkCacheRoot()
            let hash = nativeMusicSha256(urlString)
            let extensionName = URL(string: urlString)?.pathExtension
            let fileExtension = extensionName.flatMap { $0.isEmpty ? nil : ".\($0)" } ?? ".img"
            let fileUrl = root.appendingPathComponent("\(hash)\(fileExtension)")
            if FileManager.default.fileExists(atPath: fileUrl.path) {
                return UIImage(contentsOfFile: fileUrl.path)
            }
            guard let url = URL(string: urlString) else {
                return nil
            }
            let data = try Data(contentsOf: url)
            guard let image = UIImage(data: data) else {
                return nil
            }
            try? data.write(to: fileUrl, options: .atomic)
            return image
        } catch {
            NSLog("NativeMusic artwork cache failed: \(error.localizedDescription)")
            return nil
        }
    }

    private func ensureArtworkCacheRoot() throws -> URL {
        if let artworkCacheRoot {
            return artworkCacheRoot
        }
        let root = try FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("native-album-cover-cache", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        artworkCacheRoot = root
        return root
    }

    private func updatePlaybackMinuteReporting() {
        playbackMinuteTimer?.invalidate()
        playbackMinuteTimer = nil
        guard isPlaying, let musicId = resolveCurrentMusicId(), musicId > 0, !baseUrl.isEmpty else {
            return
        }
        playbackMinuteTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.reportPlaybackMinute(musicId: musicId)
        }
    }

    private func reportPlaybackMinute(musicId: Int) {
        let baseUrlSnapshot = baseUrl
        backgroundQueue.async { [weak self] in
            guard let self else { return }
            do {
                let targetUrl = "\(baseUrlSnapshot)/api/music/add_one_minute/\(musicId)"
                let authorizationHeader = nativeAuthorizationHeader()
                let cookie = authorizationHeader == nil ? self.cookieHeaderBlocking(for: targetUrl) : nil
                try IOSNativeMusicRepository.addOneMinute(
                    baseUrl: baseUrlSnapshot,
                    cookie: cookie,
                    authorizationHeader: authorizationHeader,
                    musicId: musicId
                )
            } catch {
                NSLog("NativeMusic addOneMinute failed: \(error.localizedDescription)")
            }
        }
    }

    private var isPlaying: Bool {
        player?.rate ?? 0 > 0
    }

    private var currentPositionMs: Double {
        guard let player else { return 0 }
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? max(seconds * 1000, 0) : 0
    }

    private var currentDurationMs: Double {
        guard let duration = player?.currentItem?.duration.seconds else { return 0 }
        return duration.isFinite && duration > 0 ? duration * 1000 : 0
    }

    private func resolveMusicCoverUrl(_ music: IOSMusicRecord) -> String {
        if let image = music.album?.image, !image.isEmpty {
            return image
        }
        if let coverUrl = music.coverUrl, !coverUrl.isEmpty {
            return coverUrl
        }
        return "\(baseUrl)/api/music/album_cover/defult.jpeg"
    }

    private func normalizeRepeatMode(_ value: String) -> String {
        if value == "one" || value == "all" {
            return value
        }
        return "off"
    }

    private func assetOptions(for url: URL, httpHeaders: [String: String]?) -> [String: Any]? {
        guard url.scheme == "http" || url.scheme == "https" else {
            return nil
        }
        guard let httpHeaders, !httpHeaders.isEmpty else {
            return nil
        }
        return [AVURLAssetHTTPHeaderFieldsKey: httpHeaders]
    }

    private func resolveHttpHeaders(for urlString: String, completion: @escaping ([String: String]?) -> Void) {
        if let authorizationHeader = nativeAuthorizationHeader() {
            completion(["Authorization": authorizationHeader])
            return
        }
        resolveCookieHeader(for: urlString) { cookieHeader in
            guard let cookieHeader, !cookieHeader.isEmpty else {
                completion(nil)
                return
            }
            completion(["Cookie": cookieHeader])
        }
    }

    private func resolveCookieHeader(for urlString: String, completion: @escaping (String?) -> Void) {
        guard let webView else {
            completion(nil)
            return
        }
        let url = URL(string: urlString)
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            completion(cookieHeader(cookies: cookies, for: url))
        }
    }

    private func cookieHeaderBlocking(for urlString: String) -> String? {
        if Thread.isMainThread {
            return nil
        }
        guard let webView else {
            return nil
        }
        let semaphore = DispatchSemaphore(value: 0)
        var header: String?
        let url = URL(string: urlString)
        DispatchQueue.main.async {
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                header = cookieHeader(cookies: cookies, for: url)
                semaphore.signal()
            }
        }
        _ = semaphore.wait(timeout: .now() + 2)
        return header
    }

    private func emitPlayStateChanged(_ isPlaying: Bool) {
        notifyListeners("playStateChanged", data: ["isPlaying": isPlaying])
    }

    private func rejectOnMain(_ call: CAPPluginCall, _ error: Error) {
        DispatchQueue.main.async {
            call.reject(error.localizedDescription)
        }
    }
}

private struct IOSAlbumRecord {
    let id: Int
    let name: String
    let coverUrl: String?
    let image: String?
    let albumTotalMinutes: Double
    let description: String?
    let createdAt: String?

    func jsObject() -> JSObject {
        [
            "id": id,
            "name": name,
            "cover_url": jsNullable(coverUrl),
            "image": jsNullable(image),
            "album_total_minutes": albumTotalMinutes,
            "description": jsNullable(description),
            "created_at": jsNullable(createdAt)
        ]
    }
}

private struct IOSMusicRecord {
    let id: Int
    let title: String
    let albumId: Int?
    let artistId: Int?
    let fileName: String?
    let fileType: String?
    let fileSize: Int?
    let duration: Int?
    let coverUrl: String?
    let playMinutes: Double
    let createdAt: String?
    let album: IOSAlbumRecord?

    func jsObject() -> JSObject {
        [
            "id": id,
            "title": title,
            "album_id": jsNullable(albumId),
            "artist_id": jsNullable(artistId),
            "file_name": jsNullable(fileName),
            "file_type": jsNullable(fileType),
            "file_size": jsNullable(fileSize),
            "duration": jsNullable(duration),
            "cover_url": jsNullable(coverUrl),
            "play_minutes": playMinutes,
            "created_at": jsNullable(createdAt),
            "album": jsNullable(album?.jsObject())
        ]
    }
}

private struct IOSListeningSessionRecord {
    let key: String
    let musicUserPlayMinuteId: Int?
    let musicId: Int?
    let musicTitle: String?
    let userId: Int?
    let username: String?
    let displayName: String?
    var startAt: String
    var endAt: String
    var minuteCount: Int

    func jsObject() -> JSObject {
        [
            "key": key,
            "music_user_play_minute_id": jsNullable(musicUserPlayMinuteId),
            "music_id": jsNullable(musicId),
            "music_title": jsNullable(musicTitle),
            "user_id": jsNullable(userId),
            "username": jsNullable(username),
            "display_name": jsNullable(displayName),
            "start_at": startAt,
            "end_at": endAt,
            "minute_count": minuteCount
        ]
    }
}

private struct IOSPlaylistItem {
    let id: Int
    let url: String
    let title: String
    let album: String
    let coverUrl: String
}

private struct IOSLibraryPayload {
    var albums: [IOSAlbumRecord] = []
    var musics: [IOSMusicRecord] = []
    var listeningSessions: [IOSListeningSessionRecord] = []
    var listeningTimezone = defaultListeningTimezone
    var listeningTotalMinutes = 0
    var listeningUniqueListeners = 0
}

private struct IOSQueuePayload {
    var queueIds: [Int] = []
    var currentMusicId: Int?
}

private struct IOSMinuteLogRecord {
    let id: Int
    let createdAt: String?
    let musicUserPlayMinuteId: Int?
    let musicId: Int?
    let musicTitle: String?
    let userId: Int?
    let username: String?
    let displayName: String?
}

private enum IOSNativeMusicRepository {
    static func normalizeBaseUrl(_ value: String?) -> String {
        var normalized = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        while normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized
    }

    static func loadLibrary(
        baseUrl: String,
        cookie: String?,
        authorizationHeader: String? = nil,
        includeListening: Bool
    ) throws -> IOSLibraryPayload {
        let normalizedBaseUrl = normalizeBaseUrl(baseUrl)
        var payload = IOSLibraryPayload()
        let albumItems = try readArray(
            url: "\(normalizedBaseUrl)/api/music/albums",
            cookie: cookie,
            authorizationHeader: authorizationHeader
        )
        var albumById: [Int: IOSAlbumRecord] = [:]
        for item in albumItems {
            let album = parseAlbum(baseUrl: normalizedBaseUrl, data: item)
            payload.albums.append(album)
            albumById[album.id] = album
        }

        let firstPage = try readObject(
            url: "\(normalizedBaseUrl)/api/music/list?per_page=\(musicPageSize)&page=1",
            cookie: cookie,
            authorizationHeader: authorizationHeader
        )
        appendMusicPage(
            target: &payload.musics,
            baseUrl: normalizedBaseUrl,
            items: firstPage["musics"] as? [[String: Any]],
            albumById: albumById
        )
        let totalPages = max(1, intValue(firstPage["total_pages"]) ?? 1)
        if totalPages > 1 {
            for page in 2...totalPages {
                let nextPage = try readObject(
                    url: "\(normalizedBaseUrl)/api/music/list?per_page=\(musicPageSize)&page=\(page)",
                    cookie: cookie,
                    authorizationHeader: authorizationHeader
                )
                appendMusicPage(
                    target: &payload.musics,
                    baseUrl: normalizedBaseUrl,
                    items: nextPage["musics"] as? [[String: Any]],
                    albumById: albumById
                )
            }
        }

        if includeListening {
            do {
                let listeningPayload = try readObject(
                    url: "\(normalizedBaseUrl)/api/music/minute_logs?per_page=240",
                    cookie: cookie,
                    authorizationHeader: authorizationHeader
                )
                payload.listeningTimezone = stringValue(listeningPayload["timezone"]) ?? defaultListeningTimezone
                payload.listeningSessions = groupMinuteLogs(listeningPayload["items"] as? [[String: Any]])
                payload.listeningTotalMinutes = payload.listeningSessions.reduce(0) { $0 + max($1.minuteCount, 0) }
                payload.listeningUniqueListeners = countUniqueListeners(payload.listeningSessions)
            } catch {
                payload.listeningTimezone = defaultListeningTimezone
            }
        }

        return payload
    }

    static func loadQueueState(
        baseUrl: String,
        cookie: String?,
        authorizationHeader: String? = nil,
        musics: [IOSMusicRecord]
    ) -> IOSQueuePayload {
        var payload = IOSQueuePayload()
        let existingIds = Set(musics.map { $0.id })
        do {
            let response = try readObject(
                url: "\(normalizeBaseUrl(baseUrl))/api/music/queue",
                cookie: cookie,
                authorizationHeader: authorizationHeader
            )
            if let queue = response["queue"] as? [String: Any] {
                let queueIds = (queue["queue_ids"] as? [Any] ?? [])
                    .compactMap(intValue)
                    .filter { existingIds.contains($0) }
                payload.queueIds = uniqueOrdered(queueIds)
                if let currentMusicId = intValue(queue["current_music_id"]), existingIds.contains(currentMusicId) {
                    payload.currentMusicId = currentMusicId
                } else {
                    payload.currentMusicId = payload.queueIds.first
                }
                return payload
            }
        } catch {
        }

        do {
            let response = try readObject(
                url: "\(normalizeBaseUrl(baseUrl))/api/music/last_played",
                cookie: cookie,
                authorizationHeader: authorizationHeader
            )
            let lastPlayed = response["last_played"] as? [String: Any]
            if let musicId = intValue(lastPlayed?["music_id"]), existingIds.contains(musicId) {
                payload.queueIds = musics
                    .sorted {
                        if $0.playMinutes != $1.playMinutes {
                            return $0.playMinutes > $1.playMinutes
                        }
                        return $0.title < $1.title
                    }
                    .map { $0.id }
                payload.currentMusicId = musicId
            }
        } catch {
        }
        return payload
    }

    static func saveQueueState(
        baseUrl: String,
        cookie: String?,
        authorizationHeader: String? = nil,
        queueIds: [Int],
        currentMusicId: Int?
    ) throws {
        var body: [String: Any] = ["queue_ids": queueIds]
        body["current_music_id"] = currentMusicId.map { $0 as Any } ?? NSNull()
        try sendJson(
            url: "\(normalizeBaseUrl(baseUrl))/api/music/queue",
            cookie: cookie,
            authorizationHeader: authorizationHeader,
            method: "POST",
            body: body
        )
    }

    static func addOneMinute(
        baseUrl: String,
        cookie: String?,
        authorizationHeader: String? = nil,
        musicId: Int
    ) throws {
        try sendJson(
            url: "\(normalizeBaseUrl(baseUrl))/api/music/add_one_minute/\(musicId)",
            cookie: cookie,
            authorizationHeader: authorizationHeader,
            method: "POST",
            body: nil
        )
    }

    private static func appendMusicPage(
        target: inout [IOSMusicRecord],
        baseUrl: String,
        items: [[String: Any]]?,
        albumById: [Int: IOSAlbumRecord]
    ) {
        for item in items ?? [] {
            target.append(parseMusic(baseUrl: baseUrl, data: item, albumById: albumById))
        }
    }

    private static func parseAlbum(baseUrl: String, data: [String: Any]) -> IOSAlbumRecord {
        let rawImage = nonEmptyString(data["image"])
        let rawCover = nonEmptyString(data["cover_url"])
        return IOSAlbumRecord(
            id: intValue(data["id"]) ?? 0,
            name: stringValue(data["name"]) ?? "",
            coverUrl: normalizeCoverUrl(baseUrl: baseUrl, coverUrl: rawCover, fallbackUrl: rawImage),
            image: normalizeRemoteCoverUrl(preferredUrl: rawImage, fallbackUrl: rawCover),
            albumTotalMinutes: doubleValue(data["album_total_minutes"]) ?? 0,
            description: nonEmptyString(data["description"]),
            createdAt: nonEmptyString(data["created_at"])
        )
    }

    private static func parseMusic(
        baseUrl: String,
        data: [String: Any],
        albumById: [Int: IOSAlbumRecord]
    ) -> IOSMusicRecord {
        let albumId = intValue(data["album_id"])
        let albumData = data["album"] as? [String: Any]
        let album = albumData.map { parseAlbum(baseUrl: baseUrl, data: $0) } ?? albumId.flatMap { albumById[$0] }
        return IOSMusicRecord(
            id: intValue(data["id"]) ?? 0,
            title: stringValue(data["title"]) ?? "",
            albumId: albumId,
            artistId: intValue(data["artist_id"]),
            fileName: nonEmptyString(data["file_name"]),
            fileType: nonEmptyString(data["file_type"]),
            fileSize: intValue(data["file_size"]),
            duration: intValue(data["duration"]),
            coverUrl: normalizeCoverUrl(baseUrl: baseUrl, coverUrl: stringValue(data["cover_url"]), fallbackUrl: nil),
            playMinutes: doubleValue(data["play_minutes"]) ?? 0,
            createdAt: nonEmptyString(data["created_at"]),
            album: album
        )
    }

    private static func groupMinuteLogs(_ items: [[String: Any]]?) -> [IOSListeningSessionRecord] {
        let logs = (items ?? [])
            .map {
                IOSMinuteLogRecord(
                    id: intValue($0["id"]) ?? 0,
                    createdAt: nonEmptyString($0["created_at"]),
                    musicUserPlayMinuteId: intValue($0["music_user_play_minute_id"]),
                    musicId: intValue($0["music_id"]),
                    musicTitle: nonEmptyString($0["music_title"]),
                    userId: intValue($0["user_id"]),
                    username: nonEmptyString($0["username"]),
                    displayName: nonEmptyString($0["display_name"])
                )
            }
            .sorted {
                let leftTime = $0.createdAt ?? ""
                let rightTime = $1.createdAt ?? ""
                if leftTime != rightTime {
                    return leftTime < rightTime
                }
                return $0.id < $1.id
            }

        var sessions: [IOSListeningSessionRecord] = []
        var currentSession: IOSListeningSessionRecord?
        var currentLog: IOSMinuteLogRecord?
        var currentMinuteIndex: Int?

        for log in logs {
            guard let createdAt = log.createdAt, let minuteIndex = minuteIndex(createdAt) else {
                continue
            }

            if
                var session = currentSession,
                let previousLog = currentLog,
                let previousMinuteIndex = currentMinuteIndex,
                isSameListeningStream(previousLog, log),
                minuteIndex - previousMinuteIndex <= 1
            {
                session.endAt = createdAt
                session.minuteCount += 1
                sessions[sessions.count - 1] = session
                currentSession = session
                currentLog = log
                currentMinuteIndex = minuteIndex
                continue
            }

            let keyPrefix = log.musicUserPlayMinuteId ?? log.musicId ?? 0
            let session = IOSListeningSessionRecord(
                key: "\(keyPrefix):\(createdAt):\(log.id)",
                musicUserPlayMinuteId: log.musicUserPlayMinuteId,
                musicId: log.musicId,
                musicTitle: log.musicTitle,
                userId: log.userId,
                username: log.username,
                displayName: log.displayName,
                startAt: createdAt,
                endAt: createdAt,
                minuteCount: 1
            )
            sessions.append(session)
            currentSession = session
            currentLog = log
            currentMinuteIndex = minuteIndex
        }

        return sessions.sorted { $0.endAt > $1.endAt }
    }

    private static func countUniqueListeners(_ sessions: [IOSListeningSessionRecord]) -> Int {
        var seen = Set<String>()
        for session in sessions {
            seen.insert("\(session.userId ?? 0):\(session.username ?? ""):\(session.displayName ?? "")")
        }
        return seen.count
    }

    private static func isSameListeningStream(_ left: IOSMinuteLogRecord, _ right: IOSMinuteLogRecord) -> Bool {
        if let leftId = left.musicUserPlayMinuteId, let rightId = right.musicUserPlayMinuteId {
            return leftId == rightId
        }
        return left.musicId == right.musicId &&
            left.userId == right.userId &&
            left.username == right.username &&
            left.displayName == right.displayName
    }

    private static func minuteIndex(_ value: String) -> Int? {
        let parts = value.split(separator: "T")
        if parts.count != 2 { return nil }
        let date = parts[0].split(separator: "-").compactMap { Int($0) }
        let time = parts[1].split(separator: ":").compactMap { Int($0) }
        if date.count != 3 || time.count < 2 { return nil }
        return (((date[0] * 12 + date[1]) * 31 + date[2]) * 24 + time[0]) * 60 + time[1]
    }

    private static func readArray(url: String, cookie: String?, authorizationHeader: String?) throws -> [[String: Any]] {
        let value = try requestJson(
            url: url,
            cookie: cookie,
            authorizationHeader: authorizationHeader,
            method: "GET",
            body: nil
        )
        return value as? [[String: Any]] ?? []
    }

    private static func readObject(url: String, cookie: String?, authorizationHeader: String?) throws -> [String: Any] {
        let value = try requestJson(
            url: url,
            cookie: cookie,
            authorizationHeader: authorizationHeader,
            method: "GET",
            body: nil
        )
        return value as? [String: Any] ?? [:]
    }

    @discardableResult
    private static func sendJson(
        url: String,
        cookie: String?,
        authorizationHeader: String?,
        method: String,
        body: [String: Any]?
    ) throws -> [String: Any] {
        let value = try requestJson(
            url: url,
            cookie: cookie,
            authorizationHeader: authorizationHeader,
            method: method,
            body: body
        )
        return value as? [String: Any] ?? [:]
    }

    private static func requestJson(
        url: String,
        cookie: String?,
        authorizationHeader: String?,
        method: String,
        body: [String: Any]?
    ) throws -> Any {
        guard let requestUrl = URL(string: url) else {
            throw NSError(domain: "NativeMusic", code: 10, userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(url)"])
        }

        var request = URLRequest(url: requestUrl)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let authorizationHeader, !authorizationHeader.isEmpty {
            request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        } else if let cookie, !cookie.isEmpty {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var responseData: Data?
        var response: URLResponse?
        var responseError: Error?
        URLSession.shared.dataTask(with: request) { data, urlResponse, error in
            responseData = data
            response = urlResponse
            responseError = error
            semaphore.signal()
        }.resume()
        semaphore.wait()

        if let responseError {
            throw responseError
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        let data = responseData ?? Data()
        if status < 200 || status >= 300 {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "NativeMusic", code: status, userInfo: [NSLocalizedDescriptionKey: "HTTP \(status) for \(url): \(text)"])
        }
        if data.isEmpty {
            return [:]
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    private static func normalizeRemoteCoverUrl(preferredUrl: String?, fallbackUrl: String?) -> String {
        if let preferredUrl, preferredUrl.hasPrefix("http://") || preferredUrl.hasPrefix("https://") {
            return preferredUrl
        }
        if let filename = extractCoverFilename(preferredUrl) ?? extractCoverFilename(fallbackUrl) {
            return "\(defaultCoverRoot)/\(filename)"
        }
        return "\(defaultCoverRoot)/defult.jpeg"
    }

    private static func normalizeCoverUrl(baseUrl: String, coverUrl: String?, fallbackUrl: String?) -> String {
        let normalizedBaseUrl = normalizeBaseUrl(baseUrl)
        guard let coverUrl = coverUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !coverUrl.isEmpty else {
            if let filename = extractCoverFilename(fallbackUrl) {
                return "\(normalizedBaseUrl)/api/music/album_cover/\(filename)"
            }
            return "\(normalizedBaseUrl)/api/music/album_cover/defult.jpeg"
        }
        if coverUrl.hasPrefix("http://") || coverUrl.hasPrefix("https://") {
            return coverUrl
        }
        if coverUrl.hasPrefix("/") {
            return "\(normalizedBaseUrl)\(coverUrl)"
        }
        let filename = coverUrl.split(separator: "/").last.map(String.init) ?? coverUrl
        return "\(normalizedBaseUrl)/api/music/album_cover/\(filename)"
    }

    private static func extractCoverFilename(_ value: String?) -> String? {
        guard let value = value, !value.isEmpty else { return nil }
        let sanitized = value.split(separator: "#")[0].split(separator: "?")[0]
        return sanitized.split(separator: "/").last.map(String.init).flatMap { $0.isEmpty ? nil : $0 }
    }
}

private func cookieHeader(cookies: [HTTPCookie], for url: URL?) -> String? {
    guard let host = url?.host else {
        return nil
    }
    let pairs = cookies
        .filter { cookie in
            let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
            return host == domain || host.hasSuffix(".\(domain)")
        }
        .map { "\($0.name)=\($0.value)" }
    return pairs.isEmpty ? nil : pairs.joined(separator: "; ")
}

private func nativeAuthorizationHeader() -> String? {
    guard let accessToken = readNativeAuthAccessToken(), !accessToken.isEmpty else {
        return nil
    }
    return "Bearer \(accessToken)"
}

private func uniqueOrdered(_ values: [Int]) -> [Int] {
    var seen = Set<Int>()
    var result: [Int] = []
    for value in values where !seen.contains(value) {
        seen.insert(value)
        result.append(value)
    }
    return result
}

private func stringValue(_ value: Any?) -> String? {
    if value is NSNull { return nil }
    if let value = value as? String { return value }
    if let value = value as? NSNumber { return value.stringValue }
    return nil
}

private func nonEmptyString(_ value: Any?) -> String? {
    guard let value = stringValue(value)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
        return nil
    }
    return value
}

private func intValue(_ value: Any?) -> Int? {
    if value is NSNull { return nil }
    if let value = value as? Int { return value }
    if let value = value as? NSNumber { return value.intValue }
    if let value = value as? String { return Int(value) }
    return nil
}

private func doubleValue(_ value: Any?) -> Double? {
    if value is NSNull { return nil }
    if let value = value as? Double { return value }
    if let value = value as? Float { return Double(value) }
    if let value = value as? Int { return Double(value) }
    if let value = value as? NSNumber { return value.doubleValue }
    if let value = value as? String { return Double(value) }
    return nil
}

private func jsInt(_ value: JSValue?) -> Int? {
    intValue(value)
}

private func jsNullable(_ value: String?) -> JSValue {
    guard let value else { return NSNull() }
    return value
}

private func jsNullable(_ value: Int?) -> JSValue {
    guard let value else { return NSNull() }
    return value
}

private func jsNullable(_ value: JSObject?) -> JSValue {
    guard let value else { return NSNull() }
    return value
}

private func nativeMusicSha256(_ value: String) -> String {
    let digest = SHA256.hash(data: Data(value.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}
