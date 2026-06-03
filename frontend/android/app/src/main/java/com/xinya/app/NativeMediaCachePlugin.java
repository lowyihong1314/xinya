package com.xinya.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;

@CapacitorPlugin(name = "NativeMediaCache")
public class NativeMediaCachePlugin extends Plugin {

    private static final String CACHE_DIR_NAME = "native-media-cache";
    private static final String PREFS_NAME = "xinya_native_media_cache";
    private static final String PREF_MAX_BYTES = "max_bytes";
    private static final long GIGABYTE_BYTES = 1024L * 1024L * 1024L;
    private static final long MIN_CACHE_BYTES = 1L * GIGABYTE_BYTES;
    private static final long DEFAULT_CACHE_BYTES = 10L * GIGABYTE_BYTES;
    private static final long MAX_CACHE_BYTES = 50L * GIGABYTE_BYTES;

    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private File cacheRoot;
    private SharedPreferences prefs;

    @Override
    public void load() {
        prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        cacheRoot = new File(getContext().getCacheDir(), CACHE_DIR_NAME);
        migrateLegacyCacheRoot();
        if (!cacheRoot.exists()) {
            //noinspection ResultOfMethodCallIgnored
            cacheRoot.mkdirs();
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }

    @PluginMethod
    public void cacheMedia(PluginCall call) {
        String sourceUrl = call.getString("url");
        String cacheKey = call.getString("cacheKey", sourceUrl);
        boolean force = call.getBoolean("force", false);
        boolean staleWhileRevalidate = call.getBoolean("staleWhileRevalidate", false);

        if (sourceUrl == null || sourceUrl.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }

        if (cacheKey == null || cacheKey.trim().isEmpty()) {
            call.reject("cacheKey is required");
            return;
        }

        executor.execute(() -> {
            try {
                CacheEntry entry = cacheMediaInternal(sourceUrl, cacheKey, force, staleWhileRevalidate);
                JSObject result = new JSObject();
                result.put("fileUri", Uri.fromFile(entry.file).toString());
                result.put("mimeType", entry.mimeType);
                result.put("size", entry.size);
                dispatchToMainThread(() -> call.resolve(result));
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "cacheMedia failed";
                dispatchToMainThread(() -> call.reject(message));
            }
        });
    }

    @PluginMethod
    public void invalidate(PluginCall call) {
        String cacheKey = call.getString("cacheKey");
        String prefix = call.getString("prefix");

        if ((cacheKey == null || cacheKey.trim().isEmpty()) && (prefix == null || prefix.trim().isEmpty())) {
            call.reject("cacheKey or prefix is required");
            return;
        }

        executor.execute(() -> {
            try {
                if (cacheKey != null && !cacheKey.trim().isEmpty()) {
                    deleteEntry(cacheKey);
                }
                if (prefix != null && !prefix.trim().isEmpty()) {
                    deleteEntriesByPrefix(prefix);
                }
                dispatchToMainThread(call::resolve);
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "invalidate failed";
                dispatchToMainThread(() -> call.reject(message));
            }
        });
    }

    @PluginMethod
    public void getStats(PluginCall call) {
        executor.execute(() -> {
            try {
                CacheStats stats = buildStats(getConfiguredMaxBytes(), 0, 0L);
                dispatchToMainThread(() -> call.resolve(stats.toJSObject()));
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "getStats failed";
                dispatchToMainThread(() -> call.reject(message));
            }
        });
    }

    @PluginMethod
    public void trim(PluginCall call) {
        Double maxBytesValue = call.getDouble("maxBytes");
        long maxBytes = maxBytesValue != null ? clampCacheBytes(Math.round(maxBytesValue)) : getConfiguredMaxBytes();

        executor.execute(() -> {
            try {
                CacheStats stats = trimToLimit(maxBytes);
                dispatchToMainThread(() -> call.resolve(stats.toJSObject()));
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "trim failed";
                dispatchToMainThread(() -> call.reject(message));
            }
        });
    }

    @PluginMethod
    public void setMaxBytes(PluginCall call) {
        Double maxBytesValue = call.getDouble("maxBytes");
        if (maxBytesValue == null) {
            call.reject("maxBytes is required");
            return;
        }

        long maxBytes = clampCacheBytes(Math.round(maxBytesValue));
        executor.execute(() -> {
            try {
                getPrefs().edit().putLong(PREF_MAX_BYTES, maxBytes).apply();
                CacheStats stats = trimToLimit(maxBytes);
                dispatchToMainThread(() -> call.resolve(stats.toJSObject()));
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "setMaxBytes failed";
                dispatchToMainThread(() -> call.reject(message));
            }
        });
    }

    @PluginMethod
    public void clearAll(PluginCall call) {
        executor.execute(() -> {
            try {
                deleteRecursively(cacheRoot);
                if (!cacheRoot.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    cacheRoot.mkdirs();
                }
                dispatchToMainThread(call::resolve);
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "clearAll failed";
                dispatchToMainThread(() -> call.reject(message));
            }
        });
    }

    private CacheEntry cacheMediaInternal(
        String sourceUrl,
        String cacheKey,
        boolean force,
        boolean staleWhileRevalidate
    ) throws Exception {
        ensureCacheRoot();

        String hash = sha256(cacheKey);
        File metaFile = new File(cacheRoot, hash + ".json");
        JSONObject existingMeta = readMeta(metaFile);
        File existingFile = existingMeta == null ? null : resolveDataFile(existingMeta);

        if (!force && canReuseExistingEntry(existingMeta, existingFile, sourceUrl)) {
            existingMeta.put("size", existingFile.length());
            existingMeta.put("updatedAt", System.currentTimeMillis());
            writeMeta(metaFile, existingMeta);
            if (staleWhileRevalidate) {
                refreshEntryInBackground(sourceUrl, cacheKey);
            }
            return new CacheEntry(
                existingFile,
                existingMeta.optString("mimeType", ""),
                existingMeta.optLong("size", existingFile.length())
            );
        }

        DownloadResult download = downloadToTempFile(sourceUrl, hash);
        String extension = guessExtension(download.finalUrl, download.mimeType);
        File finalFile = new File(cacheRoot, hash + extension);
        File previousFile = existingFile;
        File backupFile = null;

        if (previousFile != null && previousFile.equals(finalFile) && finalFile.exists()) {
            backupFile = new File(cacheRoot, hash + ".backup");
            deleteQuietly(backupFile);
            if (!finalFile.renameTo(backupFile)) {
                throw new IllegalStateException("Unable to prepare cached media replacement");
            }
        } else if (finalFile.exists() && !finalFile.delete()) {
            throw new IllegalStateException("Unable to replace cached media file");
        }

        try {
            if (!download.file.renameTo(finalFile)) {
                copyFile(download.file, finalFile);
                deleteQuietly(download.file);
            }
        } catch (Exception error) {
            deleteQuietly(finalFile);
            if (backupFile != null && backupFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                backupFile.renameTo(finalFile);
            }
            throw error;
        }

        deleteQuietly(backupFile);
        if (previousFile != null && !previousFile.equals(finalFile)) {
            deleteQuietly(previousFile);
        }
        if (existingMeta != null) {
            deleteQuietly(metaFile);
        }

        JSONObject nextMeta = new JSONObject();
        nextMeta.put("cacheKey", cacheKey);
        nextMeta.put("sourceUrl", sourceUrl);
        nextMeta.put("finalUrl", download.finalUrl);
        nextMeta.put("fileName", finalFile.getName());
        nextMeta.put("mimeType", download.mimeType);
        nextMeta.put("size", finalFile.length());
        nextMeta.put("updatedAt", System.currentTimeMillis());
        writeMeta(metaFile, nextMeta);
        trimToLimit(getConfiguredMaxBytes());

        return new CacheEntry(finalFile, download.mimeType, finalFile.length());
    }

    private void refreshEntryInBackground(String sourceUrl, String cacheKey) {
        executor.execute(() -> {
            try {
                cacheMediaInternal(sourceUrl, cacheKey, true, false);
            } catch (Exception error) {
                // Keep the stale file. This path is intentionally best-effort so
                // album covers remain available when the APK opens offline.
            }
        });
    }

    private boolean canReuseExistingEntry(JSONObject meta, File existingFile, String sourceUrl) {
        if (meta == null || existingFile == null || !existingFile.exists()) {
            return false;
        }

        // The APK keeps this cache across app launches, so a stable cacheKey alone
        // is not enough. If the real URL behind that key changes, we must refresh.
        String cachedSourceUrl = meta.optString("sourceUrl", "").trim();
        if (cachedSourceUrl.isEmpty()) {
            return false;
        }

        return cachedSourceUrl.equals(sourceUrl);
    }

    private DownloadResult downloadToTempFile(String sourceUrl, String hash) throws Exception {
        File tempFile = File.createTempFile(hash, ".download", cacheRoot);
        HttpURLConnection connection = null;
        final String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(getContext());
        final String cookie = authorizationHeader == null ? readCookieOnMainThread(sourceUrl) : null;
        final String userAgent = readUserAgentOnMainThread();

        try {
            URL url = new URL(sourceUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setInstanceFollowRedirects(true);

            if (authorizationHeader != null && !authorizationHeader.isEmpty()) {
                connection.setRequestProperty("Authorization", authorizationHeader);
            } else if (cookie != null && !cookie.isEmpty()) {
                connection.setRequestProperty("Cookie", cookie);
            }

            if (userAgent != null && !userAgent.isEmpty()) {
                connection.setRequestProperty("User-Agent", userAgent);
            }

            int statusCode = connection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                throw new IllegalStateException("Download failed with HTTP " + statusCode);
            }

            try (
                InputStream input = new BufferedInputStream(connection.getInputStream());
                OutputStream output = new BufferedOutputStream(new FileOutputStream(tempFile))
            ) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                }
                output.flush();
            }

            return new DownloadResult(
                connection.getURL().toString(),
                normalizeMimeType(connection.getContentType()),
                tempFile
            );
        } catch (Exception error) {
            deleteQuietly(tempFile);
            throw error;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void deleteEntry(String cacheKey) {
        JSONObject meta = readMeta(metaFile(cacheKey));
        if (meta != null) {
            File dataFile = resolveDataFile(meta);
            if (dataFile != null) {
                deleteQuietly(dataFile);
            }
        }
        deleteQuietly(metaFile(cacheKey));
    }

    private void deleteEntriesByPrefix(String prefix) {
        ensureCacheRoot();
        File[] files = cacheRoot.listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null) {
            return;
        }

        for (File metaFile : files) {
            JSONObject meta = readMeta(metaFile);
            if (meta == null) {
                deleteQuietly(metaFile);
                continue;
            }

            if (meta.optString("cacheKey", "").startsWith(prefix)) {
                File dataFile = resolveDataFile(meta);
                if (dataFile != null) {
                    deleteQuietly(dataFile);
                }
                deleteQuietly(metaFile);
            }
        }
    }

