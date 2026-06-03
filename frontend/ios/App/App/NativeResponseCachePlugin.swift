import Capacitor
import CryptoKit
import Foundation

@objc(NativeResponseCachePlugin)
public class NativeResponseCachePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeResponseCachePlugin"
    public let jsName = "NativeResponseCache"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setEntry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEntry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "invalidate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trim", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAll", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "com.xinya.native-response-cache", qos: .utility)
    private let cacheDirName = "native-response-cache"
    private let maxCacheBytes: Int64 = 20 * 1024 * 1024
    private var cacheRoot: URL?

    @objc override public func load() {
        try? ensureCacheRoot()
    }

    @objc func setEntry(_ call: CAPPluginCall) {
        guard let cacheKey = call.getString("cacheKey")?.trimmingCharacters(in: .whitespacesAndNewlines), !cacheKey.isEmpty else {
            call.reject("cacheKey is required")
            return
        }

        let url = call.getString("url", "")
        let status = call.getInt("status", 200)
        let statusText = call.getString("statusText", "OK")
        let headers = call.getObject("headers") ?? [:]
        let body = call.getString("body", "")

        queue.async { [weak self] in
            guard let self else { return }
            do {
                try self.writeEntry(
                    cacheKey: cacheKey,
                    url: url,
                    status: status,
                    statusText: statusText,
                    headers: headers,
                    body: body
                )
                self.resolve(call)
            } catch {
                self.reject(call, error, fallback: "setEntry failed")
            }
        }
    }

    @objc func getEntry(_ call: CAPPluginCall) {
        guard let cacheKey = call.getString("cacheKey")?.trimmingCharacters(in: .whitespacesAndNewlines), !cacheKey.isEmpty else {
            call.reject("cacheKey is required")
            return
        }

        queue.async { [weak self] in
            guard let self else { return }
            do {
                guard let entry = try self.readEntry(cacheKey) else {
                    self.resolve(call, ["exists": false])
                    return
                }
                self.resolve(call, [
                    "exists": true,
                    "url": entry.url,
                    "status": entry.status,
                    "statusText": entry.statusText,
                    "headers": entry.headers,
                    "body": entry.body,
                    "updatedAt": entry.updatedAt
                ])
            } catch {
                self.reject(call, error, fallback: "getEntry failed")
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
        let maxBytes = requestedMax.map { Swift.max(0, $0) } ?? maxCacheBytes

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

    private func writeEntry(
        cacheKey: String,
        url: String,
        status: Int,
        statusText: String,
        headers: JSObject,
        body: String
    ) throws {
        let bodyUrl = try bodyFile(cacheKey)
        let metaUrl = try metaFile(cacheKey)
        try Data(body.utf8).write(to: bodyUrl, options: .atomic)
        try writeMeta([
            "cacheKey": cacheKey,
            "url": url,
            "status": status,
            "statusText": statusText,
            "fileName": bodyUrl.lastPathComponent,
            "headers": headers,
            "updatedAt": responseCacheNowMilliseconds()
        ], to: metaUrl)
        try trimToLimit(maxCacheBytes)
    }

    private func readEntry(_ cacheKey: String) throws -> ResponseCacheEntry? {
        let metaUrl = try metaFile(cacheKey)
        guard var meta = readMeta(metaUrl) else {
            return nil
        }
        guard let bodyUrl = resolveBodyFile(meta), FileManager.default.fileExists(atPath: bodyUrl.path) else {
            try? FileManager.default.removeItem(at: metaUrl)
            return nil
        }
        let body = (try? String(contentsOf: bodyUrl, encoding: .utf8)) ?? ""
        let updatedAt = responseCacheNowMilliseconds()
        meta["updatedAt"] = updatedAt
        try? writeMeta(meta, to: metaUrl)

        return ResponseCacheEntry(
            url: meta["url"] as? String ?? "",
            status: responseCacheInt(meta["status"]) ?? 200,
            statusText: meta["statusText"] as? String ?? "OK",
            headers: normalizeHeaders(meta["headers"] as? [String: Any]),
            body: body,
            updatedAt: updatedAt
        )
    }

    private func deleteEntry(_ cacheKey: String) throws {
        let metaUrl = try metaFile(cacheKey)
        if let meta = readMeta(metaUrl), let bodyUrl = resolveBodyFile(meta) {
            try? FileManager.default.removeItem(at: bodyUrl)
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
                if let bodyUrl = resolveBodyFile(meta) {
                    try? FileManager.default.removeItem(at: bodyUrl)
                }
                try? FileManager.default.removeItem(at: file)
            }
        }
    }

    private func metaFile(_ cacheKey: String) throws -> URL {
        try ensureCacheRoot().appendingPathComponent("\(responseCacheSha256(cacheKey)).json")
    }

    private func bodyFile(_ cacheKey: String) throws -> URL {
        try ensureCacheRoot().appendingPathComponent("\(responseCacheSha256(cacheKey)).body")
    }

    private func resolveBodyFile(_ meta: [String: Any]) -> URL? {
        guard let fileName = meta["fileName"] as? String, !fileName.isEmpty, let cacheRoot else {
            return nil
        }
        return cacheRoot.appendingPathComponent(fileName)
    }

    private func trimToLimit(_ maxBytes: Int64) throws -> ResponseCacheStats {
        var entries = try readCacheIndex()
        var totalBytes = entries.reduce(Int64(0)) { $0 + $1.size }

        if totalBytes <= maxBytes {
            return ResponseCacheStats(
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

            try? FileManager.default.removeItem(at: entry.bodyUrl)
            try? FileManager.default.removeItem(at: entry.metaUrl)
            totalBytes -= entry.size
            trimmedBytes += entry.size
            trimmedEntries += 1
        }

        return try buildStats(maxBytes: maxBytes, trimmedEntries: trimmedEntries, trimmedBytes: trimmedBytes)
    }

    private func buildStats(maxBytes: Int64, trimmedEntries: Int, trimmedBytes: Int64) throws -> ResponseCacheStats {
        let entries = try readCacheIndex()
        let totalBytes = entries.reduce(Int64(0)) { $0 + $1.size }
        return ResponseCacheStats(
            entryCount: entries.count,
            totalBytes: totalBytes,
            maxBytes: maxBytes,
            trimmedEntries: trimmedEntries,
            trimmedBytes: trimmedBytes
        )
    }

    private func readCacheIndex() throws -> [ResponseCacheIndexEntry] {
        let root = try ensureCacheRoot()
        let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        var entries: [ResponseCacheIndexEntry] = []

        for file in files where file.pathExtension == "json" {
            guard let meta = readMeta(file) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            guard let bodyUrl = resolveBodyFile(meta), FileManager.default.fileExists(atPath: bodyUrl.path) else {
                try? FileManager.default.removeItem(at: file)
                continue
            }

            entries.append(ResponseCacheIndexEntry(
                metaUrl: file,
                bodyUrl: bodyUrl,
                size: Int64(fileSize(bodyUrl) + fileSize(file)),
                updatedAt: responseCacheInt64(meta["updatedAt"]) ?? 0
            ))
        }

        return entries
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

    private func normalizeHeaders(_ source: [String: Any]?) -> JSObject {
        var headers: JSObject = [:]
        for (key, value) in source ?? [:] {
            if value is NSNull {
                headers[key] = ""
                continue
            }
            headers[key] = String(describing: value)
        }
        return headers
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

private struct ResponseCacheEntry {
    let url: String
    let status: Int
    let statusText: String
    let headers: JSObject
    let body: String
    let updatedAt: Int
}

private struct ResponseCacheIndexEntry {
    let metaUrl: URL
    let bodyUrl: URL
    let size: Int64
    let updatedAt: Int64
}

private struct ResponseCacheStats {
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

private func responseCacheSha256(_ value: String) -> String {
    let digest = SHA256.hash(data: Data(value.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}

private func responseCacheNowMilliseconds() -> Int {
    Int(Date().timeIntervalSince1970 * 1000)
}

private func responseCacheInt(_ value: Any?) -> Int? {
    if value is NSNull { return nil }
    if let value = value as? Int { return value }
    if let value = value as? NSNumber { return value.intValue }
    if let value = value as? String { return Int(value) }
    return nil
}

private func responseCacheInt64(_ value: Any?) -> Int64? {
    if value is NSNull { return nil }
    if let value = value as? Int64 { return value }
    if let value = value as? Int { return Int64(value) }
    if let value = value as? NSNumber { return value.int64Value }
    if let value = value as? String { return Int64(value) }
    return nil
}
