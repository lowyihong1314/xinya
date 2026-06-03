import Capacitor
import Foundation
import PhotosUI
import UIKit
import UniformTypeIdentifiers
import WebKit

@objc(NativeAlbumUploadPlugin)
public class NativeAlbumUploadPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate, URLSessionTaskDelegate {
    public let identifier = "NativeAlbumUploadPlugin"
    public let jsName = "NativeAlbumUpload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickAndUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureAndUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private static let sessionIdentifier = "com.xinya.native-album-upload.background"
    private static var backgroundCompletionHandlers: [String: () -> Void] = [:]

    private let queue = DispatchQueue(label: "com.xinya.native-album-upload", qos: .utility)
    private let latestJobKey = "xinya.nativeAlbumUpload.latestJobId"
    private let jobKeyPrefix = "xinya.nativeAlbumUpload.job."
    private let uploadDirName = "native-album-upload"
    private let defaultBaseUrl = "https://utbabuddha.com"

    private var backgroundSession: URLSession?
    private var activePickCall: CAPPluginCall?
    private var activeCaptureCall: CAPPluginCall?

    public static func handleEventsForBackgroundURLSession(identifier: String, completionHandler: @escaping () -> Void) {
        if identifier == sessionIdentifier {
            backgroundCompletionHandlers[identifier] = completionHandler
            return
        }
        completionHandler()
    }

    @objc override public func load() {
        _ = uploadSession()
        try? ensureUploadRoot()
    }

