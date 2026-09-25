package com.xinya.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.session.MediaButtonReceiver;

import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import com.getcapacitor.JSObject;
import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.audio.AudioAttributes;
import com.google.android.exoplayer2.source.MediaSource;
import com.google.android.exoplayer2.source.ProgressiveMediaSource;
import com.google.android.exoplayer2.upstream.DefaultDataSource;
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;

public class MusicService extends MediaBrowserServiceCompat {

    private static final String CHANNEL_ID = "xinya_music";
    private static final int NOTIFICATION_ID = 1042;
    private static final String TAG = "MusicService";
    private static final String DEFAULT_ALBUM_LABEL = "全部歌曲";
    private static final String DEFAULT_AUTO_BASE_URL = "https://utbabuddha.com";
    private static final String PREFS_NAME = "xinya_music_service";
    private static final String PREF_BASE_URL = "base_url";
    private static final String CATALOG_FILE_NAME = "music_catalog.json";
    private static final long CATALOG_CACHE_TTL_MS = 10 * 60 * 1000L;
    private static final String MEDIA_ROOT = "root";
    private static final String MEDIA_ALL = "all";
    private static final String MEDIA_ALBUMS = "albums";
    private static final String MEDIA_ALBUM_PREFIX = "album:";
    private static final String MEDIA_MUSIC_PREFIX = "music:";
    private static final String MEDIA_ALBUM_TRACK_PREFIX = "albumtrack:";

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
    private volatile String baseUrl = "";

    private final Object catalogLock = new Object();
    private final List<NativeMusicRepository.AlbumRecord> catalogAlbums = new ArrayList<>();
    private final List<NativeMusicRepository.MusicRecord> catalogMusics = new ArrayList<>();
    private long catalogLoadedAtMs = 0L;
    private static final String PREF_ACCOMPANIMENT = "accompaniment_mode";
    private static final String PREF_DEVICE_ID = "playback_device_id";
    private static final long PLAYBACK_HEARTBEAT_MS = 10_000L;
    /** 一人一设备：本机的设备 id / 名称，以及是否已被其他设备接管。 */
    private String playbackDeviceId = "";
    private String playbackDeviceName = "";
    private volatile boolean pausedByRemoteDevice = false;
    private volatile boolean needsClaim = true;
    private final Runnable playbackHeartbeatRunner = new Runnable() {
        @Override
        public void run() {
            sendPlaybackHeartbeat(false);
            scheduleHeartbeat();
        }
    };
    /** 伴奏模式：有伴奏的歌用伴奏版 URL（车机端的播放列表也遵守）。 */
    private volatile boolean accompanimentMode = false;

    // Album art cache — keeps last downloaded bitmap + its URL.
    private Bitmap currentArtBitmap = null;
    private String lastFetchedCoverUrl = null;
    private final ExecutorService coverFetchExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService catalogExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService playbackMetricExecutor = Executors.newSingleThreadExecutor();
    // ── Listening-minute accounting ──────────────────────────────────────────
    //
    // Instead of a 60 s timer that restarts on every state change (and therefore
    // drops the partial minute on pause / buffering / track switch), we accumulate
    // the real wall-clock time spent with ExoPlayer in the "isPlaying" state.
    // Buffering and pauses simply freeze the accumulator; each full 60 000 ms is
    // reported once for the track that is playing at that moment. The remainder
    // below 60 s is carried over across track changes so no listening time is lost.
    private static final long MINUTE_MS = 60_000L;
    private long playbackAccumulatedMs = 0L;
    private long playbackSegmentStartMs = -1L;
    private final Runnable playbackMinuteReporter = new Runnable() {
        @Override
        public void run() {
            foldPlaybackSegment();
            reportAccumulatedMinutes();
            schedulePlaybackMinuteTick();
        }
    };