    private File metaFile(String cacheKey) {
        return new File(cacheRoot, sha256(cacheKey) + ".json");
    }

    private File resolveDataFile(JSONObject meta) {
        String fileName = meta.optString("fileName", "");
        if (fileName.isEmpty()) {
            return null;
        }
        return new File(cacheRoot, fileName);
    }

    private CacheStats trimToLimit(long maxBytes) {
        List<CacheIndexEntry> entries = readCacheIndex();
        long totalBytes = 0L;
        for (CacheIndexEntry entry : entries) {
            totalBytes += entry.size;
        }

        if (totalBytes <= maxBytes) {
            return new CacheStats(entries.size(), totalBytes, maxBytes, 0, 0L);
        }

        entries.sort(Comparator.comparingLong(entry -> entry.updatedAt));
        int trimmedEntries = 0;
        long trimmedBytes = 0L;

        for (CacheIndexEntry entry : entries) {
            if (totalBytes <= maxBytes || entries.size() - trimmedEntries <= 1) {
                break;
            }

            long entrySize = entry.size;
            deleteQuietly(entry.dataFile);
            deleteQuietly(entry.metaFile);
            totalBytes -= entrySize;
            trimmedBytes += entrySize;
            trimmedEntries += 1;
        }

        return buildStats(maxBytes, trimmedEntries, trimmedBytes);
    }