    @objc func pickAndUpload(_ call: CAPPluginCall) {
        guard let eventId = call.getInt("eventId"), eventId > 0 else {
            call.reject("eventId is required")
            return
        }
        let baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""))
        guard !baseUrl.isEmpty else {
            call.reject("baseUrl is required")
            return
        }
        guard activePickCall == nil, activeCaptureCall == nil else {
            call.reject("A picker is already open")
            return
        }

        activePickCall = call
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.filter = .any(of: [.images, .videos])
            configuration.selectionLimit = 0
            configuration.preferredAssetRepresentationMode = .current
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    @objc func captureAndUpload(_ call: CAPPluginCall) {
        guard let eventId = call.getInt("eventId"), eventId > 0 else {
            call.reject("eventId is required")
            return
        }
        let baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""))
        guard !baseUrl.isEmpty else {
            call.reject("baseUrl is required")
            return
        }
        guard activePickCall == nil, activeCaptureCall == nil else {
            call.reject("A picker is already open")
            return
        }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            call.reject("Camera is unavailable")
            return
        }

        let mediaType = call.getString("mediaType", "image").lowercased()
        let requestedIdentifier = mediaType == "video" ? UTType.movie.identifier : UTType.image.identifier
        let availableTypes = UIImagePickerController.availableMediaTypes(for: .camera) ?? []
        guard availableTypes.contains(requestedIdentifier) else {
            call.reject(mediaType == "video" ? "Video capture is unavailable" : "Photo capture is unavailable")
            return
        }

        activeCaptureCall = call
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.mediaTypes = [requestedIdentifier]
            picker.delegate = self
            picker.videoQuality = .typeHigh
            if mediaType == "video" {
                picker.cameraCaptureMode = .video
            } else {
                picker.cameraCaptureMode = .photo
            }
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        DispatchQueue.main.async {
            picker.dismiss(animated: true)
        }

        guard let call = activePickCall else {
            return
        }
        activePickCall = nil

        let eventId = call.getInt("eventId") ?? 0
        let baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""))
        if results.isEmpty {
            resolve(call, idleStatus())
            return
        }

        queue.async { [weak self] in
            guard let self else { return }
            do {
                let jobId = UUID().uuidString
                let uploadUrl = try self.uploadEndpoint(baseUrl: baseUrl)
                let authorization = nativeAlbumAuthorizationHeader()
                let cookie = authorization == nil ? self.cookieHeaderBlocking(for: uploadUrl.absoluteString) : nil
                var status = self.newStatus(jobId: jobId, eventId: eventId, total: results.count)
                self.writeStatus(status)

                for result in results {
                    let item = try self.prepareMultipartBody(provider: result.itemProvider, jobId: jobId, eventId: eventId)
                    var request = URLRequest(url: uploadUrl)
                    request.httpMethod = "POST"
                    request.timeoutInterval = 120
                    request.setValue("application/json", forHTTPHeaderField: "Accept")
                    request.setValue("multipart/form-data; boundary=\(item.boundary)", forHTTPHeaderField: "Content-Type")
                    if let authorization, !authorization.isEmpty {
                        request.setValue(authorization, forHTTPHeaderField: "Authorization")
                    } else if let cookie, !cookie.isEmpty {
                        request.setValue(cookie, forHTTPHeaderField: "Cookie")
                    }

                    let task = self.uploadSession().uploadTask(with: request, fromFile: item.bodyUrl)
                    task.taskDescription = self.taskDescription(jobId: jobId, name: item.name, bodyPath: item.bodyUrl.path)
                    task.resume()
                }

                status["status"] = "running"
                self.writeStatus(status)
                self.resolve(call, self.readStatus(jobId: jobId))
            } catch {
                self.reject(call, error, fallback: "Native album upload failed")
            }
        }
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        DispatchQueue.main.async {
            picker.dismiss(animated: true)
        }
        guard let call = activeCaptureCall else {
            return
        }
        activeCaptureCall = nil
        resolve(call, idleStatus())
    }

    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        DispatchQueue.main.async {
            picker.dismiss(animated: true)
        }

        guard let call = activeCaptureCall else {
            return
        }
        activeCaptureCall = nil

        let eventId = call.getInt("eventId") ?? 0
        let baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""))

        queue.async { [weak self] in
            guard let self else { return }
            var cleanupUrl: URL?
            do {
                let jobId = UUID().uuidString
                let uploadUrl = try self.uploadEndpoint(baseUrl: baseUrl)
                let authorization = nativeAlbumAuthorizationHeader()
                let cookie = authorization == nil ? self.cookieHeaderBlocking(for: uploadUrl.absoluteString) : nil
                var status = self.newStatus(jobId: jobId, eventId: eventId, total: 1)
                self.writeStatus(status)

                let item: UploadBody
                if let mediaUrl = info[.mediaURL] as? URL {
                    cleanupUrl = mediaUrl
                    let extensionName = mediaUrl.pathExtension.isEmpty ? "mov" : mediaUrl.pathExtension
                    item = try self.prepareMultipartBody(
                        sourceUrl: mediaUrl,
                        fileName: self.capturedFileName(prefix: "video", extensionName: extensionName),
                        mimeType: self.mimeType(for: mediaUrl),
                        jobId: jobId,
                        eventId: eventId
                    )
                } else if let image = info[.originalImage] as? UIImage {
                    let imageUrl = try self.writeCapturedImage(image)
                    cleanupUrl = imageUrl
                    item = try self.prepareMultipartBody(
                        sourceUrl: imageUrl,
                        fileName: self.capturedFileName(prefix: "photo", extensionName: "jpg"),
                        mimeType: "image/jpeg",
                        jobId: jobId,
                        eventId: eventId
                    )
                } else {
                    throw nativeAlbumUploadError("Unable to read captured media")
                }

                var request = URLRequest(url: uploadUrl)
                request.httpMethod = "POST"
                request.timeoutInterval = 120
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("multipart/form-data; boundary=\(item.boundary)", forHTTPHeaderField: "Content-Type")
                if let authorization, !authorization.isEmpty {
                    request.setValue(authorization, forHTTPHeaderField: "Authorization")
                } else if let cookie, !cookie.isEmpty {
                    request.setValue(cookie, forHTTPHeaderField: "Cookie")
                }

                let task = self.uploadSession().uploadTask(with: request, fromFile: item.bodyUrl)
                task.taskDescription = self.taskDescription(jobId: jobId, name: item.name, bodyPath: item.bodyUrl.path)
                task.resume()

                status["status"] = "running"
                self.writeStatus(status)
                if let cleanupUrl {
                    try? FileManager.default.removeItem(at: cleanupUrl)
                }
                self.resolve(call, self.readStatus(jobId: jobId))
            } catch {
                if let cleanupUrl {
                    try? FileManager.default.removeItem(at: cleanupUrl)
                }
                self.reject(call, error, fallback: "Native album capture failed")
            }
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        let jobId = call.getString("jobId")?.trimmingCharacters(in: .whitespacesAndNewlines)
        resolve(call, readStatus(jobId: jobId))
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let requestedJobId = call.getString("jobId")?.trimmingCharacters(in: .whitespacesAndNewlines)
        var status = readStatus(jobId: requestedJobId)
        let resolvedJobId = (status["jobId"] as? String) ?? requestedJobId ?? ""
        guard !resolvedJobId.isEmpty else {
            resolve(call, status)
            return
        }

        status["status"] = "canceled"
        status["error"] = "Canceled"
        writeStatus(status)

        uploadSession().getAllTasks { [weak self] tasks in
            guard let self else { return }
            for task in tasks {
                if self.taskMetadata(task)["jobId"] as? String == resolvedJobId {
                    task.cancel()
                }
            }
            self.resolve(call, self.readStatus(jobId: resolvedJobId))
        }
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        let metadata = taskMetadata(task)
        guard let jobId = metadata["jobId"] as? String else {
            return
        }

        queue.async { [weak self] in
            guard let self else { return }
            var status = self.readStatus(jobId: jobId)
            if self.isTerminalStatus(status["status"] as? String) {
                return
            }
            let progress: Int
            if totalBytesExpectedToSend > 0 {
                progress = max(0, min(99, Int((Double(totalBytesSent) / Double(totalBytesExpectedToSend)) * 100.0)))
            } else {
                progress = 0
            }
            status["status"] = "running"
            status["currentFile"] = metadata["name"] as? String ?? ""
            status["currentProgress"] = progress
            self.writeStatus(status)
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let metadata = taskMetadata(task)
        guard let jobId = metadata["jobId"] as? String else {
            completeBackgroundEventsWhenIdle()
            return
        }

        queue.async { [weak self] in
            guard let self else { return }
            var status = self.readStatus(jobId: jobId)
            if (status["status"] as? String) == "canceled" {
                self.cleanupTaskBody(metadata)
                self.completeBackgroundEventsWhenIdle()
                return
            }

            let total = max(0, self.intValue(status["total"]))
            var completed = max(0, self.intValue(status["completed"]))
            var failed = max(0, self.intValue(status["failed"]))
            let httpStatus = (task.response as? HTTPURLResponse)?.statusCode ?? (error == nil ? 200 : 0)
            if let error {
                failed += 1
                status["error"] = error.localizedDescription
            } else if httpStatus < 200 || httpStatus >= 300 {
                failed += 1
                status["error"] = "HTTP \(httpStatus)"
            } else {
                completed += 1
            }

            status["completed"] = completed
            status["failed"] = failed
            status["currentProgress"] = 100
            if total > 0, completed + failed >= total {
                status["currentFile"] = ""
                status["status"] = failed == 0 ? "success" : (completed > 0 ? "partial" : "error")
            }
            self.writeStatus(status)
            self.cleanupTaskBody(metadata)
            self.completeBackgroundEventsWhenIdle()
        }
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        completeBackgroundEventsWhenIdle()
    }

    private func uploadSession() -> URLSession {
        if let backgroundSession {
            return backgroundSession
        }
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.waitsForConnectivity = true
        config.httpMaximumConnectionsPerHost = 1
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        backgroundSession = session
        return session
    }

    private func prepareMultipartBody(provider: NSItemProvider, jobId: String, eventId: Int) throws -> UploadBody {
        guard let typeIdentifier = preferredTypeIdentifier(provider) else {
            throw nativeAlbumUploadError("Unsupported selected file")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var uploadBody: UploadBody?
        var uploadError: Error?
        provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { [weak self] url, error in
            guard let self else {
                uploadError = nativeAlbumUploadError("Native album upload is unavailable")
                semaphore.signal()
                return
            }
            defer {
                semaphore.signal()
            }
            if let error {
                uploadError = error
                return
            }
            guard let url else {
                uploadError = nativeAlbumUploadError("Unable to read selected file")
                return
            }
            do {
                let name = self.fileName(provider: provider, typeIdentifier: typeIdentifier, sourceUrl: url)
                let mimeType = self.mimeType(typeIdentifier: typeIdentifier, sourceUrl: url)
                uploadBody = try self.prepareMultipartBody(
                    sourceUrl: url,
                    fileName: name,
                    mimeType: mimeType,
                    jobId: jobId,
                    eventId: eventId
                )
            } catch {
                uploadError = error
            }
        }
        semaphore.wait()

        if let uploadError {
            throw uploadError
        }
        guard let uploadBody else {
            throw nativeAlbumUploadError("Unable to prepare selected file")
        }
        return uploadBody
    }

    private func prepareMultipartBody(
        sourceUrl: URL,
        fileName requestedFileName: String? = nil,
        mimeType requestedMimeType: String? = nil,
        jobId: String,
        eventId: Int
    ) throws -> UploadBody {
        let name = requestedFileName ?? fileName(for: sourceUrl)
        let mimeType = requestedMimeType ?? mimeType(for: sourceUrl)
        let boundary = "----XinyaAlbumUpload\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        let jobRoot = try ensureUploadRoot().appendingPathComponent(jobId, isDirectory: true)
        try FileManager.default.createDirectory(at: jobRoot, withIntermediateDirectories: true)
        let bodyUrl = jobRoot.appendingPathComponent("\(UUID().uuidString).multipart")
        FileManager.default.createFile(atPath: bodyUrl.path, contents: nil)

        guard let output = try? FileHandle(forWritingTo: bodyUrl) else {
            throw nativeAlbumUploadError("Unable to create upload body")
        }
        defer {
            try? output.close()
        }

        try write(output, "--\(boundary)\r\n")
        try write(output, "Content-Disposition: form-data; name=\"event_id\"\r\n\r\n")
        try write(output, "\(eventId)\r\n")
        try write(output, "--\(boundary)\r\n")
        try write(output, "Content-Disposition: form-data; name=\"file\"; filename=\"\(sanitizeFileName(name))\"\r\n")
        try write(output, "Content-Type: \(mimeType)\r\n\r\n")
        try copyFile(sourceUrl, to: output)
        try write(output, "\r\n--\(boundary)--\r\n")

        return UploadBody(name: name, boundary: boundary, bodyUrl: bodyUrl)
    }

    private func preferredTypeIdentifier(_ provider: NSItemProvider) -> String? {
        for identifier in provider.registeredTypeIdentifiers {
            if UTType(identifier)?.conforms(to: .movie) == true {
                return identifier
            }
        }
        for identifier in provider.registeredTypeIdentifiers {
            if UTType(identifier)?.conforms(to: .image) == true {
                return identifier
            }
        }
        return nil
    }

    private func fileName(provider: NSItemProvider, typeIdentifier: String, sourceUrl: URL) -> String {
        let extensionName = UTType(typeIdentifier)?.preferredFilenameExtension ?? sourceUrl.pathExtension
        let suggested = provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawStem: String
        if let suggested, !suggested.isEmpty {
            rawStem = suggested
        } else {
            rawStem = sourceUrl.deletingPathExtension().lastPathComponent
        }
        let stem = rawStem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "media" : rawStem
        if extensionName.isEmpty || stem.lowercased().hasSuffix(".\(extensionName.lowercased())") {
            return stem
        }
        return "\(stem).\(extensionName)"
    }

    private func mimeType(typeIdentifier: String, sourceUrl: URL) -> String {
        if let type = UTType(typeIdentifier), let mime = type.preferredMIMEType, !mime.isEmpty {
            return mime
        }
        return mimeType(for: sourceUrl)
    }

    private func copyFile(_ sourceUrl: URL, to output: FileHandle) throws {
        let scoped = sourceUrl.startAccessingSecurityScopedResource()
        defer {
            if scoped {
                sourceUrl.stopAccessingSecurityScopedResource()
            }
        }

        guard let input = InputStream(url: sourceUrl) else {
            throw nativeAlbumUploadError("Unable to open selected file")
        }
        input.open()
        defer {
            input.close()
        }

        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while input.hasBytesAvailable {
            let read = input.read(&buffer, maxLength: buffer.count)
            if read < 0 {
                throw input.streamError ?? nativeAlbumUploadError("Unable to read selected file")
            }
            if read == 0 {
                break
            }
            output.write(Data(buffer[0..<read]))
        }
    }

    private func write(_ output: FileHandle, _ text: String) throws {
        guard let data = text.data(using: .utf8) else {
            throw nativeAlbumUploadError("Unable to encode upload body")
        }
        output.write(data)
    }

    private func fileName(for url: URL) -> String {
        let name = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "media" : name
    }

    private func capturedFileName(prefix: String, extensionName: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let timestamp = formatter.string(from: Date())
        let trimmedExtension = extensionName.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedExtension = trimmedExtension.isEmpty ? "dat" : trimmedExtension
        return "\(prefix)_\(timestamp)_\(UUID().uuidString).\(normalizedExtension)"
    }

    private func writeCapturedImage(_ image: UIImage) throws -> URL {
        let root = try ensureUploadRoot().appendingPathComponent("captured", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent(capturedFileName(prefix: "photo", extensionName: "jpg"))
        guard let data = image.jpegData(compressionQuality: 0.92) else {
            throw nativeAlbumUploadError("Unable to encode captured image")
        }
        try data.write(to: url, options: .atomic)
        return url
    }

    private func mimeType(for url: URL) -> String {
        if let resourceValues = try? url.resourceValues(forKeys: [.typeIdentifierKey]),
           let identifier = resourceValues.typeIdentifier,
           let type = UTType(identifier),
           let mime = type.preferredMIMEType,
           !mime.isEmpty {
            return mime
        }
        if let type = UTType(filenameExtension: url.pathExtension),
           let mime = type.preferredMIMEType,
           !mime.isEmpty {
            return mime
        }
        return "application/octet-stream"
    }

    private func sanitizeFileName(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = trimmed.isEmpty ? "media" : trimmed
        return fallback
            .replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: "_")
            .replacingOccurrences(of: "\n", with: "_")
    }

    private func uploadEndpoint(baseUrl: String) throws -> URL {
        guard let url = URL(string: "\(normalizeBaseUrl(baseUrl))/media/upload_media") else {
            throw nativeAlbumUploadError("Invalid upload URL")
        }
        return url
    }

    private func normalizeBaseUrl(_ value: String?) -> String {
        var normalized = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty {
            normalized = defaultBaseUrl
        }
        while normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized
    }

    private func newStatus(jobId: String, eventId: Int, total: Int) -> PluginCallResultData {
        [
            "jobId": jobId,
            "eventId": eventId,
            "status": "queued",
            "total": total,
            "completed": 0,
            "failed": 0,
            "currentFile": "",
            "currentProgress": 0,
            "startedAt": nowMilliseconds(),
            "updatedAt": nowMilliseconds()
        ]
    }

    private func idleStatus() -> PluginCallResultData {
        [
            "status": "idle",
            "total": 0,
            "completed": 0,
            "failed": 0,
            "currentProgress": 0
        ]
    }

    private func readStatus(jobId requestedJobId: String?) -> PluginCallResultData {
        let defaults = UserDefaults.standard
        var jobId = (requestedJobId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if jobId.isEmpty {
            jobId = defaults.string(forKey: latestJobKey) ?? ""
        }
        if jobId.isEmpty {
            return idleStatus()
        }
        guard let data = defaults.data(forKey: "\(jobKeyPrefix)\(jobId)"),
              let status = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return idleStatus()
        }
        return status
    }

    private func writeStatus(_ status: PluginCallResultData) {
        guard let jobId = status["jobId"] as? String, !jobId.isEmpty else {
            return
        }
        var next = status
        next["updatedAt"] = nowMilliseconds()
        guard let data = try? JSONSerialization.data(withJSONObject: next) else {
            return
        }
        let defaults = UserDefaults.standard
        defaults.set(jobId, forKey: latestJobKey)
        defaults.set(data, forKey: "\(jobKeyPrefix)\(jobId)")
    }

    private func taskDescription(jobId: String, name: String, bodyPath: String) -> String {
        let payload: [String: Any] = [
            "jobId": jobId,
            "name": name,
            "bodyPath": bodyPath
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else {
            return jobId
        }
        return text
    }

    private func taskMetadata(_ task: URLSessionTask) -> [String: Any] {
        guard let text = task.taskDescription,
              let data = text.data(using: .utf8),
              let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return [:]
        }
        return payload
    }

    private func cleanupTaskBody(_ metadata: [String: Any]) {
        if let bodyPath = metadata["bodyPath"] as? String, !bodyPath.isEmpty {
            try? FileManager.default.removeItem(atPath: bodyPath)
            let parent = URL(fileURLWithPath: bodyPath).deletingLastPathComponent()
            if let files = try? FileManager.default.contentsOfDirectory(at: parent, includingPropertiesForKeys: nil), files.isEmpty {
                try? FileManager.default.removeItem(at: parent)
            }
        }
    }

    private func completeBackgroundEventsWhenIdle() {
        uploadSession().getAllTasks { tasks in
            guard tasks.isEmpty else {
                return
            }
            DispatchQueue.main.async {
                if let completion = Self.backgroundCompletionHandlers.removeValue(forKey: Self.sessionIdentifier) {
                    completion()
                }
            }
        }
    }

    private func ensureUploadRoot() throws -> URL {
        let root = try FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent(uploadDirName, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func isTerminalStatus(_ status: String?) -> Bool {
        status == "success" || status == "partial" || status == "error" || status == "canceled"
    }

    private func intValue(_ value: Any?) -> Int {
        if let intValue = value as? Int {
            return intValue
        }
        if let numberValue = value as? NSNumber {
            return numberValue.intValue
        }
        if let stringValue = value as? String, let intValue = Int(stringValue) {
            return intValue
        }
        return 0
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
                header = nativeAlbumCookieHeader(cookies: cookies, for: url)
                semaphore.signal()
            }
        }
        _ = semaphore.wait(timeout: .now() + 2)
        return header
    }

    private func nowMilliseconds() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
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

private struct UploadBody {
    let name: String
    let boundary: String
    let bodyUrl: URL
}

private func nativeAlbumAuthorizationHeader() -> String? {
    guard let accessToken = readNativeAuthAccessToken(), !accessToken.isEmpty else {
        return nil
    }
    return "Bearer \(accessToken)"
}

private func nativeAlbumCookieHeader(cookies: [HTTPCookie], for url: URL?) -> String? {
    guard let host = url?.host?.lowercased(), !host.isEmpty else {
        return nil
    }
    let matching = cookies.filter { cookie in
        let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")).lowercased()
        return host == domain || host.hasSuffix(".\(domain)")
    }
    if matching.isEmpty {
        return nil
    }
    return HTTPCookie.requestHeaderFields(with: matching)["Cookie"]
}

private func nativeAlbumUploadError(_ message: String) -> NSError {
    NSError(domain: "NativeAlbumUpload", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