    // ── Lifecycle ────────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        baseUrl = NativeMusicRepository.normalizeBaseUrl(
            prefs.getString(PREF_BASE_URL, DEFAULT_AUTO_BASE_URL)
        );
        accompanimentMode = prefs.getBoolean(PREF_ACCOMPANIMENT, false);
        playbackDeviceId = prefs.getString(PREF_DEVICE_ID, "");
        if (playbackDeviceId == null || playbackDeviceId.isEmpty()) {
            playbackDeviceId = "android-" + java.util.UUID.randomUUID().toString();
            prefs.edit().putString(PREF_DEVICE_ID, playbackDeviceId).apply();
        }
        String model = Build.MODEL != null ? Build.MODEL.trim() : "";
        String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER.trim() : "";
        playbackDeviceName = (model.toLowerCase().startsWith(manufacturer.toLowerCase()) ? model : (manufacturer + " " + model)).trim();
        if (playbackDeviceName.isEmpty()) playbackDeviceName = "Android 手机";
        loadCatalogSnapshot();
        notificationManager = getSystemService(NotificationManager.class);
        createNotificationChannel();
        initPlayer();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 通知栏 / 蓝牙 / 车机的媒体按键都经由 MediaButtonReceiver 以 startForegroundService 送进来，
        // 必须先 startForeground 再交给 MediaSession 处理，否则按键无效且会触发 ANR 级异常。
        if (intent != null && Intent.ACTION_MEDIA_BUTTON.equals(intent.getAction())) {
            ensureForeground();
            MediaButtonReceiver.handleIntent(mediaSession, intent);
            return START_NOT_STICKY;
        }
        if (intent == null && playlist.isEmpty()) {
            // 系统重启服务但已无播放内容：直接退出，不挂一个「准备播放」的死通知。
            stopSelf();
            return START_NOT_STICKY;
        }
        ensureForeground();
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (MediaBrowserServiceCompat.SERVICE_INTERFACE.equals(action)) {
            return super.onBind(intent);
        }
        return binder;
    }

    @Override
    public void onDestroy() {
        coverFetchExecutor.shutdown();
        catalogExecutor.shutdown();
        mainHandler.removeCallbacks(playbackHeartbeatRunner);
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
        // 拔耳机 / 断蓝牙时自动暂停，避免突然外放。
        player.setHandleAudioBecomingNoisy(true);
        // 熄屏后保持 CPU 与 Wi-Fi 唤醒，不然串流播到一半会停。
        player.setWakeMode(C.WAKE_MODE_NETWORK);

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
                if (isPlaying) {
                    // 本机开始播放：抢占为活动设备（第一次或被别人接管过之后）。
                    pausedByRemoteDevice = false;
                    if (needsClaim) {
                        sendPlaybackHeartbeat(true);
                    }
                    scheduleHeartbeat();
                } else {
                    mainHandler.removeCallbacks(playbackHeartbeatRunner);
                }
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
            public void onPrepareFromMediaId(String mediaId, Bundle extras) {
                playFromBrowserMediaId(mediaId, false);
            }

            @Override
            public void onPlayFromMediaId(String mediaId, Bundle extras) {
                playFromBrowserMediaId(mediaId, true);
            }

            @Override
            public void onPlayFromSearch(String query, Bundle extras) {
                playFirstSearchResult(query);
            }

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

            @Override
            public void onStop() { stop(); }

            @Override
            public void onSkipToQueueItem(long id) {
                runOnPlayerThread(() -> {
                    for (int i = 0; i < playlist.size(); i++) {
                        if (playlist.get(i).id == (int) id) {
                            skipToIndex(i);
                            return;
                        }
                    }
                });
            }

            @Override
            public void onSetShuffleMode(int shuffleMode) {
                boolean enabled = shuffleMode == PlaybackStateCompat.SHUFFLE_MODE_ALL
                    || shuffleMode == PlaybackStateCompat.SHUFFLE_MODE_GROUP;
                setShuffleEnabled(enabled);
                emitModeChanged("shuffleChanged", "shuffleEnabled", enabled);
            }

            @Override
            public void onSetRepeatMode(int repeatMode) {
                int exoMode;
                if (repeatMode == PlaybackStateCompat.REPEAT_MODE_ONE) exoMode = Player.REPEAT_MODE_ONE;
                else if (repeatMode == PlaybackStateCompat.REPEAT_MODE_ALL
                    || repeatMode == PlaybackStateCompat.REPEAT_MODE_GROUP) exoMode = Player.REPEAT_MODE_ALL;
                else exoMode = Player.REPEAT_MODE_OFF;
                setRepeatMode(exoMode);
                emitModeChanged("repeatChanged", "repeatMode", repeatModeLabel(exoMode));
            }
        });
        mediaSession.setSessionActivity(
            PendingIntent.getActivity(
                this, 0,
                new Intent(this, MainActivity.class)
                    .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            )
        );
        mediaSession.setActive(true);
        setSessionToken(mediaSession.getSessionToken());
        updatePlaybackState();
    }

    private static String repeatModeLabel(int exoMode) {
        if (exoMode == Player.REPEAT_MODE_ONE) return "one";
        if (exoMode == Player.REPEAT_MODE_ALL) return "all";
        return "off";
    }

    private void emitModeChanged(String event, String key, Object value) {
        if (eventCallback == null) return;
        JSObject payload = new JSObject();
        if (value instanceof Boolean) payload.put(key, (Boolean) value);
        else payload.put(key, String.valueOf(value));
        eventCallback.emit(event, payload);
    }

    /** 把当前播放列表同步到 MediaSession 的队列，Android Auto 的「队列」页面靠它显示。 */
    private void syncSessionQueue() {
        if (mediaSession == null) return;
        List<MediaSessionCompat.QueueItem> queue = new ArrayList<>();
        for (PlaylistItem item : playlist) {
            MediaDescriptionCompat description = new MediaDescriptionCompat.Builder()
                .setMediaId(MEDIA_MUSIC_PREFIX + item.id)
                .setTitle(nonEmpty(item.title, "Untitled"))
                .setSubtitle(nonEmpty(item.album, DEFAULT_ALBUM_LABEL))
                .setIconUri(resolveArtworkUri(item.coverUrl))
                .build();
            queue.add(new MediaSessionCompat.QueueItem(description, item.id));
        }
        try {
            mediaSession.setQueue(queue);
            mediaSession.setQueueTitle(DEFAULT_ALBUM_LABEL);
        } catch (Exception e) {
            Log.w(TAG, "setQueue failed: " + e.getMessage());
        }
    }

    // ── Public API ───────────────────────────────────────────────────────────

    public void setEventCallback(EventCallback callback) { eventCallback = callback; }

    public String getPlaybackDeviceId() { return playbackDeviceId; }

    public String getPlaybackDeviceName() { return playbackDeviceName; }

    public boolean isPausedByRemoteDevice() { return pausedByRemoteDevice; }

    /** JS 端点了「在此设备播放」：先 claim 再继续播。 */
    public void takeOverPlayback() {
        needsClaim = true;
        pausedByRemoteDevice = false;
        sendPlaybackHeartbeat(true);
        resume();
    }

    private void scheduleHeartbeat() {
        mainHandler.removeCallbacks(playbackHeartbeatRunner);
        if (player != null && player.isPlaying()) {
            mainHandler.postDelayed(playbackHeartbeatRunner, PLAYBACK_HEARTBEAT_MS);
        }
    }

    /**
     * 上报心跳（或抢占）。服务端回 is_active=false 说明别的设备正在播：本机暂停并通知 JS 显示横幅。
     * 这是 WebView 被杀后唯一还在工作的同步通道，所以放在原生服务里。
     */
    private void sendPlaybackHeartbeat(boolean claim) {
        if (baseUrl == null || baseUrl.isEmpty() || playbackDeviceId.isEmpty()) return;
        final String baseUrlSnapshot = getEffectiveBaseUrl();
        final int musicId = currentTrackId;
        final long positionMs = player != null ? Math.max(player.getCurrentPosition(), 0L) : 0L;
        final long durationMs = player != null && player.getDuration() > 0 ? player.getDuration() : 0L;
        final boolean playing = player != null && player.isPlaying();
        String cookieSnapshot = null;
        try {
            cookieSnapshot = CookieManager.getInstance().getCookie(baseUrlSnapshot + "/api/music/playback/heartbeat");
        } catch (Exception ignored) {
        }
        final String cookie = cookieSnapshot;
        if (claim) needsClaim = false;
        playbackMetricExecutor.execute(() -> {
            try {
                String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(MusicService.this, baseUrlSnapshot);
                String effectiveCookie = authorizationHeader == null ? cookie : null;
                if (authorizationHeader == null && (effectiveCookie == null || effectiveCookie.isEmpty())) {
                    return; // 未登录：不做设备同步
                }
                JSONObject state = NativeMusicRepository.playbackHeartbeat(
                    baseUrlSnapshot, effectiveCookie, authorizationHeader,
                    playbackDeviceId, playbackDeviceName, musicId, positionMs, durationMs, playing, claim
                );
                if (state == null) return;
                boolean isActive = state.optBoolean("is_active", true);
                String activeName = state.optString("active_device_name", "");
                if (!isActive && !state.optBoolean("stale", false)) {
                    mainHandler.post(() -> {
                        if (player != null && player.isPlaying()) {
                            pausedByRemoteDevice = true;
                            needsClaim = true;
                            player.pause();
                            Log.d(TAG, "Paused: playback taken over by " + activeName);
                        }
                        if (eventCallback != null) {
                            JSObject payload = new JSObject();
                            payload.put("activeDeviceName", activeName);
                            payload.put("activeDeviceId", state.optString("active_device_id", ""));
                            eventCallback.emit("playbackTransferred", payload);
                        }
                    });
                }
            } catch (Exception e) {
                Log.w(TAG, "playback heartbeat failed: " + e.getMessage());
            }
        });
    }

    private void releasePlaybackDevice() {
        if (baseUrl == null || baseUrl.isEmpty() || playbackDeviceId.isEmpty() || needsClaim) return;
        needsClaim = true;
        final String baseUrlSnapshot = getEffectiveBaseUrl();
        String cookieSnapshot = null;
        try {
            cookieSnapshot = CookieManager.getInstance().getCookie(baseUrlSnapshot + "/api/music/playback/release");
        } catch (Exception ignored) {
        }
        final String cookie = cookieSnapshot;
        playbackMetricExecutor.execute(() -> {
            try {
                String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(MusicService.this, baseUrlSnapshot);
                NativeMusicRepository.playbackRelease(baseUrlSnapshot, authorizationHeader == null ? cookie : null, authorizationHeader, playbackDeviceId);
            } catch (Exception e) {
                Log.w(TAG, "playback release failed: " + e.getMessage());
            }
        });
    }

    public void setBaseUrl(String baseUrl) {
        String normalized = NativeMusicRepository.normalizeBaseUrl(baseUrl);
        if (normalized.isEmpty()) {
            return;
        }
        String previous = this.baseUrl;
        this.baseUrl = normalized;
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString(PREF_BASE_URL, normalized)
            .apply();
        if (!normalized.equals(previous)) {
            clearCatalog();
        }
        runOnPlayerThread(this::updatePlaybackMinuteReporting);
    }

    public void setAccompanimentMode(boolean enabled) {
        accompanimentMode = enabled;
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putBoolean(PREF_ACCOMPANIMENT, enabled).apply();
    }

    public boolean isAccompanimentMode() {
        return accompanimentMode;
    }

    public String buildPlaybackUrl(NativeMusicRepository.MusicRecord music) {
        String normalizedBaseUrl = getEffectiveBaseUrl();
        if (accompanimentMode && music.hasAccompaniment) {
            return normalizedBaseUrl + "/api/music/accompaniment/" + music.id;
        }
        return normalizedBaseUrl + "/api/music/download/" + music.id;
    }

    public void setCatalog(
        List<NativeMusicRepository.AlbumRecord> albums,
        List<NativeMusicRepository.MusicRecord> musics
    ) {
        synchronized (catalogLock) {
            catalogAlbums.clear();
            if (albums != null) {
                catalogAlbums.addAll(albums);
            }
            catalogMusics.clear();
            if (musics != null) {
                catalogMusics.addAll(musics);
            }
            catalogLoadedAtMs = System.currentTimeMillis();
        }
        persistCatalogSnapshotAsync(albums, musics);
        notifyCatalogChanged();
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

            String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(MusicService.this);
            String cookieHeader = null;
            if (!items.isEmpty()) {
                cookieHeader = authorizationHeader == null
                    ? CookieManager.getInstance().getCookie(items.get(0).url)
                    : null;
            }

            List<MediaSource> sources = new ArrayList<>();
            for (PlaylistItem item : items) {
                sources.add(buildMediaSource(item.url, cookieHeader, authorizationHeader));
            }

            int safeStart = Math.max(0, Math.min(startIndex, items.size() - 1));
            player.setMediaSources(sources);
            player.setRepeatMode(exoRepeatMode);
            player.setShuffleModeEnabled(shuffleEnabled);
            syncSessionQueue();
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

    /**
     * Swaps playback sources of already-loaded playlist items without reloading the
     * whole playlist. Items other than the one currently playing are replaced in place
     * (remove + add at the same index), which does not disturb the current item.
     * The current item is only re-sourced when its new URL is a local (non-http)
     * source that differs from what is playing, and then the position and
     * play-when-ready state are preserved. Dropping the current item's cached URL
     * (network fallback) never interrupts playback.
     *
     * @param urlById resolved playback URL per track id (missing ids are left untouched)
     */
    public void updatePlaylistSources(Map<Integer, String> urlById) {
        updatePlaylistSources(urlById, false);
    }

    /**
     * @param forceCurrent true 时连正在播放的那一项也换源（例如原唱 / 伴奏切换），
     *                     位置和播放状态保留；false 时当前项只接受本地缓存源。
     */
    public void updatePlaylistSources(Map<Integer, String> urlById, boolean forceCurrent) {
        if (urlById == null || urlById.isEmpty()) return;
        runOnPlayerThread(() -> {
            if (player == null || playlist.isEmpty()) return;
            if (player.getMediaItemCount() != playlist.size()) {
                Log.w(TAG, "updatePlaylistSources skipped: player/playlist size mismatch");
                return;
            }

            String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(MusicService.this);
            String cookieHeader = null;
            int currentIndex = player.getCurrentMediaItemIndex();

            for (int i = 0; i < playlist.size(); i++) {
                PlaylistItem item = playlist.get(i);
                String nextUrl = urlById.get(item.id);
                if (nextUrl == null) continue;
                nextUrl = nextUrl.trim();
                if (nextUrl.isEmpty() || nextUrl.equals(item.url)) continue;

                if (i == currentIndex) {
                    if (isRemoteUrl(nextUrl) && !forceCurrent) {
                        // Never downgrade the playing item to a network stream mid-play.
                        continue;
                    }
                    if (cookieHeader == null && authorizationHeader == null) {
                        cookieHeader = safeGetCookie(nextUrl);
                    }
                    PlaylistItem replacement = new PlaylistItem(item.id, nextUrl, item.title, item.album, item.coverUrl);
                    long positionMs = Math.max(player.getCurrentPosition(), 0L);
                    // Insert the new source right after the current one, seek into it at the
                    // same position (play-when-ready is preserved), then drop the old one.
                    playlist.add(i + 1, replacement);
                    player.addMediaSource(i + 1, buildMediaSource(nextUrl, cookieHeader, authorizationHeader));
                    player.seekTo(i + 1, positionMs);
                    playlist.remove(i);
                    player.removeMediaItem(i);
                    Log.d(TAG, "Re-sourced current track " + item.id + " in place at " + positionMs + "ms");
                    continue;
                }

                if (cookieHeader == null && authorizationHeader == null) {
                    cookieHeader = safeGetCookie(nextUrl);
                }
                PlaylistItem replacement = new PlaylistItem(item.id, nextUrl, item.title, item.album, item.coverUrl);
                playlist.set(i, replacement);
                player.removeMediaItem(i);
                player.addMediaSource(i, buildMediaSource(nextUrl, cookieHeader, authorizationHeader));
                currentIndex = player.getCurrentMediaItemIndex();
            }
        });
    }

    /**
     * Removes a non-current playlist item in place. Returns false (without touching
     * the player) when the item is the one currently playing or is not loaded, in
     * which case the caller should fall back to a full playlist reload.
     */
    public boolean removePlaylistItemById(int trackId) {
        return callOnPlayerThread(() -> {
            if (player == null || playlist.isEmpty() || player.getMediaItemCount() != playlist.size()) {
                return false;
            }
            int currentIndex = player.getCurrentMediaItemIndex();
            for (int i = 0; i < playlist.size(); i++) {
                if (playlist.get(i).id != trackId) continue;
                if (i == currentIndex) return false;
                playlist.remove(i);
                player.removeMediaItem(i);
                syncSessionQueue();
                return true;
            }
            return true;
        }, false);
    }

    private static boolean isRemoteUrl(String url) {
        String lower = url.toLowerCase();
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    private String safeGetCookie(String url) {
        try {
            return CookieManager.getInstance().getCookie(url);
        } catch (Exception e) {
            return null;
        }
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
            updatePlaybackState();
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
            if (player == null) return;
            if (player.getMediaItemCount() == 0) {
                // 车机 / 蓝牙按了播放但还没有列表：从曲库第一首开始播。
                catalogExecutor.execute(() -> {
                    try {
                        ensureCatalogLoaded();
                        NativeMusicRepository.MusicRecord first = null;
                        synchronized (catalogLock) {
                            List<NativeMusicRepository.MusicRecord> sorted =
                                NativeMusicRepository.sortAllSongsByListOrder(catalogMusics);
                            if (!sorted.isEmpty()) first = sorted.get(0);
                        }
                        if (first != null) {
                            loadBrowserSelection(new BrowserSelection(first.id, null), true);
                        }
                    } catch (Exception e) {
                        Log.w(TAG, "resume without playlist failed: " + e.getMessage());
                    }
                });
                return;
            }
            player.play();
            updatePlaybackState();
            updatePlaybackMinuteReporting();
            updateNotification();
        });
    }

    public void stop() {
        runOnPlayerThread(() -> {
            mainHandler.removeCallbacks(playbackHeartbeatRunner);
            releasePlaybackDevice();
            if (player != null) player.stop();
            playlist.clear();
            currentTitle = "";
            currentAlbum = "";
            currentCoverUrl = "";
            currentTrackId = -1;
            recycleBitmap();
            syncSessionQueue();
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

    public long getBufferedPositionMs() {
        return callOnPlayerThread(() -> player == null ? 0L : Math.max(player.getBufferedPosition(), 0L), 0L);
    }

    public boolean isBuffering() {
        return callOnPlayerThread(
            () -> player != null && player.getPlaybackState() == Player.STATE_BUFFERING,
            false
        );
    }

    public boolean isPlayWhenReady() {
        return callOnPlayerThread(() -> player != null && player.getPlayWhenReady(), false);
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
            updatePlaybackState();
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

    // ── Android Auto media browser ───────────────────────────────────────────

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        // 告诉 Android Auto：专辑用网格、歌曲用列表来展示。
        Bundle extras = new Bundle();
        extras.putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true);
        extras.putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", 2);
        extras.putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1);
        return new BrowserRoot(MEDIA_ROOT, extras);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result) {
        result.detach();
        catalogExecutor.execute(() -> {
            List<MediaBrowserCompat.MediaItem> items;
            try {
                try {
                    ensureCatalogLoaded();
                } catch (Exception e) {
                    // 根节点没网也要能显示，用缓存或空目录顶上。
                    if (!MEDIA_ROOT.equals(parentId != null ? parentId : MEDIA_ROOT)) throw e;
                    Log.w(TAG, "Catalog load for root failed: " + e.getMessage());
                }
                items = buildBrowserChildren(parentId);
            } catch (Exception e) {
                Log.w(TAG, "Android Auto catalog load failed: " + e.getMessage());
                items = new ArrayList<>();
            }
            result.sendResult(items);
        });
    }

    private List<MediaBrowserCompat.MediaItem> buildBrowserChildren(String parentId) {
        String nodeId = parentId != null ? parentId : MEDIA_ROOT;
        List<NativeMusicRepository.AlbumRecord> albums;
        List<NativeMusicRepository.MusicRecord> musics;
        synchronized (catalogLock) {
            albums = new ArrayList<>(catalogAlbums);
            musics = new ArrayList<>(catalogMusics);
        }

        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (MEDIA_ROOT.equals(nodeId)) {
            items.add(buildBrowsableMediaItem(MEDIA_ALL, "全部歌曲", musics.size() + " 首", ""));
            items.add(buildBrowsableMediaItem(MEDIA_ALBUMS, "专辑", albums.size() + " 个", ""));
            return items;
        }

        if (MEDIA_ALL.equals(nodeId)) {
            for (NativeMusicRepository.MusicRecord music : NativeMusicRepository.sortAllSongsByListOrder(musics)) {
                items.add(buildPlayableMediaItem(music, null));
            }
            return items;
        }

        if (MEDIA_ALBUMS.equals(nodeId)) {
            for (NativeMusicRepository.AlbumRecord album : albums) {
                int count = countAlbumTracks(musics, album.id);
                items.add(
                    buildBrowsableMediaItem(
                        MEDIA_ALBUM_PREFIX + album.id,
                        nonEmpty(album.name, DEFAULT_ALBUM_LABEL),
                        count + " 首",
                        resolveBrowserCoverUrl(album)
                    )
                );
            }
            return items;
        }

        if (nodeId.startsWith(MEDIA_ALBUM_PREFIX)) {
            Integer albumId = parseIdAfterPrefix(nodeId, MEDIA_ALBUM_PREFIX);
            if (albumId == null) {
                return items;
            }
            for (NativeMusicRepository.MusicRecord music : musics) {
                if (matchesAlbum(music, albumId)) {
                    items.add(buildPlayableMediaItem(music, albumId));
                }
            }
        }
        return items;
    }

    private MediaBrowserCompat.MediaItem buildBrowsableMediaItem(
        String mediaId,
        String title,
        String subtitle,
        String iconUrl
    ) {
        MediaDescriptionCompat.Builder description = new MediaDescriptionCompat.Builder()
            .setMediaId(mediaId)
            .setTitle(nonEmpty(title, DEFAULT_ALBUM_LABEL))
            .setSubtitle(subtitle != null ? subtitle : "");
        description.setIconUri(resolveArtworkUri(iconUrl));
        return new MediaBrowserCompat.MediaItem(
            description.build(),
            MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
        );
    }

    private MediaBrowserCompat.MediaItem buildPlayableMediaItem(
        NativeMusicRepository.MusicRecord music,
        Integer albumContextId
    ) {
        String mediaId = albumContextId != null
            ? MEDIA_ALBUM_TRACK_PREFIX + albumContextId + ":" + music.id
            : MEDIA_MUSIC_PREFIX + music.id;
        MediaDescriptionCompat.Builder description = new MediaDescriptionCompat.Builder()
            .setMediaId(mediaId)
            .setTitle(nonEmpty(music.title, "Untitled"))
            .setSubtitle(resolveMusicAlbumName(music));
        String iconUrl = resolveBrowserCoverUrl(music);
        description.setIconUri(resolveArtworkUri(iconUrl));
        return new MediaBrowserCompat.MediaItem(
            description.build(),
            MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
        );
    }

    private void playFromBrowserMediaId(String mediaId, boolean playWhenReady) {
        BrowserSelection selection = parseBrowserSelection(mediaId);
        if (selection == null) {
            return;
        }
        catalogExecutor.execute(() -> {
            try {
                loadBrowserSelection(selection, playWhenReady);
            } catch (Exception e) {
                Log.w(TAG, "Android Auto play failed: " + e.getMessage());
            }
        });
    }

    private void playFirstSearchResult(String query) {
        catalogExecutor.execute(() -> {
            try {
                ensureCatalogLoaded();
                String normalizedQuery = query != null ? query.trim().toLowerCase() : "";
                NativeMusicRepository.MusicRecord match = null;
                List<NativeMusicRepository.MusicRecord> musics;
                synchronized (catalogLock) {
                    musics = NativeMusicRepository.sortAllSongsByListOrder(catalogMusics);
                }
                for (NativeMusicRepository.MusicRecord music : musics) {
                    if (normalizedQuery.isEmpty()
                        || nonEmpty(music.title, "").toLowerCase().contains(normalizedQuery)
                        || resolveMusicAlbumName(music).toLowerCase().contains(normalizedQuery)) {
                        match = music;
                        break;
                    }
                }
                if (match != null) {
                    loadBrowserSelection(new BrowserSelection(match.id, null), true);
                }
            } catch (Exception e) {
                Log.w(TAG, "Android Auto search failed: " + e.getMessage());
            }
        });
    }

    private void loadBrowserSelection(BrowserSelection selection, boolean playWhenReady) throws Exception {
        ensureCatalogLoaded();
        List<NativeMusicRepository.MusicRecord> musics = new ArrayList<>();
        synchronized (catalogLock) {
            for (NativeMusicRepository.MusicRecord music : catalogMusics) {
                if (selection.albumId == null || matchesAlbum(music, selection.albumId)) {
                    musics.add(music);
                }
            }
            if (musics.isEmpty() && !catalogMusics.isEmpty()) {
                musics.addAll(catalogMusics);
            }
        }
        if (selection.albumId == null) {
            musics = NativeMusicRepository.sortAllSongsByListOrder(musics);
        }

        List<PlaylistItem> items = new ArrayList<>();
        int startIndex = -1;
        for (NativeMusicRepository.MusicRecord music : musics) {
            if (music.id == selection.musicId) {
                startIndex = items.size();
            }
            items.add(buildBrowserPlaylistItem(music));
        }
        if (items.isEmpty() || startIndex < 0) {
            return;
        }
        loadPlaylist(items, startIndex, Player.REPEAT_MODE_OFF, false, 0L, playWhenReady);
    }

    private PlaylistItem buildBrowserPlaylistItem(NativeMusicRepository.MusicRecord music) {
        return new PlaylistItem(
            music.id,
            buildPlaybackUrl(music),
            music.title,
            resolveMusicAlbumName(music),
            resolveBrowserCoverUrl(music)
        );
    }

    private void ensureCatalogLoaded() throws Exception {
        long now = System.currentTimeMillis();
        boolean hasExistingCatalog;
        synchronized (catalogLock) {
            hasExistingCatalog = !catalogMusics.isEmpty();
            if (hasExistingCatalog && now - catalogLoadedAtMs < CATALOG_CACHE_TTL_MS) {
                return;
            }
        }

        String normalizedBaseUrl = getEffectiveBaseUrl();
        String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(this, normalizedBaseUrl);
        String cookie = authorizationHeader == null
            ? getCookieOnMainThread(normalizedBaseUrl + "/api/music/albums")
            : null;
        try {
            NativeMusicRepository.LibraryPayload payload =
                NativeMusicRepository.loadLibrary(normalizedBaseUrl, cookie, authorizationHeader, false);
            setCatalog(payload.albums, payload.musics);
        } catch (Exception e) {
            if (hasExistingCatalog) {
                Log.w(TAG, "Keeping cached Android Auto catalog: " + e.getMessage());
                return;
            }
            throw e;
        }
    }

    private void clearCatalog() {
        synchronized (catalogLock) {
            catalogAlbums.clear();
            catalogMusics.clear();
            catalogLoadedAtMs = 0L;
        }
    }

    private void loadCatalogSnapshot() {
        File file = new File(getFilesDir(), CATALOG_FILE_NAME);
        if (!file.exists()) {
            return;
        }
        try {
            JSONObject root = new JSONObject(readTextFile(file));
            String savedBaseUrl = root.optString("base_url", "");
            if (!savedBaseUrl.trim().isEmpty() && DEFAULT_AUTO_BASE_URL.equals(baseUrl)) {
                baseUrl = NativeMusicRepository.normalizeBaseUrl(savedBaseUrl);
            }

            List<NativeMusicRepository.AlbumRecord> albums = new ArrayList<>();
            Map<Integer, NativeMusicRepository.AlbumRecord> albumById = new HashMap<>();
            JSONArray albumArray = root.optJSONArray("albums");
            if (albumArray != null) {
                for (int i = 0; i < albumArray.length(); i++) {
                    JSONObject item = albumArray.getJSONObject(i);
                    NativeMusicRepository.AlbumRecord album = new NativeMusicRepository.AlbumRecord(
                        item.optInt("id", 0),
                        item.optString("name", ""),
                        item.optString("cover_url", ""),
                        item.optString("image", ""),
                        0.0,
                        item.optString("description", null),
                        item.optString("created_at", null)
                    );
                    albums.add(album);
                    albumById.put(album.id, album);
                }
            }

            List<NativeMusicRepository.MusicRecord> musics = new ArrayList<>();
            JSONArray musicArray = root.optJSONArray("musics");
            if (musicArray != null) {
                for (int i = 0; i < musicArray.length(); i++) {
                    JSONObject item = musicArray.getJSONObject(i);
                    Integer albumId = optNullableInt(item, "album_id");
                    NativeMusicRepository.AlbumRecord album = albumId != null ? albumById.get(albumId) : null;
                    musics.add(new NativeMusicRepository.MusicRecord(
                        item.optInt("id", 0),
                        item.optString("title", ""),
                        albumId,
                        optNullableInt(item, "artist_id"),
                        item.optString("file_name", null),
                        item.optString("file_type", null),
                        optNullableLong(item, "file_size"),
                        optNullableInt(item, "duration"),
                        item.optString("cover_url", ""),
                        item.optDouble("play_minutes", 0.0),
                        item.optString("created_at", null),
                        album,
                        item.optBoolean("has_accompaniment", false)
                    ));
                }
            }

            synchronized (catalogLock) {
                catalogAlbums.clear();
                catalogAlbums.addAll(albums);
                catalogMusics.clear();
                catalogMusics.addAll(musics);
                catalogLoadedAtMs = System.currentTimeMillis();
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to load Android Auto catalog snapshot: " + e.getMessage());
        }
    }

    private void persistCatalogSnapshotAsync(
        List<NativeMusicRepository.AlbumRecord> albums,
        List<NativeMusicRepository.MusicRecord> musics
    ) {
        List<NativeMusicRepository.AlbumRecord> albumSnapshot =
            albums != null ? new ArrayList<>(albums) : new ArrayList<>();
        List<NativeMusicRepository.MusicRecord> musicSnapshot =
            musics != null ? new ArrayList<>(musics) : new ArrayList<>();
        if (albumSnapshot.isEmpty() && musicSnapshot.isEmpty()) {
            return;
        }
        catalogExecutor.execute(() -> {
            try {
                JSONObject root = new JSONObject();
                root.put("base_url", getEffectiveBaseUrl());
                JSONArray albumArray = new JSONArray();
                for (NativeMusicRepository.AlbumRecord album : albumSnapshot) {
                    if (album == null || album.id <= 0) continue;
                    JSONObject item = new JSONObject();
                    item.put("id", album.id);
                    item.put("name", album.name);
                    item.put("cover_url", album.coverUrl);
                    item.put("image", album.image);
                    item.put("description", album.description);
                    item.put("created_at", album.createdAt);
                    albumArray.put(item);
                }
                root.put("albums", albumArray);

                JSONArray musicArray = new JSONArray();
                for (NativeMusicRepository.MusicRecord music : musicSnapshot) {
                    if (music == null || music.id <= 0) continue;
                    JSONObject item = new JSONObject();
                    item.put("id", music.id);
                    item.put("title", music.title);
                    item.put("album_id", music.albumId != null ? music.albumId : JSONObject.NULL);
                    item.put("artist_id", music.artistId != null ? music.artistId : JSONObject.NULL);
                    item.put("file_name", music.fileName);
                    item.put("file_type", music.fileType);
                    item.put("file_size", music.fileSize != null ? music.fileSize : JSONObject.NULL);
                    item.put("duration", music.duration != null ? music.duration : JSONObject.NULL);
                    item.put("cover_url", music.coverUrl);
                    item.put("play_minutes", music.playMinutes);
                    item.put("created_at", music.createdAt);
                    item.put("has_accompaniment", music.hasAccompaniment);
                    musicArray.put(item);
                }
                root.put("musics", musicArray);
                writeTextFile(new File(getFilesDir(), CATALOG_FILE_NAME), root.toString());
            } catch (Exception e) {
                Log.w(TAG, "Failed to save Android Auto catalog snapshot: " + e.getMessage());
            }
        });
    }

    private void notifyCatalogChanged() {
        mainHandler.post(() -> {
            notifyChildrenChanged(MEDIA_ROOT);
            notifyChildrenChanged(MEDIA_ALL);
            notifyChildrenChanged(MEDIA_ALBUMS);
            List<NativeMusicRepository.AlbumRecord> albums;
            synchronized (catalogLock) {
                albums = new ArrayList<>(catalogAlbums);
            }
            for (NativeMusicRepository.AlbumRecord album : albums) {
                if (album != null && album.id > 0) {
                    notifyChildrenChanged(MEDIA_ALBUM_PREFIX + album.id);
                }
            }
        });
    }

    private String readTextFile(File file) throws IOException {
        StringBuilder builder = new StringBuilder();
        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)
            )
        ) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private void writeTextFile(File file, String text) throws IOException {
        try (
            OutputStreamWriter writer = new OutputStreamWriter(
                new FileOutputStream(file, false),
                StandardCharsets.UTF_8
            )
        ) {
            writer.write(text);
        }
    }

    private Integer optNullableInt(JSONObject item, String key) {
        try {
            return item.has(key) && !item.isNull(key) ? item.getInt(key) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private Long optNullableLong(JSONObject item, String key) {
        try {
            return item.has(key) && !item.isNull(key) ? item.getLong(key) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private String getEffectiveBaseUrl() {
        String normalized = NativeMusicRepository.normalizeBaseUrl(baseUrl);
        return normalized.isEmpty() ? DEFAULT_AUTO_BASE_URL : normalized;
    }

    private String getCookieOnMainThread(String url) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try { return CookieManager.getInstance().getCookie(url); } catch (Exception e) { return null; }
        }
        FutureTask<String> task = new FutureTask<>(() -> {
            try { return CookieManager.getInstance().getCookie(url); } catch (Exception e) { return null; }
        });
        mainHandler.post(task);
        try { return task.get(); } catch (Exception e) { return null; }
    }

    private int countAlbumTracks(List<NativeMusicRepository.MusicRecord> musics, int albumId) {
        int count = 0;
        for (NativeMusicRepository.MusicRecord music : musics) {
            if (matchesAlbum(music, albumId)) {
                count += 1;
            }
        }
        return count;
    }

    private boolean matchesAlbum(NativeMusicRepository.MusicRecord music, int albumId) {
        if (music == null) {
            return false;
        }
        if (music.albumId != null && music.albumId == albumId) {
            return true;
        }
        return music.album != null && music.album.id == albumId;
    }

    private String resolveMusicAlbumName(NativeMusicRepository.MusicRecord music) {
        if (music != null && music.album != null && music.album.name != null && !music.album.name.isEmpty()) {
            return music.album.name;
        }
        return DEFAULT_ALBUM_LABEL;
    }

    private String resolveBrowserCoverUrl(NativeMusicRepository.MusicRecord music) {
        if (music != null && music.album != null) {
            String albumCoverUrl = resolveBrowserCoverUrl(music.album);
            if (!albumCoverUrl.isEmpty()) {
                return albumCoverUrl;
            }
        }
        if (music != null && music.coverUrl != null && !music.coverUrl.isEmpty()) {
            return music.coverUrl;
        }
        return getEffectiveBaseUrl() + "/api/music/album_cover/defult.jpeg";
    }

    private String resolveBrowserCoverUrl(NativeMusicRepository.AlbumRecord album) {
        if (album != null && album.image != null && !album.image.isEmpty()) {
            return album.image;
        }
        if (album != null && album.coverUrl != null && !album.coverUrl.isEmpty()) {
            return album.coverUrl;
        }
        return "";
    }

    private Uri resolveArtworkUri(String remoteUrl) {
        return AlbumArtProvider.buildArtworkUri(this, remoteUrl);
    }

    private BrowserSelection parseBrowserSelection(String mediaId) {
        if (mediaId == null) {
            return null;
        }
        if (mediaId.startsWith(MEDIA_MUSIC_PREFIX)) {
            Integer musicId = parseIdAfterPrefix(mediaId, MEDIA_MUSIC_PREFIX);
            return musicId != null ? new BrowserSelection(musicId, null) : null;
        }
        if (mediaId.startsWith(MEDIA_ALBUM_TRACK_PREFIX)) {
            String suffix = mediaId.substring(MEDIA_ALBUM_TRACK_PREFIX.length());
            String[] parts = suffix.split(":", 2);
            if (parts.length != 2) {
                return null;
            }
            try {
                return new BrowserSelection(Integer.parseInt(parts[1]), Integer.parseInt(parts[0]));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private Integer parseIdAfterPrefix(String value, String prefix) {
        try {
            return Integer.parseInt(value.substring(prefix.length()));
        } catch (Exception e) {
            return null;
        }
    }

    private String nonEmpty(String value, String fallback) {
        return value != null && !value.trim().isEmpty() ? value : fallback;
    }

    private static class BrowserSelection {
        final int musicId;
        final Integer albumId;

        BrowserSelection(int musicId, Integer albumId) {
            this.musicId = musicId;
            this.albumId = albumId;
        }
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

        if (currentCoverUrl != null && !currentCoverUrl.isEmpty()) {
            String artworkUri = resolveArtworkUri(currentCoverUrl).toString();
            meta.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, artworkUri)
                .putString(MediaMetadataCompat.METADATA_KEY_ART_URI, artworkUri)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, artworkUri);
        }

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

        final String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(this);
        final String cookie = authorizationHeader == null ? CookieManager.getInstance().getCookie(coverUrl) : null;

        coverFetchExecutor.execute(() -> {
            Bitmap bitmap = downloadAndScaleBitmap(coverUrl, cookie, authorizationHeader);
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
     * @param authorizationHeader Mobile token header, preferred when available.
     */
    private Bitmap downloadAndScaleBitmap(String coverUrl, String cookie, String authorizationHeader) {
        HttpURLConnection conn = null;
        InputStream in = null;
        try {
            URL url = new URL(coverUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(15_000);
            conn.setRequestProperty("Accept", "image/*");
            if (authorizationHeader != null && !authorizationHeader.isEmpty()) {
                conn.setRequestProperty("Authorization", authorizationHeader);
            } else if (cookie != null && !cookie.isEmpty()) {
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

    private ProgressiveMediaSource buildMediaSource(String url, String cookieHeader, String authorizationHeader) {
        DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true);

        String cookie = authorizationHeader == null
            ? (cookieHeader != null ? cookieHeader : CookieManager.getInstance().getCookie(url))
            : null;
        if (authorizationHeader != null && !authorizationHeader.isEmpty()) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Authorization", authorizationHeader);
            httpFactory.setDefaultRequestProperties(headers);
        } else if (cookie != null && !cookie.isEmpty()) {
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
            PlaybackStateCompat.ACTION_STOP |
            PlaybackStateCompat.ACTION_PREPARE_FROM_MEDIA_ID |
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID |
            PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH |
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
            PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM |
            PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE |
            PlaybackStateCompat.ACTION_SET_REPEAT_MODE |
            PlaybackStateCompat.ACTION_SEEK_TO;

        int playbackState = player.getPlaybackState();
        int state;
        if (player.isPlaying()) state = PlaybackStateCompat.STATE_PLAYING;
        else if (playbackState == Player.STATE_BUFFERING && player.getPlayWhenReady()) state = PlaybackStateCompat.STATE_BUFFERING;
        else if (playbackState == Player.STATE_ENDED) state = PlaybackStateCompat.STATE_STOPPED;
        else if (playbackState == Player.STATE_IDLE && player.getMediaItemCount() == 0) state = PlaybackStateCompat.STATE_STOPPED;
        else state = PlaybackStateCompat.STATE_PAUSED;

        PlaybackStateCompat.Builder builder = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, getPositionMs(), player.isPlaying() ? 1.0f : 0.0f);
        if (currentTrackId > 0) {
            builder.setActiveQueueItemId(currentTrackId);
        }
        mediaSession.setPlaybackState(builder.build());
        mediaSession.setShuffleMode(
            player.getShuffleModeEnabled() ? PlaybackStateCompat.SHUFFLE_MODE_ALL : PlaybackStateCompat.SHUFFLE_MODE_NONE
        );
        int repeat = player.getRepeatMode();
        mediaSession.setRepeatMode(
            repeat == Player.REPEAT_MODE_ONE ? PlaybackStateCompat.REPEAT_MODE_ONE
                : repeat == Player.REPEAT_MODE_ALL ? PlaybackStateCompat.REPEAT_MODE_ALL
                : PlaybackStateCompat.REPEAT_MODE_NONE
        );
    }

    private void ensureForeground() {
        promoteNotification(buildFallbackNotification());
    }

    /**
     * Re-syncs the listening-minute accumulator with the current player state.
     * Safe to call on every state change: it folds the elapsed time of the running
     * segment into the accumulator and (re)starts a segment only while actually playing.
     */
    private void updatePlaybackMinuteReporting() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(this::updatePlaybackMinuteReporting);
            return;
        }
        foldPlaybackSegment();
        reportAccumulatedMinutes();
        schedulePlaybackMinuteTick();
    }

    private boolean isAccumulatingPlayback() {
        return player != null && player.isPlaying() && currentTrackId > 0 && baseUrl != null && !baseUrl.isEmpty();
    }

    /** Adds the running segment (if any) to the accumulator and closes it. */
    private void foldPlaybackSegment() {
        if (playbackSegmentStartMs >= 0) {
            long elapsed = SystemClock.elapsedRealtime() - playbackSegmentStartMs;
            if (elapsed > 0) {
                playbackAccumulatedMs += elapsed;
            }
            playbackSegmentStartMs = -1L;
        }
    }

    /** Reports one add_one_minute per full minute accumulated, keeping the remainder. */
    private void reportAccumulatedMinutes() {
        if (currentTrackId <= 0) {
            return;
        }
        while (playbackAccumulatedMs >= MINUTE_MS) {
            playbackAccumulatedMs -= MINUTE_MS;
            reportOneMinute(currentTrackId);
        }
    }

    /** Opens a new segment if playing and schedules the next tick when the minute fills. */
    private void schedulePlaybackMinuteTick() {
        mainHandler.removeCallbacks(playbackMinuteReporter);
        if (!isAccumulatingPlayback()) {
            return;
        }
        playbackSegmentStartMs = SystemClock.elapsedRealtime();
        long delay = Math.max(MINUTE_MS - playbackAccumulatedMs, 250L);
        mainHandler.postDelayed(playbackMinuteReporter, delay);
    }

    private void reportOneMinute(int musicId) {
        final String baseUrlSnapshot = getEffectiveBaseUrl();
        final String targetUrl = baseUrlSnapshot + "/api/music/add_one_minute/" + musicId;
        String cookieSnapshot = null;
        try {
            cookieSnapshot = CookieManager.getInstance().getCookie(targetUrl);
        } catch (Exception ignored) {
        }
        final String cookie = cookieSnapshot;
        playbackMetricExecutor.execute(() -> {
            try {
                String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(MusicService.this, baseUrlSnapshot);
                String effectiveCookie = authorizationHeader == null ? cookie : null;
                NativeMusicRepository.addOneMinute(baseUrlSnapshot, effectiveCookie, authorizationHeader, musicId);
                Log.d(TAG, "addOneMinute reported for musicId=" + musicId);
            } catch (Exception e) {
                Log.w(TAG, "addOneMinute failed: " + e.getMessage());
            }
        });
    }

    private void promoteNotification(Notification notification) {
        try {
            boolean playing = player != null && (player.isPlaying()
                || (player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_BUFFERING));
            if (playing || !isForeground) {
                if (!isForeground) {
                    startForeground(NOTIFICATION_ID, notification);
                    isForeground = true;
                } else {
                    notificationManager.notify(NOTIFICATION_ID, notification);
                }
                if (!playing && player != null && player.getMediaItemCount() > 0) {
                    // 已暂停：退出前台但保留通知，让用户可以划掉它。
                    detachForeground();
                }
                return;
            }
            // 暂停状态下不再是前台服务，只更新通知内容。
            notificationManager.notify(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            Log.e(TAG, "Failed to promote notification", e);
        }
    }

    private void detachForeground() {
        if (!isForeground) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(false);
            }
        } catch (Exception e) {
            Log.w(TAG, "stopForeground(detach) failed: " + e.getMessage());
        }
        isForeground = false;
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
