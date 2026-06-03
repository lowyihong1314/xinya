package com.xinya.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.webkit.CookieManager;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;

public class AlbumArtProvider extends ContentProvider {

    private static final String AUTHORITY_SUFFIX = ".albumart";
    private static final String PREFS_NAME = "xinya_album_art_urls";
    private static final String PATH_ART = "art";
    private static final String CACHE_DIR = "android_auto_album_art";
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 15_000;
    private static final ExecutorService REFRESH_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Set<String> REFRESHED_HASHES = Collections.synchronizedSet(new HashSet<>());

    public static Uri buildArtworkUri(Context context, String remoteUrl) {
        if (context == null || remoteUrl == null || remoteUrl.trim().isEmpty()) {
            return buildDefaultArtworkUri(context);
        }
        String normalizedUrl = remoteUrl.trim();
        String hash = sha256(normalizedUrl);
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(hash, normalizedUrl)
            .apply();
        return new Uri.Builder()
            .scheme("content")
            .authority(context.getPackageName() + AUTHORITY_SUFFIX)
            .appendPath(PATH_ART)
            .appendPath(hash)
            .build();
    }

    public static Uri buildDefaultArtworkUri(Context context) {
        if (context == null) {
            return Uri.EMPTY;
        }
        return new Uri.Builder()
            .scheme("android.resource")
            .authority(context.getResources().getResourcePackageName(R.drawable.ic_music_notification))
            .appendPath(context.getResources().getResourceTypeName(R.drawable.ic_music_notification))
            .appendPath(context.getResources().getResourceEntryName(R.drawable.ic_music_notification))
            .build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode != null && mode.contains("w")) {
            throw new FileNotFoundException("Read-only provider");
        }
        Context context = getContext();
        if (context == null) {
            throw new FileNotFoundException("Context unavailable");
        }

        String hash = readHash(uri);
        if (hash == null) {
            throw new FileNotFoundException("Invalid artwork URI");
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String remoteUrl = prefs.getString(hash, "");
        if (remoteUrl == null || remoteUrl.trim().isEmpty()) {
            throw new FileNotFoundException("Artwork URL not registered");
        }

        File cacheRoot = new File(context.getCacheDir(), CACHE_DIR);
        if (!cacheRoot.exists() && !cacheRoot.mkdirs()) {
            throw new FileNotFoundException("Artwork cache unavailable");
        }

        File file = new File(cacheRoot, hash + ".img");
        if (!file.exists() || file.length() == 0) {
            downloadArtwork(context, remoteUrl, file);
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        }

        ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        refreshArtworkOnce(context.getApplicationContext(), remoteUrl, file, hash);
        return descriptor;
    }

    @Override
    public String getType(Uri uri) {
        return "image/*";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    private String readHash(Uri uri) {
        if (uri == null) {
            return null;
        }
        List<String> segments = uri.getPathSegments();
        if (segments == null || segments.size() != 2 || !PATH_ART.equals(segments.get(0))) {
            return null;
        }
        String hash = segments.get(1);
        return hash != null && hash.matches("[0-9a-f]{64}") ? hash : null;
    }

    private void downloadArtwork(Context context, String remoteUrl, File target) throws FileNotFoundException {
        HttpURLConnection conn = null;
        InputStream input = null;
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try {
            URL url = new URL(remoteUrl);
            String protocol = url.getProtocol();
            if (!"http".equals(protocol) && !"https".equals(protocol)) {
                throw new FileNotFoundException("Unsupported artwork URL");
            }
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestProperty("Accept", "image/*");
            String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(context);
            String cookie = authorizationHeader == null ? getCookieOnMainThread(remoteUrl) : null;
            if (authorizationHeader != null && !authorizationHeader.isEmpty()) {
                conn.setRequestProperty("Authorization", authorizationHeader);
            } else if (cookie != null && !cookie.isEmpty()) {
                conn.setRequestProperty("Cookie", cookie);
            }
            int status = conn.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new FileNotFoundException("Artwork HTTP " + status);
            }
            input = conn.getInputStream();
            try (FileOutputStream output = new FileOutputStream(temp, false)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
            }
            File backup = new File(target.getParentFile(), target.getName() + ".bak");
            if (target.exists()) {
                if (backup.exists() && !backup.delete()) {
                    throw new FileNotFoundException("Failed to prepare artwork cache");
                }
                if (!target.renameTo(backup)) {
                    throw new FileNotFoundException("Failed to replace artwork cache");
                }
            }
            if (!temp.renameTo(target)) {
                if (backup.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    backup.renameTo(target);
                }
                throw new FileNotFoundException("Failed to save artwork cache");
            }
            if (backup.exists()) {
                //noinspection ResultOfMethodCallIgnored
                backup.delete();
            }
        } catch (FileNotFoundException e) {
            throw e;
        } catch (Exception e) {
            throw new FileNotFoundException(e.getMessage() != null ? e.getMessage() : "Artwork download failed");
        } finally {
            if (input != null) {
                try { input.close(); } catch (Exception ignored) {}
            }
            if (conn != null) {
                conn.disconnect();
            }
            if (temp.exists()) {
                temp.delete();
            }
        }
    }

    private void refreshArtworkOnce(Context context, String remoteUrl, File target, String hash) {
        if (context == null || remoteUrl == null || remoteUrl.trim().isEmpty() || target == null || hash == null) {
            return;
        }
        if (!REFRESHED_HASHES.add(hash)) {
            return;
        }
        REFRESH_EXECUTOR.execute(() -> {
            try {
                downloadArtwork(context, remoteUrl, target);
            } catch (FileNotFoundException ignored) {
                // Keep the cached artwork. Android Auto can continue to show the
                // previous cover when the APK opens without network access.
            }
        });
    }

    private String getCookieOnMainThread(String url) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try { return CookieManager.getInstance().getCookie(url); } catch (Exception e) { return null; }
        }
        Handler mainHandler = new Handler(Looper.getMainLooper());
        FutureTask<String> task = new FutureTask<>(() -> {
            try { return CookieManager.getInstance().getCookie(url); } catch (Exception e) { return null; }
        });
        mainHandler.post(task);
        try { return task.get(); } catch (Exception e) { return null; }
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes("UTF-8"));
            StringBuilder builder = new StringBuilder();
            for (byte b : bytes) {
                builder.append(String.format("%02x", b));
            }
            return builder.toString();
        } catch (Exception e) {
            return String.valueOf(value.hashCode());
        }
    }
}
