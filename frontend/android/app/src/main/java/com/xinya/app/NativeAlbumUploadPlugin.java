package com.xinya.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(name = "NativeAlbumUpload")
public class NativeAlbumUploadPlugin extends Plugin {

    private static final String DEFAULT_BASE_URL = "https://utbabuddha.com";
    private static final String[] ACCEPTED_MIME_TYPES = new String[] {
        "image/*",
        "video/*"
    };

    private Uri pendingCaptureUri;
    private File pendingCaptureFile;
    private String pendingCaptureMimeType;
    private String pendingCaptureName;

    @PluginMethod
    public void pickAndUpload(PluginCall call) {
        Integer eventId = call.getInt("eventId");
        String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
        if (eventId == null || eventId <= 0) {
            call.reject("eventId is required");
            return;
        }
        if (baseUrl.isEmpty()) {
            call.reject("baseUrl is required");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_MIME_TYPES, ACCEPTED_MIME_TYPES);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "handlePickedFiles");
    }

    @PluginMethod
    public void captureAndUpload(PluginCall call) {
        Integer eventId = call.getInt("eventId");
        String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
        String mediaType = call.getString("mediaType", "image");
        if (eventId == null || eventId <= 0) {
            call.reject("eventId is required");
            return;
        }
        if (baseUrl.isEmpty()) {
            call.reject("baseUrl is required");
            return;
        }

        boolean captureVideo = "video".equalsIgnoreCase(mediaType);
        try {
            File captureFile = createCaptureFile(captureVideo);
            Uri captureUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                captureFile
            );
            Intent intent = new Intent(captureVideo ? MediaStore.ACTION_VIDEO_CAPTURE : MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
            intent.setClipData(ClipData.newRawUri("capture", captureUri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                deleteQuietly(captureFile);
                call.reject("Camera is unavailable");
                return;
            }

            pendingCaptureUri = captureUri;
            pendingCaptureFile = captureFile;
            pendingCaptureMimeType = captureVideo ? "video/mp4" : "image/jpeg";
            pendingCaptureName = captureFile.getName();
            startActivityForResult(call, intent, "handleCapturedFile");
        } catch (Exception error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "Unable to open camera");
        }
    }

    @ActivityCallback
    private void handlePickedFiles(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(statusToJSObject(NativeAlbumUploadStore.idleStatus()));
            return;
        }

        try {
            Intent data = result.getData();
            Set<Uri> uris = extractUris(data);
            if (uris.isEmpty()) {
                call.resolve(statusToJSObject(NativeAlbumUploadStore.idleStatus()));
                return;
            }

            Integer eventIdValue = call.getInt("eventId");
            int eventId = eventIdValue != null ? eventIdValue : 0;
            String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
            JSONArray items = new JSONArray();
            for (Uri uri : uris) {
                persistReadPermission(uri);
                items.put(buildItem(uri));
            }

            enqueueUpload(call, eventId, baseUrl, items);
        } catch (Exception error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "Native album upload failed");
        }
    }

    @ActivityCallback
    private void handleCapturedFile(PluginCall call, ActivityResult result) {
        if (call == null) {
            clearPendingCapture(false);
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK) {
            clearPendingCapture(true);
            call.resolve(statusToJSObject(NativeAlbumUploadStore.idleStatus()));
            return;
        }

        try {
            Uri uri = result.getData() != null && result.getData().getData() != null
                ? result.getData().getData()
                : pendingCaptureUri;
            if (uri == null) {
                clearPendingCapture(true);
                call.resolve(statusToJSObject(NativeAlbumUploadStore.idleStatus()));
                return;
            }

            Integer eventIdValue = call.getInt("eventId");
            int eventId = eventIdValue != null ? eventIdValue : 0;
            String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
            JSONArray items = new JSONArray();
            items.put(buildCapturedItem(uri));
            clearPendingCapture(false);
            enqueueUpload(call, eventId, baseUrl, items);
        } catch (Exception error) {
            clearPendingCapture(true);
            call.reject(error.getMessage() != null ? error.getMessage() : "Native album capture failed");
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        String jobId = call.getString("jobId", "");
        call.resolve(statusToJSObject(NativeAlbumUploadStore.readStatus(getContext(), jobId)));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String jobId = call.getString("jobId", "");
        JSONObject status = NativeAlbumUploadStore.readStatus(getContext(), jobId);
        String resolvedJobId = status.optString("jobId", jobId);
        if (!resolvedJobId.trim().isEmpty()) {
            updateStatus(status, "status", "canceled");
            updateStatus(status, "error", "已取消");
            NativeAlbumUploadStore.writeStatus(getContext(), status);

            Intent intent = new Intent(getContext(), NativeAlbumUploadService.class);
            intent.setAction(NativeAlbumUploadService.ACTION_CANCEL);
            intent.putExtra(NativeAlbumUploadService.EXTRA_JOB_ID, resolvedJobId);
            try {
                getContext().startService(intent);
            } catch (Exception ignored) {
            }
        }
        call.resolve(statusToJSObject(status));
    }

    private Set<Uri> extractUris(Intent data) {
        Set<Uri> uris = new LinkedHashSet<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int index = 0; index < clipData.getItemCount(); index += 1) {
                Uri uri = clipData.getItemAt(index).getUri();
                if (uri != null) {
                    uris.add(uri);
                }
            }
        }
        Uri singleUri = data.getData();
        if (singleUri != null) {
            uris.add(singleUri);
        }
        return uris;
    }

    private void persistReadPermission(Uri uri) {
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // Some providers expose temporary read grants only; the foreground service starts immediately.
        }
    }

    private JSONObject buildItem(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        JSONObject item = new JSONObject();
        String name = "";
        long size = -1L;

        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, new String[] {
                OpenableColumns.DISPLAY_NAME,
                OpenableColumns.SIZE
            }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex >= 0) {
                    name = cursor.getString(nameIndex);
                }
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeIndex >= 0) {
                    size = cursor.getLong(sizeIndex);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        if (name == null || name.trim().isEmpty()) {
            name = uri.getLastPathSegment();
        }
        if (name == null || name.trim().isEmpty()) {
            name = "media";
        }

        String mimeType = resolver.getType(uri);
        if (mimeType == null || mimeType.trim().isEmpty()) {
            mimeType = "application/octet-stream";
        }

        updateStatus(item, "uri", uri.toString());
        updateStatus(item, "name", name);
        updateStatus(item, "mimeType", mimeType);
        updateStatus(item, "size", size);
        return item;
    }

    private JSONObject buildCapturedItem(Uri uri) {
        JSONObject item = buildItem(uri);
        if (pendingCaptureName != null && !pendingCaptureName.trim().isEmpty()) {
            updateStatus(item, "name", pendingCaptureName);
        }
        if (pendingCaptureMimeType != null && !pendingCaptureMimeType.trim().isEmpty()) {
            updateStatus(item, "mimeType", pendingCaptureMimeType);
        }
        if (pendingCaptureFile != null) {
            updateStatus(item, "size", pendingCaptureFile.length());
            updateStatus(item, "localPath", pendingCaptureFile.getAbsolutePath());
        }
        return item;
    }

    private void enqueueUpload(PluginCall call, int eventId, String baseUrl, JSONArray items) {
        String jobId = UUID.randomUUID().toString();
        JSONObject status = newStatus(jobId, eventId, items.length());
        NativeAlbumUploadStore.writeStatus(getContext(), status);

        String authorization = NativeAuthSessionStore.getAuthorizationHeader(getContext());
        String cookie = authorization == null || authorization.trim().isEmpty()
            ? getCookieHeader(baseUrl)
            : null;

        Intent serviceIntent = new Intent(getContext(), NativeAlbumUploadService.class);
        serviceIntent.setAction(NativeAlbumUploadService.ACTION_ENQUEUE);
        serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_JOB_ID, jobId);
        serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_EVENT_ID, eventId);
        serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_BASE_URL, baseUrl);
        serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_ITEMS, items.toString());
        if (authorization != null && !authorization.trim().isEmpty()) {
            serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_AUTHORIZATION, authorization);
        }
        if (cookie != null && !cookie.trim().isEmpty()) {
            serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_COOKIE, cookie);
        }
        ContextCompat.startForegroundService(getContext(), serviceIntent);
        call.resolve(statusToJSObject(NativeAlbumUploadStore.readStatus(getContext(), jobId)));
    }

    private File createCaptureFile(boolean video) throws Exception {
        File captureDir = new File(getContext().getCacheDir(), "album-capture");
        if (!captureDir.exists() && !captureDir.mkdirs()) {
            throw new IllegalStateException("Unable to prepare camera cache");
        }
        String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        String prefix = video ? "video_" : "photo_";
        String extension = video ? ".mp4" : ".jpg";
        File file = new File(captureDir, prefix + timestamp + "_" + UUID.randomUUID().toString() + extension);
        if (!file.createNewFile()) {
            throw new IllegalStateException("Unable to create camera file");
        }
        return file;
    }

    private void clearPendingCapture(boolean deleteFile) {
        if (deleteFile && pendingCaptureFile != null) {
            deleteQuietly(pendingCaptureFile);
        }
        pendingCaptureUri = null;
        pendingCaptureFile = null;
        pendingCaptureMimeType = null;
        pendingCaptureName = null;
    }

    private void deleteQuietly(File file) {
        if (file == null) {
            return;
        }
        try {
            if (file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        } catch (Exception ignored) {
        }
    }

    private JSONObject newStatus(String jobId, int eventId, int total) {
        JSONObject status = new JSONObject();
        updateStatus(status, "jobId", jobId);
        updateStatus(status, "eventId", eventId);
        updateStatus(status, "status", "queued");
        updateStatus(status, "total", total);
        updateStatus(status, "completed", 0);
        updateStatus(status, "failed", 0);
        updateStatus(status, "currentFile", "");
        updateStatus(status, "currentProgress", 0);
        updateStatus(status, "startedAt", System.currentTimeMillis());
        updateStatus(status, "updatedAt", System.currentTimeMillis());
        return status;
    }

    private void updateStatus(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
        } catch (Exception ignored) {
        }
    }

    private JSObject statusToJSObject(JSONObject status) {
        try {
            return JSObject.fromJSONObject(status != null ? status : NativeAlbumUploadStore.idleStatus());
        } catch (Exception ignored) {
            return new JSObject();
        }
    }

    private String getCookieHeader(String baseUrl) {
        try {
            String cookie = CookieManager.getInstance().getCookie(baseUrl + "/media/upload_media");
            return cookie != null ? cookie : "";
        } catch (Exception ignored) {
            return "";
        }
    }

    private String normalizeBaseUrl(String value) {
        String normalized = value != null ? value.trim() : "";
        if (normalized.isEmpty()) {
            normalized = DEFAULT_BASE_URL;
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }
}
