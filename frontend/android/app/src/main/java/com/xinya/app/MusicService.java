package com.xinya.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;

import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import com.getcapacitor.JSObject;
import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.audio.AudioAttributes;
import com.google.android.exoplayer2.source.ConcatenatingMediaSource;
import com.google.android.exoplayer2.source.ProgressiveMediaSource;
import com.google.android.exoplayer2.upstream.DefaultDataSource;
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;

public class MusicService extends Service {

    private static final String CHANNEL_ID = "xinya_music";
    private static final int NOTIFICATION_ID = 1042;
    private static final String TAG = "MusicService";
    private static final String DEFAULT_ALBUM_LABEL = "全部歌曲";

    // Album art target size — Samsung One UI reliably displays up to 512×512.
    private static final int ART_MAX_PX = 512;

    // ── Public interfaces ────────────────────────────────────────────────────

    public interface EventCallback {
        void emit(String event, JSObject data);
    }

    public static class PlaylistItem {
        public final int id;
        public final String url;
        public final String title;
        public final String album;
        public final String coverUrl;

        public PlaylistItem(int id, String url, String title, String album, String coverUrl) {
            this.id = id;
            this.url = url != null ? url : "";
            this.title = title != null ? title : "";
            this.album = album != null && !album.trim().isEmpty() ? album : DEFAULT_ALBUM_LABEL;
            this.coverUrl = coverUrl != null ? coverUrl : "";
        }
    }

    public class MusicBinder extends Binder {
        MusicService getService() { return MusicService.this; }
    }

    // ── Fields ───────────────────────────────────────────────────────────────

    private final IBinder binder = new MusicBinder();
    private ExoPlayer player;
    private MediaSessionCompat mediaSession;
    private NotificationManager notificationManager;
    private EventCallback eventCallback;

    private List<PlaylistItem> playlist = new ArrayList<>();
    private String currentTitle = "";
    private String currentAlbum = "";
    private String currentCoverUrl = "";
    private int currentTrackId = -1;
    private boolean isForeground = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String baseUrl = "";

