import Capacitor
import Foundation
import Security

@objc(NativeAuthPlugin)
public class NativeAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAuthPlugin"
    public let jsName = "NativeAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refreshSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "com.xinya.native-auth", qos: .utility)
    private let service = "com.xinya.native-auth"
    private let account = "mobile-session"

    @objc func getSession(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let session = try self.readSession()
                self.resolve(call, self.publicSession(session))
            } catch {
                self.reject(call, error, fallback: "getSession failed")
            }
        }
    }

    @objc func setSession(_ call: CAPPluginCall) {
        guard let accessToken = call.getString("accessToken")?.trimmingCharacters(in: .whitespacesAndNewlines), !accessToken.isEmpty else {
            call.reject("accessToken is required")
            return
        }
        guard let refreshToken = call.getString("refreshToken")?.trimmingCharacters(in: .whitespacesAndNewlines), !refreshToken.isEmpty else {
            call.reject("refreshToken is required")
            return
        }
        guard let expiresAt = call.getString("expiresAt")?.trimmingCharacters(in: .whitespacesAndNewlines), !expiresAt.isEmpty else {
            call.reject("expiresAt is required")
            return
        }
        let user = call.getObject("user")

        queue.async { [weak self] in
            guard let self else { return }
            do {
                var session: [String: Any] = [
                    "accessToken": accessToken,
                    "refreshToken": refreshToken,
                    "expiresAt": expiresAt
                ]
                if let user {
                    session["user"] = user
                }
                try self.writeSession(session)
                self.resolve(call)
            } catch {
                self.reject(call, error, fallback: "setSession failed")
            }
        }
    }

    @objc func refreshSession(_ call: CAPPluginCall) {
        let baseUrl = normalizeAuthBaseUrl(call.getString("baseUrl", ""))
        if baseUrl.isEmpty {
            call.reject("baseUrl is required")
            return
        }

        queue.async { [weak self] in
            guard let self else { return }
            do {
                var session = try self.readSession()
                guard let refreshToken = session["refreshToken"] as? String, !refreshToken.isEmpty else {
                    throw nativeAuthError("refreshToken is not available")
                }

                let response = try postAuthJson(
                    url: "\(baseUrl)/api/mobile/session/refresh",
                    body: ["refresh_token": refreshToken]
                )
                let accessToken = firstAuthString(response, "access_token", "accessToken")
                let nextRefreshToken = firstAuthString(response, "refresh_token", "refreshToken")
                let expiresAt = firstAuthString(response, "expires_at", "expiresAt")
                if accessToken.isEmpty || expiresAt.isEmpty {
                    throw nativeAuthError("refresh response missing access token or expiry")
                }

                session["accessToken"] = accessToken
                if !nextRefreshToken.isEmpty {
                    session["refreshToken"] = nextRefreshToken
                }
                session["expiresAt"] = expiresAt
                if let user = response["user"] as? [String: Any] {
                    session["user"] = user
                }
                try self.writeSession(session)
                self.resolve(call, self.publicSession(session))
            } catch {
                self.reject(call, error, fallback: "refreshSession failed")
            }
        }
    }

    @objc func clearSession(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                try self.deleteSession()
                self.resolve(call)
            } catch {
                self.reject(call, error, fallback: "clearSession failed")
            }
        }
    }

    private func publicSession(_ session: [String: Any]) -> PluginCallResultData {
        var result: PluginCallResultData = [:]
        if let accessToken = session["accessToken"] as? String, !accessToken.isEmpty {
            result["accessToken"] = accessToken
        }
        if let expiresAt = session["expiresAt"] as? String, !expiresAt.isEmpty {
            result["expiresAt"] = expiresAt
        }
        if let user = session["user"] as? [String: Any] {
            result["user"] = user
        }
        return result
    }

    private func readSession() throws -> [String: Any] {
        var query = keychainQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return [:]
        }
        if status != errSecSuccess {
            throw nativeAuthError("Keychain read failed: \(status)")
        }
        guard let data = item as? Data else {
            return [:]
        }
        return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    private func writeSession(_ session: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: session)
        var query = keychainQuery()
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess {
            return
        }
        if status != errSecItemNotFound {
            throw nativeAuthError("Keychain update failed: \(status)")
        }

        for (key, value) in attributes {
            query[key] = value
        }
        let addStatus = SecItemAdd(query as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw nativeAuthError("Keychain add failed: \(addStatus)")
        }
    }

    private func deleteSession() throws {
        let status = SecItemDelete(keychainQuery() as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw nativeAuthError("Keychain delete failed: \(status)")
        }
    }

    private func keychainQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
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

func readNativeAuthAccessToken() -> String? {
    guard
        let session = try? readNativeAuthSharedSession(),
        let accessToken = session["accessToken"] as? String
    else {
        return nil
    }
    if
        let expiresAt = session["expiresAt"] as? String,
        nativeAuthSessionIsExpiredOrNearlyExpired(expiresAt)
    {
        return nil
    }
    let trimmed = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func readNativeAuthSharedSession() throws -> [String: Any] {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.xinya.native-auth",
        kSecAttrAccount as String: "mobile-session",
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
        return [:]
    }
    if status != errSecSuccess {
        throw nativeAuthError("Keychain read failed: \(status)")
    }
    guard let data = item as? Data else {
        return [:]
    }
    return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
}

private func nativeAuthSessionIsExpiredOrNearlyExpired(_ expiresAt: String) -> Bool {
    guard let date = nativeAuthExpiryDate(expiresAt) else {
        return false
    }
    return date.timeIntervalSinceNow <= 60
}

private func nativeAuthExpiryDate(_ value: String) -> Date? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return nil
    }
    if let numeric = Double(trimmed) {
        let seconds = numeric < 100_000_000_000 ? numeric : numeric / 1000
        return Date(timeIntervalSince1970: seconds)
    }

    let isoWithFraction = ISO8601DateFormatter()
    isoWithFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = isoWithFraction.date(from: trimmed) {
        return date
    }

    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime]
    if let date = iso.date(from: trimmed) {
        return date
    }

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    for format in ["yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm:ss"] {
        formatter.dateFormat = format
        if let date = formatter.date(from: trimmed) {
            return date
        }
    }
    return nil
}

private func postAuthJson(url: String, body: [String: Any]) throws -> [String: Any] {
    guard let requestUrl = URL(string: url) else {
        throw nativeAuthError("Invalid URL: \(url)")
    }
    var request = URLRequest(url: requestUrl)
    request.httpMethod = "POST"
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

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
        throw nativeAuthError("HTTP \(status): \(text)")
    }
    if data.isEmpty {
        return [:]
    }
    return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
}

private func firstAuthString(_ source: [String: Any], _ snakeCaseKey: String, _ camelCaseKey: String) -> String {
    if let value = source[snakeCaseKey] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if let value = source[camelCaseKey] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return ""
}

private func normalizeAuthBaseUrl(_ value: String?) -> String {
    var normalized = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    while normalized.hasSuffix("/") {
        normalized.removeLast()
    }
    return normalized
}

private func nativeAuthError(_ message: String) -> NSError {
    NSError(domain: "NativeAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
