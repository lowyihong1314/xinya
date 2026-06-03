package com.xinya.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Base64InputStream;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeFileShare")
public class NativeFileSharePlugin extends Plugin {

    private static final String SHARE_DIR_NAME = "native-file-share";
    private static final int MAX_RETAINED_FILES = 20;
    private static final long MAX_FILE_AGE_MS = 24L * 60L * 60L * 1000L;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private File shareRoot;

    @Override
    public void load() {
        shareRoot = new File(getContext().getCacheDir(), SHARE_DIR_NAME);
        if (!shareRoot.exists()) {
            //noinspection ResultOfMethodCallIgnored
            shareRoot.mkdirs();
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }

    @PluginMethod
    public void shareBase64File(PluginCall call) {
        String base64Data = call.getString("base64Data");
        String filename = call.getString("filename", "download");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String title = call.getString("title", filename);
        String text = call.getString("text", "");
        String dialogTitle = call.getString("dialogTitle", title);

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("base64Data is required");
            return;
        }

        executor.execute(() -> {
            try {
                ensureShareRoot();
                pruneShareCache();
                File file = new File(shareRoot, System.currentTimeMillis() + "-" + sanitizeFilename(filename));
                writeBase64File(base64Data, file);

                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
                );

                dispatchToMainThread(() -> {
                    try {
                        Intent shareIntent = new Intent(Intent.ACTION_SEND);
                        shareIntent.setType(safeMimeType(mimeType));
                        shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                        shareIntent.putExtra(Intent.EXTRA_SUBJECT, title);
                        if (text != null && !text.trim().isEmpty()) {
                            shareIntent.putExtra(Intent.EXTRA_TEXT, text);
                        }
                        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                        Intent chooser = Intent.createChooser(shareIntent, dialogTitle);
                        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getContext().startActivity(chooser);

                        JSObject result = new JSObject();
                        result.put("uri", uri.toString());
                        result.put("filename", file.getName());
                        call.resolve(result);
                    } catch (ActivityNotFoundException error) {
                        call.reject("No app is available to share this file");
                    } catch (Exception error) {
                        call.reject(error.getMessage() != null ? error.getMessage() : "share failed");
                    }
                });
            } catch (Exception error) {
                String message = error.getMessage() != null ? error.getMessage() : "share failed";
                dispatchToMainThread(() -> call.reject(message));
            }
        });
    }

    private void ensureShareRoot() {
        if (shareRoot == null) {
            shareRoot = new File(getContext().getCacheDir(), SHARE_DIR_NAME);
        }
        if (!shareRoot.exists()) {
            //noinspection ResultOfMethodCallIgnored
            shareRoot.mkdirs();
        }
    }

    private void writeBase64File(String base64Data, File destination) throws Exception {
        String normalizedData = base64Data;
        int commaIndex = normalizedData.indexOf(',');
        if (commaIndex >= 0) {
            normalizedData = normalizedData.substring(commaIndex + 1);
        }

        byte[] encodedBytes = normalizedData.getBytes(StandardCharsets.US_ASCII);
        try (
            InputStream input = new Base64InputStream(
                new ByteArrayInputStream(encodedBytes),
                Base64.DEFAULT
            );
            OutputStream output = new BufferedOutputStream(new FileOutputStream(destination))
        ) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }
    }

    private void pruneShareCache() {
        File[] files = shareRoot.listFiles();
        if (files == null || files.length == 0) {
            return;
        }

        long cutoff = System.currentTimeMillis() - MAX_FILE_AGE_MS;
        for (File file : files) {
            if (file.isFile() && file.lastModified() < cutoff) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }

        files = shareRoot.listFiles(File::isFile);
        if (files == null || files.length <= MAX_RETAINED_FILES) {
            return;
        }

        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        int removeCount = files.length - MAX_RETAINED_FILES;
        for (int index = 0; index < removeCount; index += 1) {
            //noinspection ResultOfMethodCallIgnored
            files[index].delete();
        }
    }

    private String sanitizeFilename(String filename) {
        String trimmed = filename != null ? filename.trim() : "";
        if (trimmed.isEmpty()) {
            return "download";
        }
        String safe = trimmed.replaceAll("[\\\\/:*?\"<>|]+", "-").replaceAll("\\s+", " ");
        if (safe.length() > 120) {
            safe = safe.substring(0, 120);
        }
        return safe.isEmpty() ? "download" : safe;
    }

    private String safeMimeType(String mimeType) {
        String value = mimeType != null ? mimeType.trim().toLowerCase(Locale.US) : "";
        return value.isEmpty() ? "application/octet-stream" : value;
    }

    private void dispatchToMainThread(Runnable runnable) {
        mainHandler.post(runnable);
    }
}