    // Album art cache — keeps last downloaded bitmap + its URL.
    private Bitmap currentArtBitmap = null;
    private String lastFetchedCoverUrl = null;
    private final ExecutorService coverFetchExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService playbackMetricExecutor = Executors.newSingleThreadExecutor();
    private final Runnable playbackMinuteReporter = new Runnable() {
        @Override
        public void run() {
            if (player == null || !player.isPlaying() || currentTrackId <= 0 || baseUrl == null || baseUrl.isEmpty()) {
                return;
            }
            final int musicId = currentTrackId;
            final String targetUrl = NativeMusicRepository.normalizeBaseUrl(baseUrl) + "/api/music/add_one_minute/" + musicId;
            final String cookie = CookieManager.getInstance().getCookie(targetUrl);
            playbackMetricExecutor.execute(() -> {
                try {
                    NativeMusicRepository.addOneMinute(baseUrl, cookie, musicId);
                } catch (Exception e) {
                    Log.w(TAG, "addOneMinute failed: " + e.getMessage());
                }
            });
            mainHandler.postDelayed(this, 60_000);
        }
    };

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = getSystemService(NotificationManager.class);
        createNotificationChannel();
        initPlayer();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureForeground();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return binder; }

    @Override
    public void onDestroy() {
        coverFetchExecutor.shutdown();
        playbackMetricExecutor.shutdown();
        mainHandler.removeCallbacks(playbackMinuteReporter);
        recycleBitmap();
        if (player != null) { player.release(); player = null; }
        if (mediaSession != null) { mediaSession.release(); mediaSession = null; }
        super.onDestroy();
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    private void initPlayer() {
        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true
        );

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                updatePlaybackState();
                updatePlaybackMinuteReporting();
                updateNotification();
                if (state == Player.STATE_ENDED && eventCallback != null) {
                    eventCallback.emit("trackEnded", new JSObject());
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updatePlaybackState();
                updatePlaybackMinuteReporting();
                updateNotification();
                emitPlayStateChanged(isPlaying);
            }

            @Override
            public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                int idx = player.getCurrentMediaItemIndex();
                if (idx >= 0 && idx < playlist.size()) {
                    PlaylistItem item = playlist.get(idx);
                    currentTitle = item.title;
                    currentAlbum = item.album;
                    currentCoverUrl = item.coverUrl;
                    currentTrackId = item.id;
                }
                updatePlaybackState();
                updatePlaybackMinuteReporting();
                updateNotification();
                emitTrackChanged();
            }
        });

        mediaSession = new MediaSessionCompat(this, "XinyaMusic");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay()  { resume(); }
            @Override public void onPause() { pause(); }

            @Override
            public void onSkipToNext() {
                skipToNext();
            }

            @Override
            public void onSkipToPrevious() {
                skipToPrevious();
            }

            @Override
            public void onSeekTo(long pos) { seekTo(pos); }
        });
        mediaSession.setActive(true);
        updatePlaybackState();
    }

    // ── Public API ───────────────────────────────────────────────────────────

    public void setEventCallback(EventCallback callback) { eventCallback = callback; }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = NativeMusicRepository.normalizeBaseUrl(baseUrl);
        runOnPlayerThread(this::updatePlaybackMinuteReporting);
    }

    public void setPlaylist(List<PlaylistItem> items, int startIndex, int exoRepeatMode) {
        loadPlaylist(items, startIndex, exoRepeatMode, false, 0L, true);
    }

    public void loadPlaylist(
        List<PlaylistItem> items,
        int startIndex,
        int exoRepeatMode,
        boolean shuffleEnabled,
        long positionMs,
        boolean playWhenReady
    ) {
        runOnPlayerThread(() -> {
            if (items == null || items.isEmpty()) return;
            playlist = new ArrayList<>(items);
            ensureForeground();

            String cookieHeader = null;
            if (!items.isEmpty()) {
                cookieHeader = CookieManager.getInstance().getCookie(items.get(0).url);
            }

            ConcatenatingMediaSource concat = new ConcatenatingMediaSource();
            for (PlaylistItem item : items) {
                concat.addMediaSource(buildMediaSource(item.url, cookieHeader));
            }

            int safeStart = Math.max(0, Math.min(startIndex, items.size() - 1));
            player.setMediaSource(concat);
            player.setRepeatMode(exoRepeatMode);
            player.setShuffleModeEnabled(shuffleEnabled);
            player.prepare();
            player.seekToDefaultPosition(safeStart);
            if (positionMs > 0) {
                player.seekTo(safeStart, Math.max(positionMs, 0L));
            }
            player.setPlayWhenReady(playWhenReady);
            if (playWhenReady) {
                player.play();
            } else {
                player.pause();
            }

            PlaylistItem start = items.get(safeStart);
            currentTitle = start.title;
            currentAlbum = start.album;
            currentCoverUrl = start.coverUrl;
            currentTrackId = start.id;

            updatePlaybackState();
            updatePlaybackMinuteReporting();
            updateNotification();
        });
    }

    public void play(String url, String title, String album, String coverUrl) {
        PlaylistItem item = new PlaylistItem(-1, url, title, album, coverUrl);
        List<PlaylistItem> single = new ArrayList<>();
        single.add(item);
        setPlaylist(single, 0, Player.REPEAT_MODE_OFF);
    }

    public void skipToIndex(int index) {
        runOnPlayerThread(() -> {
            if (player == null || index < 0 || index >= player.getMediaItemCount()) return;
            player.seekToDefaultPosition(index);
            player.play();
        });
    }

    public void setRepeatMode(int exoRepeatMode) {
        runOnPlayerThread(() -> {
            if (player != null) player.setRepeatMode(exoRepeatMode);
        });
    }

    public void pause() {
        runOnPlayerThread(() -> {
            if (player != null) player.pause();
            updatePlaybackState();
            updatePlaybackMinuteReporting();
            updateNotification();
        });
    }

    public void resume() {
        runOnPlayerThread(() -> {
            if (player != null) player.play();
            updatePlaybackState();
            updatePlaybackMinuteReporting();
            updateNotification();
        });
    }

    public void stop() {
        runOnPlayerThread(() -> {
            if (player != null) player.stop();
            playlist.clear();
            currentTitle = "";
            currentAlbum = "";
            currentCoverUrl = "";
            currentTrackId = -1;
            recycleBitmap();
            updatePlaybackState();
            updatePlaybackMinuteReporting();
            emitPlayStateChanged(false);
            if (isForeground) { stopForeground(true); isForeground = false; }
            if (notificationManager != null) notificationManager.cancel(NOTIFICATION_ID);
        });
    }

    public void seekTo(long positionMs) {
        runOnPlayerThread(() -> {
            if (player != null) player.seekTo(Math.max(positionMs, 0L));
            updatePlaybackState();
        });
    }

    // ── State accessors ──────────────────────────────────────────────────────

    public long getPositionMs() {
        return callOnPlayerThread(() -> player == null ? 0L : Math.max(player.getCurrentPosition(), 0L), 0L);
    }

    public long getDurationMs() {
        return callOnPlayerThread(() -> {
            if (player == null) return 0L;
            long d = player.getDuration();
            return d > 0 ? d : 0L;
        }, 0L);
    }

    public boolean isPlaying() {
        return callOnPlayerThread(() -> player != null && player.isPlaying(), false);
    }

    public int getCurrentTrackId() { return currentTrackId; }

    public int getCurrentMediaIndex() {
        return callOnPlayerThread(() -> player == null ? -1 : player.getCurrentMediaItemIndex(), -1);
    }

    public void setShuffleEnabled(boolean enabled) {
        runOnPlayerThread(() -> {
            if (player != null) {
                player.setShuffleModeEnabled(enabled);
            }
        });
    }

    public boolean isShuffleEnabled() {
        return callOnPlayerThread(() -> player != null && player.getShuffleModeEnabled(), false);
    }

    public void skipToNext() {
        runOnPlayerThread(() -> {
            if (player == null) return;
            if (player.hasNextMediaItem()) {
                player.seekToNextMediaItem();
                player.play();
            }
        });
    }

    public void skipToPrevious() {
        runOnPlayerThread(() -> {
            if (player == null) return;
            if (player.getCurrentPosition() > 3_000) {
                player.seekTo(0);
                return;
            }
            if (player.hasPreviousMediaItem()) {
                player.seekToPreviousMediaItem();
                player.play();
            }
        });
    }

    // ── Notification ─────────────────────────────────────────────────────────

    /**
     * Called whenever playback state or track changes.
     *
     * If the current track's cover URL is new, we:
     *  1. Show the notification immediately with whatever art we already have
     *     (no flicker for same-cover tracks; blank placeholder on first load).
     *  2. Fetch the art in a background thread.
     *  3. Once downloaded, refresh both MediaSession metadata and the notification
     *     — this is what Samsung One UI reads to display art in the media panel
     *     and on the lock screen.
     */
    private void updateNotification() {
        if (player == null || mediaSession == null || notificationManager == null) return;

        String cover = currentCoverUrl != null ? currentCoverUrl : "";

        if (cover.isEmpty()) {
            // Track has no cover — clear cached art and refresh.
            recycleBitmap();
            refreshNotificationNow();
            return;
        }

        if (!cover.equals(lastFetchedCoverUrl)) {
            // New cover URL: show immediately with stale/no art, then fetch.
            refreshNotificationNow();
            fetchCoverBitmapAsync(cover, this::refreshNotificationNow);
        } else {
            // Art already cached — instant refresh.
            refreshNotificationNow();
        }
    }

    /** Rebuilds MediaSession metadata + notification using the current cached bitmap. */
    private void refreshNotificationNow() {
        updateMediaMetadata(currentArtBitmap);
        try {
            promoteNotification(buildPlaybackNotification());
        } catch (Exception e) {
            Log.e(TAG, "Notification build failed", e);
            promoteNotification(buildFallbackNotification());
        }
    }

    /**
     * Sets MediaSession metadata — this is the primary source Android and Samsung
     * One UI use for the lock-screen player, media output panel, and Bluetooth displays.
     */
    private void updateMediaMetadata(Bitmap art) {
        if (mediaSession == null) return;
        String title = currentTitle.isEmpty() ? "UTBA Music" : currentTitle;

        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, currentAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, getDurationMs());

        if (art != null) {
            // Three keys for maximum device compatibility:
            // METADATA_KEY_ART          — standard, used by AOSP lock screen
            // METADATA_KEY_ALBUM_ART    — used by some OEMs (Samsung, Huawei)
            // METADATA_KEY_DISPLAY_ICON — used by Samsung One UI media panel
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, art)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art);
        }

        mediaSession.setMetadata(meta.build());
    }

    private Notification buildPlaybackNotification() {
        String title = currentTitle.isEmpty() ? "UTBA Music" : currentTitle;
        String subtitle = currentAlbum.isEmpty() ? "后台播放中" : currentAlbum;

        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0,
            new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOngoing(player.isPlaying())
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .addAction(R.drawable.ic_music_prev, "Prev",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
            .addAction(
                player.isPlaying() ? R.drawable.ic_music_pause : R.drawable.ic_music_play,
                player.isPlaying() ? "Pause" : "Play",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this,
                    player.isPlaying() ? PlaybackStateCompat.ACTION_PAUSE : PlaybackStateCompat.ACTION_PLAY))
            .addAction(R.drawable.ic_music_next, "Next",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));

        if (currentArtBitmap != null) {
            builder.setLargeIcon(currentArtBitmap);
        }

        return builder.build();
    }

    private Notification buildFallbackNotification() {
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0,
            new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle.isEmpty() ? "UTBA Music" : currentTitle)
            .setContentText(currentAlbum.isEmpty() ? "准备播放" : currentAlbum)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .build();
    }

    // ── Album art fetching ────────────────────────────────────────────────────

    /**
     * Downloads cover art on a background thread and calls {@code onComplete} on the
     * main thread.  Uses the WebView cookie jar so authenticated cover URLs work.
     *
     * IMPORTANT: CookieManager.getCookie() is NOT thread-safe — it must be called on
     * the main thread.  We read it here (always on main) and pass the value into the
     * background worker so the HTTP request carries the correct session cookie.
     */
    private void fetchCoverBitmapAsync(String coverUrl, Runnable onComplete) {
        if (coverUrl == null || coverUrl.isEmpty()) { onComplete.run(); return; }
        if (coverUrl.equals(lastFetchedCoverUrl) && currentArtBitmap != null) {
            onComplete.run();
            return;
        }

        // Read cookie on main thread BEFORE dispatching to background.
        final String cookie = CookieManager.getInstance().getCookie(coverUrl);

        coverFetchExecutor.execute(() -> {
            Bitmap bitmap = downloadAndScaleBitmap(coverUrl, cookie);
            mainHandler.post(() -> {
                if (bitmap != null) {
                    recycleBitmap();
                    currentArtBitmap = bitmap;
                    lastFetchedCoverUrl = coverUrl;
                } else {
                    // Download failed — mark URL as tried so we don't retry on every state change.
                    if (!coverUrl.equals(lastFetchedCoverUrl)) {
                        recycleBitmap();
                        lastFetchedCoverUrl = coverUrl;
                    }
                }
                onComplete.run();
            });
        });
    }

    /**
     * @param cookie  Session cookie read on the main thread by the caller.
     *                Must NOT be fetched here — CookieManager is not thread-safe.
     */
    private Bitmap downloadAndScaleBitmap(String coverUrl, String cookie) {
        HttpURLConnection conn = null;
        InputStream in = null;
        try {
            URL url = new URL(coverUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(15_000);
            conn.setRequestProperty("Accept", "image/*");
            if (cookie != null && !cookie.isEmpty()) {
                conn.setRequestProperty("Cookie", cookie);
            }
            conn.connect();

            int status = conn.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "Cover fetch HTTP " + status + " for " + coverUrl);
                return null;
            }

            // ARGB_8888: required for correct rendering in MediaMetadata and notification
            // large-icon slots on all Android versions.  RGB_565 (16-bit, no alpha) can
            // cause silent failures or color artifacts on Samsung / MIUI notification systems.
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = 2;          // typical 800 px source → ~400 px output
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;

            in = conn.getInputStream();
            Bitmap bitmap = BitmapFactory.decodeStream(in, null, opts);
            if (bitmap == null) {
                Log.w(TAG, "BitmapFactory returned null for " + coverUrl);
                return null;
            }

            // Hard-cap at ART_MAX_PX — Samsung One UI silently drops larger bitmaps.
            int w = bitmap.getWidth();
            int h = bitmap.getHeight();
            if (w > ART_MAX_PX || h > ART_MAX_PX) {
                float scale = Math.min((float) ART_MAX_PX / w, (float) ART_MAX_PX / h);
                Bitmap scaled = Bitmap.createScaledBitmap(
                    bitmap, Math.round(w * scale), Math.round(h * scale), true);
                bitmap.recycle();
                return scaled;
            }
            return bitmap;

        } catch (Exception e) {
            Log.w(TAG, "Cover download failed: " + e.getMessage());
            return null;
        } finally {
            if (in != null) { try { in.close(); } catch (IOException ignored) {} }
            if (conn != null) conn.disconnect();
        }
    }

    private void recycleBitmap() {
        if (currentArtBitmap != null && !currentArtBitmap.isRecycled()) {
            currentArtBitmap.recycle();
        }
        currentArtBitmap = null;
        lastFetchedCoverUrl = null;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    private ProgressiveMediaSource buildMediaSource(String url, String cookieHeader) {
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true);

        String cookie = cookieHeader != null ? cookieHeader : CookieManager.getInstance().getCookie(url);
        if (cookie != null && !cookie.isEmpty()) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cookie", cookie);
            httpFactory.setDefaultRequestProperties(headers);
        }

        DefaultDataSource.Factory factory = new DefaultDataSource.Factory(this, httpFactory);

        return new ProgressiveMediaSource.Factory(factory)
            .createMediaSource(MediaItem.fromUri(url));
    }

    private void emitPlayStateChanged(boolean isPlaying) {
        if (eventCallback == null) return;
        JSObject payload = new JSObject();
        payload.put("isPlaying", isPlaying);
        eventCallback.emit("playStateChanged", payload);
    }

    private void emitTrackChanged() {
        if (eventCallback == null) return;
        JSObject payload = new JSObject();
        payload.put("id", currentTrackId);
        payload.put("index", player != null ? player.getCurrentMediaItemIndex() : -1);
        eventCallback.emit("trackChanged", payload);
    }

    private void updatePlaybackState() {
        if (mediaSession == null || player == null) return;

        long actions =
            PlaybackStateCompat.ACTION_PLAY |
            PlaybackStateCompat.ACTION_PAUSE |
            PlaybackStateCompat.ACTION_PLAY_PAUSE |
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
            PlaybackStateCompat.ACTION_SEEK_TO;

        int state;
        if (player.isPlaying()) state = PlaybackStateCompat.STATE_PLAYING;
        else if (player.getPlaybackState() == Player.STATE_ENDED) state = PlaybackStateCompat.STATE_STOPPED;
        else state = PlaybackStateCompat.STATE_PAUSED;

        mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, getPositionMs(), player.isPlaying() ? 1.0f : 0.0f)
            .build());
    }

    private void ensureForeground() {
        promoteNotification(buildFallbackNotification());
    }

    private void updatePlaybackMinuteReporting() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(this::updatePlaybackMinuteReporting);
            return;
        }
        mainHandler.removeCallbacks(playbackMinuteReporter);
        if (player == null || !player.isPlaying() || currentTrackId <= 0 || baseUrl == null || baseUrl.isEmpty()) {
            return;
        }
        mainHandler.postDelayed(playbackMinuteReporter, 60_000);
    }

    private void promoteNotification(Notification notification) {
        try {
            if (!isForeground) { startForeground(NOTIFICATION_ID, notification); isForeground = true; return; }
            notificationManager.notify(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            Log.e(TAG, "Failed to promote notification", e);
        }
    }

    private void createNotificationChannel() {
        if (notificationManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "Music Playback", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Xinya music playback controls");
        ch.setShowBadge(false);             // no badge dot for media channels
        notificationManager.createNotificationChannel(ch);
    }

    private void runOnPlayerThread(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) { action.run(); return; }
        mainHandler.post(action);
    }

    private <T> T callOnPlayerThread(java.util.concurrent.Callable<T> action, T fallback) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try { return action.call(); } catch (Exception e) { return fallback; }
        }
        FutureTask<T> task = new FutureTask<>(() -> {
            try { return action.call(); } catch (Exception e) { return fallback; }
        });
        mainHandler.post(task);
        try { return task.get(); } catch (Exception e) { return fallback; }
    }
}
