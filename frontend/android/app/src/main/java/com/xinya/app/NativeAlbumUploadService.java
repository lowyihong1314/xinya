package com.xinya.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.provider.OpenableColumns;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class NativeAlbumUploadService extends Service {

    public static final String ACTION_ENQUEUE = "com.xinya.app.NativeAlbumUpload.ENQUEUE";
    public static final String ACTION_CANCEL = "com.xinya.app.NativeAlbumUpload.CANCEL";
    public static final String EXTRA_JOB_ID = "jobId";
    public static final String EXTRA_EVENT_ID = "eventId";
    public static final String EXTRA_BASE_URL = "baseUrl";
    public static final String EXTRA_ITEMS = "items";
    public static final String EXTRA_AUTHORIZATION = "authorization";
    public static final String EXTRA_COOKIE = "cookie";

    private static final String CHANNEL_ID = "xinya_album_upload";
    private static final int NOTIFICATION_ID = 2042;
    private static final String DEFAULT_BASE_URL = "https://utbabuddha.com";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicInteger pendingJobs = new AtomicInteger(0);
    private volatile boolean cancelRequested = false;
    private NotificationManager notificationManager;

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_CANCEL.equals(action)) {
            cancelRequested = true;
            JSONObject status = NativeAlbumUploadStore.readStatus(this, intent.getStringExtra(EXTRA_JOB_ID));
            updateStatus(status, "status", "canceled");
            updateStatus(status, "error", "已取消");
            NativeAlbumUploadStore.writeStatus(this, status);
            updateNotification(status);
            if (pendingJobs.get() <= 0) {
                stopSelf();
            }
            return START_NOT_STICKY;
        }

        if (!ACTION_ENQUEUE.equals(action)) {
            return START_NOT_STICKY;
        }

        cancelRequested = false;
        JSONObject initialStatus = NativeAlbumUploadStore.readStatus(this, intent.getStringExtra(EXTRA_JOB_ID));
        startForeground(NOTIFICATION_ID, buildNotification(initialStatus));
        pendingJobs.incrementAndGet();
        executor.execute(() -> runUploadJob(intent));
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void runUploadJob(Intent intent) {
        String jobId = intent.getStringExtra(EXTRA_JOB_ID);
        int eventId = intent.getIntExtra(EXTRA_EVENT_ID, 0);
        String baseUrl = normalizeBaseUrl(intent.getStringExtra(EXTRA_BASE_URL));
        String authorization = intent.getStringExtra(EXTRA_AUTHORIZATION);
        String cookie = authorization == null || authorization.trim().isEmpty()
            ? intent.getStringExtra(EXTRA_COOKIE)
            : null;
        JSONArray items = parseItems(intent.getStringExtra(EXTRA_ITEMS));
        int total = items.length();
        int completed = 0;
        int failed = 0;

        JSONObject status = newStatus(jobId, eventId, total);
        NativeAlbumUploadStore.writeStatus(this, status);
        updateNotification(status);

        for (int index = 0; index < total; index += 1) {
            if (cancelRequested) {
                updateStatus(status, "status", "canceled");
                updateStatus(status, "error", "已取消");
                NativeAlbumUploadStore.writeStatus(this, status);
                updateNotification(status);
                finishJob();
                return;
            }

            JSONObject item = items.optJSONObject(index);
            if (item == null) {
                failed += 1;
                continue;
            }

            String name = item.optString("name", "media");
            updateStatus(status, "status", "running");
            updateStatus(status, "currentFile", name);
            updateStatus(status, "currentProgress", 0);
            updateStatus(status, "completed", completed);
            updateStatus(status, "failed", failed);
            NativeAlbumUploadStore.writeStatus(this, status);
            updateNotification(status);

            try {
                uploadOne(baseUrl, eventId, item, authorization, cookie, (progress) -> {
                    updateStatus(status, "currentProgress", progress);
                    NativeAlbumUploadStore.writeStatus(this, status);
                    updateNotification(status);
                });
                completed += 1;
            } catch (Exception error) {
                failed += 1;
                updateStatus(status, "error", error.getMessage() != null ? error.getMessage() : "上传失败");
            }

            updateStatus(status, "completed", completed);
            updateStatus(status, "failed", failed);
            updateStatus(status, "currentProgress", 100);
            NativeAlbumUploadStore.writeStatus(this, status);
            updateNotification(status);
        }

        updateStatus(status, "status", failed == 0 ? "success" : completed > 0 ? "partial" : "error");
        updateStatus(status, "completed", completed);
        updateStatus(status, "failed", failed);
        updateStatus(status, "currentProgress", 100);
        updateStatus(status, "currentFile", "");
        NativeAlbumUploadStore.writeStatus(this, status);
        updateNotification(status);
        finishJob();
    }

    private void finishJob() {
        if (pendingJobs.decrementAndGet() <= 0) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_DETACH);
            } else {
                //noinspection deprecation
                stopForeground(false);
            }
            stopSelf();
        }
    }

    private void uploadOne(
        String baseUrl,
        int eventId,
        JSONObject item,
        String authorization,
        String cookie,
        ProgressCallback callback
    ) throws Exception {
        Uri uri = Uri.parse(item.optString("uri", ""));
        String name = item.optString("name", "media");
        String mimeType = item.optString("mimeType", "application/octet-stream");
        long size = item.optLong("size", -1L);
        if (size < 0L) {
            size = querySize(uri);
        }

        String boundary = "----XinyaAlbumUpload" + UUID.randomUUID();
        HttpURLConnection connection = null;
        try {
            URL url = new URL(baseUrl + "/media/upload_media");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(120_000);
            connection.setDoOutput(true);
            connection.setChunkedStreamingMode(64 * 1024);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            if (authorization != null && !authorization.trim().isEmpty()) {
                connection.setRequestProperty("Authorization", authorization);
            } else if (cookie != null && !cookie.trim().isEmpty()) {
                connection.setRequestProperty("Cookie", cookie);
            }

            try (
                OutputStream rawOutput = new BufferedOutputStream(connection.getOutputStream());
                InputStream input = new BufferedInputStream(getContentResolver().openInputStream(uri))
            ) {
                if (input == null) {
                    throw new IllegalStateException("Unable to open selected file");
                }
                writeTextPart(rawOutput, boundary, "event_id", String.valueOf(eventId));
                writeFileHeader(rawOutput, boundary, "file", name, mimeType);

                byte[] buffer = new byte[64 * 1024];
                long uploaded = 0L;
                long lastProgressAt = 0L;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (cancelRequested) {
                        throw new IllegalStateException("已取消");
                    }
                    rawOutput.write(buffer, 0, read);
                    uploaded += read;
                    long now = System.currentTimeMillis();
                    if (size > 0L && now - lastProgressAt > 450L) {
                        int progress = (int) Math.max(0, Math.min(99, Math.round((uploaded * 100.0) / size)));
                        callback.onProgress(progress);
                        lastProgressAt = now;
                    }
                }

                rawOutput.write("\r\n".getBytes(StandardCharsets.UTF_8));
                rawOutput.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
                rawOutput.flush();
            }

            int statusCode = connection.getResponseCode();
            boolean ok = statusCode >= 200 && statusCode < 300;
            String responseText = readResponse(ok ? connection.getInputStream() : connection.getErrorStream());
            if (!ok) {
                throw new IllegalStateException("HTTP " + statusCode + ": " + responseText);
            }
            callback.onProgress(100);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void writeTextPart(OutputStream output, String boundary, String name, String value) throws Exception {
        output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(("Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(value.getBytes(StandardCharsets.UTF_8));
        output.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }

    private void writeFileHeader(OutputStream output, String boundary, String fieldName, String fileName, String mimeType) throws Exception {
        output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
        output.write(
            ("Content-Disposition: form-data; name=\"" + fieldName + "\"; filename=\"" + sanitizeFilename(fileName) + "\"\r\n")
                .getBytes(StandardCharsets.UTF_8)
        );
        output.write(("Content-Type: " + (mimeType != null && !mimeType.isEmpty() ? mimeType : "application/octet-stream") + "\r\n\r\n")
            .getBytes(StandardCharsets.UTF_8));
    }

    private long querySize(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, new String[] { OpenableColumns.SIZE }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0) {
                    return cursor.getLong(index);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return -1L;
    }

    private String readResponse(InputStream input) throws Exception {
        if (input == null) {
            return "";
        }
        try (InputStream source = input; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int count;
            while ((count = source.read(chunk)) != -1) {
                buffer.write(chunk, 0, count);
            }
            return buffer.toString(StandardCharsets.UTF_8.name());
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

    private void updateStatus(JSONObject status, String key, Object value) {
        try {
            status.put(key, value);
        } catch (Exception ignored) {
        }
    }

    private JSONArray parseItems(String raw) {
        try {
            return raw == null || raw.trim().isEmpty() ? new JSONArray() : new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
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

    private String sanitizeFilename(String fileName) {
        String value = fileName != null ? fileName.trim() : "";
        if (value.isEmpty()) {
            value = "media";
        }
        return value.replace("\"", "_").replace("\r", "_").replace("\n", "_");
    }

    private void updateNotification(JSONObject status) {
        if (notificationManager != null) {
            notificationManager.notify(NOTIFICATION_ID, buildNotification(status));
        }
    }

    private Notification buildNotification(JSONObject status) {
        String state = status.optString("status", "queued");
        int total = Math.max(0, status.optInt("total", 0));
        int completed = Math.max(0, status.optInt("completed", 0));
        int failed = Math.max(0, status.optInt("failed", 0));
        int currentProgress = Math.max(0, Math.min(100, status.optInt("currentProgress", 0)));
        int overall = total > 0 ? Math.min(100, Math.round(((completed * 100f) + currentProgress) / total)) : 0;
        String title;
        if ("success".equals(state)) {
            title = "Album 上传完成";
        } else if ("partial".equals(state) || "error".equals(state)) {
            title = "Album 上传有失败项目";
        } else if ("canceled".equals(state)) {
            title = "Album 上传已取消";
        } else {
            title = "Album 正在后台上传";
        }
        String text = "完成 " + completed + "/" + total + (failed > 0 ? "，失败 " + failed : "");
        String currentFile = status.optString("currentFile", "");
        if (!currentFile.isEmpty() && "running".equals(state)) {
            text = currentFile + " · " + text;
        }

        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_music_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing("queued".equals(state) || "running".equals(state))
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if ("queued".equals(state) || "running".equals(state)) {
            builder.setProgress(100, overall, total <= 0);
        } else {
            builder.setProgress(0, 0, false);
        }

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || notificationManager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Album uploads",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Uploads album photos and videos in the background.");
        notificationManager.createNotificationChannel(channel);
    }

    private interface ProgressCallback {
        void onProgress(int progress);
    }
}
