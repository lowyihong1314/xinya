import Capacitor
import CryptoKit
import Foundation

@objc(NativeMediaCachePlugin)
public class NativeMediaCachePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeMediaCachePlugin"
    public let jsName = "NativeMediaCache"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "cacheMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "invalidate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trim", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMaxBytes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAll", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "com.xinya.native-media-cache", qos: .utility)
    private let cacheDirName = "native-media-cache"
    private let maxBytesKey = "xinya.native-media-cache.max-bytes"
    private let gigabyteBytes: Int64 = 1024 * 1024 * 1024
    private var cacheRoot: URL?

    private var minCacheBytes: Int64 { gigabyteBytes }
    private var defaultCacheBytes: Int64 { 10 * gigabyteBytes }
    private var hardMaxCacheBytes: Int64 { 50 * gigabyteBytes }
    private var maxCacheBytes: Int64 {
        let stored = UserDefaults.standard.object(forKey: maxBytesKey)
        if let number = stored as? NSNumber {
            return clampCacheBytes(number.int64Value)
        }
        if let value = stored as? Int64 {
            return clampCacheBytes(value)
        }
        if let value = stored as? Int {
            return clampCacheBytes(Int64(value))
        }
        return defaultCacheBytes
    }

    @objc override public func load() {
        try? ensureCacheRoot()
    }

    @objc func cacheMedia(_ call: CAPPluginCall) {
        guard let sourceUrl = call.getString("url")?.trimmingCharacters(in: .whitespacesAndNewlines), !sourceUrl.isEmpty else {
            call.reject("url is required")
            return
        }

        let cacheKey = call.getString("cacheKey", sourceUrl).trimmingCharacters(in: .whitespacesAndNewlines)
        if cacheKey.isEmpty {
            call.reject("cacheKey is required")
            return
        }

        let force = call.getBool("force", false)
        let staleWhileRevalidate = call.getBool("staleWhileRevalidate", false)
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let entry = try self.cacheMediaInternal(
                    sourceUrl: sourceUrl,
                    cacheKey: cacheKey,
                    force: force,
                    staleWhileRevalidate: staleWhileRevalidate
                )
                self.resolve(call, [
                    "fileUri": entry.fileUrl.absoluteString,
                    "mimeType": entry.mimeType,
                    "size": entry.size
                ])
            } catch {
                self.reject(call, error, fallback: "cacheMedia failed")
            }
        }
    }

    @objc func invalidate(_ call: CAPPluginCall) {
        let cacheKey = call.getString("cacheKey")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = call.getString("prefix")?.trimmingCharacters(in: .whitespacesAndNewlines)
        if (cacheKey?.isEmpty ?? true) && (prefix?.isEmpty ?? true) {
            call.reject("cacheKey or prefix is required")
            return
        }

        queue.async { [weak self] in
            guard let self else { return }
            do {
                if let cacheKey, !cacheKey.isEmpty {
                    try self.deleteEntry(cacheKey)
                }
                if let prefix, !prefix.isEmpty {
                    try self.deleteEntriesByPrefix(prefix)
                }
                self.resolve(call)
            } catch {
                self.reject(call, error, fallback: "invalidate failed")
            }
        }
    }

    @objc func clearAll(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let root = try self.ensureCacheRoot()
                try? FileManager.default.removeItem(at: root)
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                self.resolve(call)
            } catch {
                self.reject(call, error, fallback: "clearAll failed")
            }
        }
    }

    @objc func getStats(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let stats = try self.buildStats(maxBytes: self.maxCacheBytes, trimmedEntries: 0, trimmedBytes: 0)
                self.resolve(call, stats.result)
            } catch {
                self.reject(call, error, fallback: "getStats failed")
            }
        }
    }

    @objc func trim(_ call: CAPPluginCall) {
        let requestedMax = call.getDouble("maxBytes").map { Int64($0.rounded()) }
        let maxBytes = requestedMax.map { clampCacheBytes($0) } ?? maxCacheBytes

        queue.async { [weak self] in
            guard let self else { return }
            do {
                let stats = try self.trimToLimit(maxBytes)
                self.resolve(call, stats.result)
            } catch {
                self.reject(call, error, fallback: "trim failed")
            }
        }
    }

    @objc func setMaxBytes(_ call: CAPPluginCall) {
        guard let requestedMax = call.getDouble("maxBytes") else {
            call.reject("maxBytes is required")
            return
        }
        let maxBytes = clampCacheBytes(Int64(requestedMax.rounded()))

        queue.async { [weak self] in
            guard let self else { return }
            do {
                UserDefaults.standard.set(maxBytes, forKey: self.maxBytesKey)
                let stats = try self.trimToLimit(maxBytes)
                self.resolve(call, stats.result)
            } catch {
                self.reject(call, error, fallback: "setMaxBytes failed")
            }
        }
    }

    private func cacheMediaInternal(
        sourceUrl: String,
        cacheKey: String,
        force: Bool,
        staleWhileRevalidate: Bool
    ) throws -> MediaCacheEntry {
        let root = try ensureCacheRoot()
        let hash = mediaCacheSha256(cacheKey)
        let metaUrl = root.appendingPathComponent("\(hash).json")
        let existingMeta = readMeta(metaUrl)
        let existingFile = existingMeta.flatMap { resolveDataFile($0, root: root) }

        if !force, canReuse(existingMeta, existingFile: existingFile, sourceUrl: sourceUrl) {
            var refreshedMeta = existingMeta ?? [:]
            refreshedMeta["size"] = fileSize(existingFile!)
            refreshedMeta["updatedAt"] = mediaCacheNowMilliseconds()
            try writeMeta(refreshedMeta, to: metaUrl)
            if staleWhileRevalidate {
                refreshEntryInBackground(sourceUrl: sourceUrl, cacheKey: cacheKey)
            }
            return MediaCacheEntry(
                fileUrl: existingFile!,
                mimeType: existingMeta?["mimeType"] as? String ?? "",
                size: fileSize(existingFile!)
            )
        }

        let download = try downloadToTempFile(sourceUrl: sourceUrl, hash: hash)
        let finalUrl = root.appendingPathComponent("\(hash)\(guessExtension(finalUrl: download.finalUrl, mimeType: download.mimeType))")
        let previousFile = existingFile
        var backupUrl: URL?

        if let previousFile, previousFile == finalUrl, FileManager.default.fileExists(atPath: finalUrl.path) {
            let backup = root.appendingPathComponent("\(hash).backup")
            try? FileManager.default.removeItem(at: backup)
            try FileManager.default.moveItem(at: finalUrl, to: backup)
            backupUrl = backup
        } else if FileManager.default.fileExists(atPath: finalUrl.path) {
            try FileManager.default.removeItem(at: finalUrl)
        }

        do {
            try FileManager.default.moveItem(at: download.fileUrl, to: finalUrl)
        } catch {
            try? FileManager.default.removeItem(at: finalUrl)
            if let backupUrl, FileManager.default.fileExists(atPath: backupUrl.path) {
                try? FileManager.default.moveItem(at: backupUrl, to: finalUrl)
            }
            throw error
        }

        if let backupUrl {
            try? FileManager.default.removeItem(at: backupUrl)
        }
        if let previousFile, previousFile != finalUrl {
            try? FileManager.default.removeItem(at: previousFile)
        }
        try? FileManager.default.removeItem(at: metaUrl)

        let size = fileSize(finalUrl)
        try writeMeta([
            "cacheKey": cacheKey,
            "sourceUrl": sourceUrl,
            "finalUrl": download.finalUrl,
            "fileName": finalUrl.lastPathComponent,
            "mimeType": download.mimeType,
            "size": size,
            "updatedAt": mediaCacheNowMilliseconds()
        ], to: metaUrl)
        try trimToLimit(maxCacheBytes)

        return MediaCacheEntry(fileUrl: finalUrl, mimeType: download.mimeType, size: size)
    }

    private func refreshEntryInBackground(sourceUrl: String, cacheKey: String) {
        queue.async { [weak self] in
            do {
                _ = try self?.cacheMediaInternal(
                    sourceUrl: sourceUrl,
                    cacheKey: cacheKey,
                    force: true,
                    staleWhileRevalidate: false
                )
            } catch {
                // Keep the stale file available. This path is intentionally best-effort.
            }
        }
    }

    private func downloadToTempFile(sourceUrl: String, hash: String) throws -> MediaDownloadResult {
        guard let url = URL(string: sourceUrl) else {
            throw mediaCacheError("Invalid URL")
        }

        let root = try ensureCacheRoot()
        let tempUrl = root.appendingPathComponent("\(hash).download.\(UUID().uuidString)")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 60
        request.setValue("application/octet-stream,image/*,audio/*,video/*,*/*", forHTTPHeaderField: "Accept")
        let accessToken = readNativeAuthAccessToken()
        if let accessToken, !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        } else if let cookie = cookieHeaderBlocking(for: sourceUrl), !cookie.isEmpty {
            request.setValue(cookie, forHTTPHeaderField: "Cookie")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var downloadedUrl: URL?
        var response: URLResponse?
        var responseError: Error?
        URLSession.shared.downloadTask(with: request) { url, urlResponse, error in
            downloadedUrl = url
            response = urlResponse
            responseError = error
            semaphore.signal()
        }.resume()
        semaphore.wait()

        if let responseError {
            throw responseError
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        if status < 200 || status >= 300 {
            throw mediaCacheError("Download failed with HTTP \(status)")
        }
        guard let downloadedUrl else {
            throw mediaCacheError("Download failed")
        }

        try? FileManager.default.removeItem(at: tempUrl)
        try FileManager.default.moveItem(at: downloadedUrl, to: tempUrl)

        return MediaDownloadResult(
            fileUrl: tempUrl,
            finalUrl: response?.url?.absoluteString ?? sourceUrl,
            mimeType: normalizeMimeType((response as? HTTPURLResponse)?.mimeType)
        )
    }

    private func canReuse(_ meta: [String: Any]?, existingFile: URL?, sourceUrl: String) -> Bool {
        guard let meta, let existingFile, FileManager.default.fileExists(atPath: existingFile.path) else {
            return false
        }
        guard let cachedSourceUrl = meta["sourceUrl"] as? String, !cachedSourceUrl.isEmpty else {
            return false
        }
        return cachedSourceUrl == sourceUrl
    }

    private func resolveDataFile(_ meta: [String: Any], root: URL) -> URL? {
        guard let fileName = meta["fileName"] as? String, !fileName.isEmpty else {
            return nil
        }
        return root.appendingPathComponent(fileName)
    }

    private func trimToLimit(_ maxBytes: Int64) throws -> MediaCacheStats {
        var entries = try readCacheIndex()
        var totalBytes = entries.reduce(Int64(0)) { $0 + $1.size }

        if totalBytes <= maxBytes {
            return MediaCacheStats(
                entryCount: entries.count,
                totalBytes: totalBytes,
                maxBytes: maxBytes,
                trimmedEntries: 0,
                trimmedBytes: 0
            )
        }

        entries.sort { $0.updatedAt < $1.updatedAt }
        var trimmedEntries = 0
        var trimmedBytes: Int64 = 0

        for entry in entries {
            if totalBytes <= maxBytes || entries.count - trimmedEntries <= 1 {
                break
            }

            try? FileManager.default.removeItem(at: entry.dataUrl)
            try? FileManager.default.removeItem(at: entry.metaUrl)
            totalBytes -= entry.size
            trimmedBytes += entry.size
            trimmedEntries += 1
        }

        return try buildStats(maxBytes: maxBytes, trimmedEntries: trimmedEntries, trimmedBytes: trimmedBytes)
    }

    private func buildStats(maxBytes: Int64, trimmedEntries: Int, trimmedBytes: Int64) throws -> MediaCacheStats {
        let entries = try readCacheIndex()
        let totalBytes = entries.reduce(Int64(0)) { $0 + $1.size }
        return MediaCacheStats(
            entryCount: entries.count,
            totalBytes: totalBytes,
            maxBytes: maxBytes,
            trimmedEntries: trimmedEntries,
            trimmedBytes: trimmedBytes
        )
    }

    private func readCacheIndex() throws -> [MediaCacheIndexEntry] {
        let root = try ensureCacheRoot()
        let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        var entries: [MediaCacheIndexEntry] = []

        for file in files where file.pathExtension == "json" {
            guard let meta = readMeta(file) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            guard let dataUrl = resolveDataFile(meta, root: root), FileManager.default.fileExists(atPath: dataUrl.path) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }

            entries.append(MediaCacheIndexEntry(
                metaUrl: file,
                dataUrl: dataUrl,
                size: Int64(fileSize(dataUrl)),
                updatedAt: mediaCacheInt64(meta["updatedAt"]) ?? 0
            ))
        }

        return entries
    }

    private func deleteEntry(_ cacheKey: String) throws {
        let root = try ensureCacheRoot()
        let metaUrl = root.appendingPathComponent("\(mediaCacheSha256(cacheKey)).json")
        if let meta = readMeta(metaUrl), let fileUrl = resolveDataFile(meta, root: root) {
            try? FileManager.default.removeItem(at: fileUrl)
        }
        try? FileManager.default.removeItem(at: metaUrl)
    }

    private func deleteEntriesByPrefix(_ prefix: String) throws {
        let root = try ensureCacheRoot()
        let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        for file in files where file.pathExtension == "json" {
            guard let meta = readMeta(file) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            if (meta["cacheKey"] as? String)?.hasPrefix(prefix) == true {
                if let dataFile = resolveDataFile(meta, root: root) {
                    try? FileManager.default.removeItem(at: dataFile)
                }
                try? FileManager.default.removeItem(at: file)
            }
        }
    }

    private func ensureCacheRoot() throws -> URL {
        if let cacheRoot {
            return cacheRoot
        }
        let root = try FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent(cacheDirName, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        cacheRoot = root
        return root
    }

    private func clampCacheBytes(_ value: Int64) -> Int64 {
        Swift.max(minCacheBytes, Swift.min(value, hardMaxCacheBytes))
    }

    private func readMeta(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url) else {
            return nil
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func writeMeta(_ meta: [String: Any], to url: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: meta)
        try data.write(to: url, options: .atomic)
    }

    private func fileSize(_ url: URL) -> Int {
        ((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.intValue ?? 0
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
                header = nativeCacheCookieHeader(cookies: cookies, for: url)
                semaphore.signal()
            }
        }
        _ = semaphore.wait(timeout: .now() + 2)
        return header
    }

    private func resolve(_ call: CAPPluginCall, _ data: PluginCallResultData = [:]) {
        DispatchQueue.main.async {
            call.resolve(data)
        }
    }

    private func reject(_ call: CAPPluginCall, _ error: Error, fallback: String) {
        DispatchQueue.main.async {
            call.reject(error.localizedDescription.isEmpty ? fallback : error.localizedDescription)
        }
    }
}

