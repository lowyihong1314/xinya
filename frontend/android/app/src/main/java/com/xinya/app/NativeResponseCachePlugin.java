package com.xinya.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeResponseCache")
public class NativeResponseCachePlugin extends Plugin {

    private static final String CACHE_DIR_NAME = "native-response-cache";
    private static final long MAX_CACHE_BYTES = 20L * 1024L * 1024L;

    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private File cacheRoot;

    @Override
    public void load() {
        cacheRoot = new File(getContext().getFilesDir(), CACHE_DIR_NAME);
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
    public void setEntry(PluginCall call) {
        String cacheKey = call.getString("cacheKey");
        String url = call.getString("url", "");
        Integer statusValue = call.getInt("status");
        int status = statusValue != null ? statusValue : 200;
        String statusText = call.getString("statusText", "OK");
        JSObject headers = call.getObject("headers");
        String body = call.getString("body", "");

        if (cacheKey == null || cacheKey.trim().isEmpty()) {
            call.reject("cacheKey is required");
            return;
        }

        final JSObject finalHeaders = headers != null ? headers : new JSObject();
        executor.execute(() -> {
            try {
                writeEntry(cacheKey, url, status, statusText, finalHeaders, body);
                dispatchToMainThread(call::resolve);
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "setEntry failed";
                dispatchToMainThread(() -> call.reject(message));
            }
        });
    }

    @PluginMethod
    public void getEntry(PluginCall call) {
        String cacheKey = call.getString("cacheKey");
        if (cacheKey == null || cacheKey.trim().isEmpty()) {
            call.reject("cacheKey is required");
            return;
        }

        executor.execute(() -> {
            try {
                CachedEntry entry = readEntry(cacheKey);
                JSObject result = new JSObject();
                if (entry == null) {
                    result.put("exists", false);
                    dispatchToMainThread(() -> call.resolve(result));
                    return;
                }

                result.put("exists", true);
                result.put("url", entry.url);
                result.put("status", entry.status);
                result.put("statusText", entry.statusText);
                result.put("headers", entry.headers);
                result.put("body", entry.body);
                result.put("updatedAt", entry.updatedAt);
                dispatchToMainThread(() -> call.resolve(result));
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "getEntry failed";
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
                CacheStats stats = buildStats(MAX_CACHE_BYTES, 0, 0L);
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
        long maxBytes = maxBytesValue != null ? Math.max(0L, Math.round(maxBytesValue)) : MAX_CACHE_BYTES;

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

    private void writeEntry(
        String cacheKey,
        String url,
        int status,
        String statusText,
        JSObject headers,
        String body
    ) throws Exception {
        ensureCacheRoot();

        File bodyFile = bodyFile(cacheKey);
        File metaFile = metaFile(cacheKey);

        try (OutputStream output = new FileOutputStream(bodyFile, false)) {
            output.write((body != null ? body : "").getBytes(StandardCharsets.UTF_8));
            output.flush();
        }

        JSONObject meta = new JSONObject();
        meta.put("cacheKey", cacheKey);
        meta.put("url", url != null ? url : "");
        meta.put("status", status);
        meta.put("statusText", statusText != null ? statusText : "OK");
        meta.put("fileName", bodyFile.getName());
        meta.put("headers", headers != null ? new JSONObject(headers.toString()) : new JSONObject());
        meta.put("updatedAt", System.currentTimeMillis());
        writeMeta(metaFile, meta);
        trimToLimit(MAX_CACHE_BYTES);
    }

    private CachedEntry readEntry(String cacheKey) {
        File metaFile = metaFile(cacheKey);
        JSONObject meta = readMeta(metaFile);
        if (meta == null) {
            return null;
        }

        File bodyFile = resolveBodyFile(meta);
        if (bodyFile == null || !bodyFile.exists()) {
            deleteQuietly(metaFile(cacheKey));
            return null;
        }

        long updatedAt = System.currentTimeMillis();
        try {
            meta.put("updatedAt", updatedAt);
            writeMeta(metaFile, meta);
        } catch (Exception ignored) {
            updatedAt = meta.optLong("updatedAt", 0L);
        }

        return new CachedEntry(
            meta.optString("url", ""),
            meta.optInt("status", 200),
            meta.optString("statusText", "OK"),
            readHeaders(meta.optJSONObject("headers")),
            readTextFile(bodyFile),
            updatedAt
        );
    }

    private void deleteEntry(String cacheKey) {
        JSONObject meta = readMeta(metaFile(cacheKey));
        if (meta != null) {
            File bodyFile = resolveBodyFile(meta);
            if (bodyFile != null) {
                deleteQuietly(bodyFile);
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
                File bodyFile = resolveBodyFile(meta);
                if (bodyFile != null) {
                    deleteQuietly(bodyFile);
                }
                deleteQuietly(metaFile);
            }
        }
    }

    private File metaFile(String cacheKey) {
        return new File(cacheRoot, sha256(cacheKey) + ".json");
    }

    private File bodyFile(String cacheKey) {
        return new File(cacheRoot, sha256(cacheKey) + ".body");
    }

    private File resolveBodyFile(JSONObject meta) {
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
            deleteQuietly(entry.bodyFile);
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

            File bodyFile = resolveBodyFile(meta);
            if (bodyFile == null || !bodyFile.exists()) {
                deleteQuietly(metaFile);
                continue;
            }

            long size = bodyFile.length() + metaFile.length();
            long updatedAt = meta.optLong("updatedAt", 0L);
            entries.add(new CacheIndexEntry(metaFile, bodyFile, size, updatedAt));
        }

        return entries;
    }

    private void ensureCacheRoot() {
        if (cacheRoot == null) {
            cacheRoot = new File(getContext().getFilesDir(), CACHE_DIR_NAME);
        }
        if (!cacheRoot.exists()) {
            //noinspection ResultOfMethodCallIgnored
            cacheRoot.mkdirs();
        }
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

    private String readTextFile(File file) {
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[(int) file.length()];
            int read = input.read(buffer);
            if (read <= 0) {
                return "";
            }
            return new String(buffer, 0, read, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return "";
        }
    }

    private JSObject readHeaders(JSONObject source) {
        JSObject headers = new JSObject();
        if (source == null) {
            return headers;
        }

        Iterator<String> keys = source.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            headers.put(key, source.optString(key, ""));
        }
        return headers;
    }

    private void writeMeta(File metaFile, JSONObject meta) throws Exception {
        try (OutputStream output = new FileOutputStream(metaFile, false)) {
            output.write(meta.toString().getBytes(StandardCharsets.UTF_8));
            output.flush();
        }
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
        if (getActivity() != null) {
            getActivity().runOnUiThread(action);
            return;
        }
        action.run();
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
        final File bodyFile;
        final long size;
        final long updatedAt;

        CacheIndexEntry(File metaFile, File bodyFile, long size, long updatedAt) {
            this.metaFile = metaFile;
            this.bodyFile = bodyFile;
            this.size = size;
            this.updatedAt = updatedAt;
        }
    }

    private static final class CachedEntry {
        final String url;
        final int status;
        final String statusText;
        final JSObject headers;
        final String body;
        final long updatedAt;

        CachedEntry(String url, int status, String statusText, JSObject headers, String body, long updatedAt) {
            this.url = url;
            this.status = status;
            this.statusText = statusText;
            this.headers = headers;
            this.body = body;
            this.updatedAt = updatedAt;
        }
    }
}