    private CacheStats buildStats(long maxBytes, int trimmedEntries, long trimmedBytes) {
        List<CacheIndexEntry> entries = readCacheIndex();
        long totalBytes = 0L;
        for (CacheIndexEntry entry : entries) {
            totalBytes += entry.size;
        }
        return new CacheStats(entries.size(), totalBytes, maxBytes, trimmedEntries, trimmedBytes);
    }

    private List<CacheIndexEntry> readCacheIndex() {
        ensureCacheRoot();
        List<CacheIndexEntry> entries = new ArrayList<>();
        File[] files = cacheRoot.listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null) {
            return entries;
        }

        for (File metaFile : files) {
            JSONObject meta = readMeta(metaFile);
            if (meta == null) {
                deleteQuietly(metaFile);
                continue;
            }

            File dataFile = resolveDataFile(meta);
            if (dataFile == null || !dataFile.exists()) {
                deleteQuietly(metaFile);
                continue;
            }

            long size = dataFile.length();
            long updatedAt = meta.optLong("updatedAt", 0L);
            entries.add(new CacheIndexEntry(metaFile, dataFile, size, updatedAt));
        }

        return entries;
    }

    private void ensureCacheRoot() {
        if (cacheRoot == null) {
            cacheRoot = new File(getContext().getCacheDir(), CACHE_DIR_NAME);
        }
        if (!cacheRoot.exists()) {
            //noinspection ResultOfMethodCallIgnored
            cacheRoot.mkdirs();
        }
    }

    private void migrateLegacyCacheRoot() {
        File legacyRoot = new File(getContext().getFilesDir(), CACHE_DIR_NAME);
        if (!legacyRoot.exists() || legacyRoot.equals(cacheRoot)) {
            return;
        }
        if (!cacheRoot.exists()) {
            //noinspection ResultOfMethodCallIgnored
            legacyRoot.renameTo(cacheRoot);
            return;
        }
        deleteRecursively(legacyRoot);
    }

    private SharedPreferences getPrefs() {
        if (prefs == null) {
            prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        }
        return prefs;
    }

    private long getConfiguredMaxBytes() {
        return clampCacheBytes(getPrefs().getLong(PREF_MAX_BYTES, DEFAULT_CACHE_BYTES));
    }

    private long clampCacheBytes(long value) {
        if (value < MIN_CACHE_BYTES) {
            return MIN_CACHE_BYTES;
        }
        return Math.min(value, MAX_CACHE_BYTES);
    }

    private JSONObject readMeta(File file) {
        try {
            if (file == null || !file.exists()) {
                return null;
            }
            try (InputStream input = new FileInputStream(file)) {
                byte[] buffer = new byte[(int) file.length()];
                int read = input.read(buffer);
                if (read <= 0) {
                    return null;
                }
                return new JSONObject(new String(buffer, 0, read, StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    private void writeMeta(File metaFile, JSONObject meta) throws Exception {
        try (OutputStream output = new FileOutputStream(metaFile, false)) {
            output.write(meta.toString().getBytes(StandardCharsets.UTF_8));
            output.flush();
        }
    }

    private void copyFile(File source, File target) throws Exception {
        try (
            InputStream input = new FileInputStream(source);
            OutputStream output = new FileOutputStream(target, false)
        ) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            output.flush();
        }
    }

    private String guessExtension(String sourceUrl, String mimeType) {
        if (mimeType != null && !mimeType.isEmpty()) {
            String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            if (extension != null && !extension.isEmpty()) {
                return "." + extension.toLowerCase(Locale.US);
            }
        }

        String path = Uri.parse(sourceUrl).getLastPathSegment();
        if (path != null) {
            int dot = path.lastIndexOf('.');
            if (dot >= 0 && dot < path.length() - 1) {
                String extension = path.substring(dot + 1).replaceAll("[^A-Za-z0-9]", "");
                if (!extension.isEmpty() && extension.length() <= 8) {
                    return "." + extension.toLowerCase(Locale.US);
                }
            }
        }

        return ".bin";
    }

    private String normalizeMimeType(String contentType) {
        if (contentType == null) {
            return "";
        }
        int separator = contentType.indexOf(';');
        return separator >= 0 ? contentType.substring(0, separator).trim() : contentType.trim();
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte current : hashed) {
                builder.append(String.format(Locale.US, "%02x", current));
            }
            return builder.toString();
        } catch (Exception error) {
            throw new IllegalStateException("Unable to hash cache key", error);
        }
    }

    private void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }

        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }

        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private void dispatchToMainThread(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
            return;
        }
        mainHandler.post(action);
    }

    private String readCookieOnMainThread(String sourceUrl) {
        return callOnMainThread(() -> CookieManager.getInstance().getCookie(sourceUrl), null);
    }

    private String readUserAgentOnMainThread() {
        return callOnMainThread(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) {
                return null;
            }
            return getBridge().getWebView().getSettings().getUserAgentString();
        }, null);
    }

    private <T> T callOnMainThread(Callable<T> action, T fallback) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try {
                return action.call();
            } catch (Exception error) {
                return fallback;
            }
        }

        FutureTask<T> task = new FutureTask<>(() -> {
            try {
                return action.call();
            } catch (Exception error) {
                return fallback;
            }
        });
        mainHandler.post(task);
        try {
            return task.get();
        } catch (Exception error) {
            return fallback;
        }
    }

    private static final class CacheStats {
        final int entryCount;
        final long totalBytes;
        final long maxBytes;
        final int trimmedEntries;
        final long trimmedBytes;

        CacheStats(int entryCount, long totalBytes, long maxBytes, int trimmedEntries, long trimmedBytes) {
            this.entryCount = entryCount;
            this.totalBytes = totalBytes;
            this.maxBytes = maxBytes;
            this.trimmedEntries = trimmedEntries;
            this.trimmedBytes = trimmedBytes;
        }

        JSObject toJSObject() {
            JSObject object = new JSObject();
            object.put("entryCount", entryCount);
            object.put("totalBytes", totalBytes);
            object.put("maxBytes", maxBytes);
            object.put("trimmedEntries", trimmedEntries);
            object.put("trimmedBytes", trimmedBytes);
            return object;
        }
    }

    private static final class CacheIndexEntry {
        final File metaFile;
        final File dataFile;
        final long size;
        final long updatedAt;

        CacheIndexEntry(File metaFile, File dataFile, long size, long updatedAt) {
            this.metaFile = metaFile;
            this.dataFile = dataFile;
            this.size = size;
            this.updatedAt = updatedAt;
        }
    }

    private static final class CacheEntry {
        final File file;
        final String mimeType;
        final long size;

        CacheEntry(File file, String mimeType, long size) {
            this.file = file;
            this.mimeType = mimeType;
            this.size = size;
        }
    }

    private static final class DownloadResult {
        final String finalUrl;
        final String mimeType;
        final File file;

        DownloadResult(String finalUrl, String mimeType, File file) {
            this.finalUrl = finalUrl;
            this.mimeType = mimeType;
            this.file = file;
        }
    }
}