private struct MediaCacheEntry {
    let fileUrl: URL
    let mimeType: String
    let size: Int
}

private struct MediaDownloadResult {
    let fileUrl: URL
    let finalUrl: String
    let mimeType: String
}

private struct MediaCacheIndexEntry {
    let metaUrl: URL
    let dataUrl: URL
    let size: Int64
    let updatedAt: Int64
}

private struct MediaCacheStats {
    let entryCount: Int
    let totalBytes: Int64
    let maxBytes: Int64
    let trimmedEntries: Int
    let trimmedBytes: Int64

    var result: PluginCallResultData {
        [
            "entryCount": entryCount,
            "totalBytes": totalBytes,
            "maxBytes": maxBytes,
            "trimmedEntries": trimmedEntries,
            "trimmedBytes": trimmedBytes
        ]
    }
}

private func mediaCacheSha256(_ value: String) -> String {
    let digest = SHA256.hash(data: Data(value.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}

private func mediaCacheNowMilliseconds() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
}

private func mediaCacheInt64(_ value: Any?) -> Int64? {
    if value is NSNull { return nil }
    if let value = value as? Int64 { return value }
    if let value = value as? Int { return Int64(value) }
    if let value = value as? NSNumber { return value.int64Value }
    if let value = value as? String { return Int64(value) }
    return nil
}

private func nativeCacheCookieHeader(cookies: [HTTPCookie], for url: URL?) -> String? {
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

private func normalizeMimeType(_ value: String?) -> String {
    let mimeType = (value ?? "").split(separator: ";").first.map(String.init) ?? ""
    return mimeType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

private func guessExtension(finalUrl: String, mimeType: String) -> String {
    if let url = URL(string: finalUrl), !url.pathExtension.isEmpty {
        return ".\(url.pathExtension)"
    }
    switch mimeType {
    case "audio/mpeg": return ".mp3"
    case "audio/mp4": return ".m4a"
    case "audio/aac": return ".aac"
    case "image/jpeg": return ".jpg"
    case "image/png": return ".png"
    case "image/webp": return ".webp"
    case "video/mp4": return ".mp4"
    default: return ".bin"
    }
}

private func mediaCacheError(_ message: String) -> NSError {
    NSError(domain: "NativeMediaCache", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
