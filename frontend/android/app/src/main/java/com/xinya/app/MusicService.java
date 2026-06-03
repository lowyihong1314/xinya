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
import com.google.android.exoplayer2.source.ConcatenatingMediaSource;
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

    // Album art cache — keeps last downloaded bitmap + its URL.
    private Bitmap currentArtBitmap = null;
    private String lastFetchedCoverUrl = null;
    private final ExecutorService coverFetchExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService catalogExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService playbackMetricExecutor = Executors.newSingleThreadExecutor();
    private final Runnable playbackMinuteReporter = new Runnable() {
        @Override
        public void run() {
            if (player == null || !player.isPlaying() || currentTrackId <= 0 || baseUrl == null || baseUrl.isEmpty()) {
                return;
            }
            final int musicId = currentTrackId;
            final String targetUrl = NativeMusicRepository.normalizeBaseUrl(baseUrl) + "/api/music/add_one_minute/" + musicId;
            final String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(MusicService.this);
            final String cookie = authorizationHeader == null ? CookieManager.getInstance().getCookie(targetUrl) : null;
            playbackMetricExecutor.execute(() -> {
                try {
                    NativeMusicRepository.addOneMinute(baseUrl, cookie, authorizationHeader, musicId);
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
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        baseUrl = NativeMusicRepository.normalizeBaseUrl(
            prefs.getString(PREF_BASE_URL, DEFAULT_AUTO_BASE_URL)
        );
        loadCatalogSnapshot();
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
        });
        mediaSession.setActive(true);
        setSessionToken(mediaSession.getSessionToken());
        updatePlaybackState();
    }

    // ── Public API ───────────────────────────────────────────────────────────

    public void setEventCallback(EventCallback callback) { eventCallback = callback; }

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

            ConcatenatingMediaSource concat = new ConcatenatingMediaSource();
            for (PlaylistItem item : items) {
                concat.addMediaSource(buildMediaSource(item.url, cookieHeader, authorizationHeader));
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
        return new BrowserRoot(MEDIA_ROOT, null);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result) {
        result.detach();
        catalogExecutor.execute(() -> {
            List<MediaBrowserCompat.MediaItem> items;
            try {
                String nodeId = parentId != null ? parentId : MEDIA_ROOT;
                if (!MEDIA_ROOT.equals(nodeId)) {
                    ensureCatalogLoaded();
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
        String normalizedBaseUrl = getEffectiveBaseUrl();
        return new PlaylistItem(
            music.id,
            normalizedBaseUrl + "/api/music/download/" + music.id,
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
        String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(this);
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
                        album
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
            PlaybackStateCompat.ACTION_PREPARE_FROM_MEDIA_ID |
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID |
            PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH |
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
