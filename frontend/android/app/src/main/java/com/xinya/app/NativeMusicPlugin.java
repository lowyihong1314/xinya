package com.xinya.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.exoplayer2.Player;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeMusic")
public class NativeMusicPlugin extends Plugin {

    private static final String TAG = "NativeMusicPlugin";
    private static final String DEFAULT_ALBUM_LABEL = "全部歌曲";

    private MusicService musicService;
    private boolean bound = false;
    private boolean binding = false;
    private boolean startedForPlayback = false;
    private final List<Runnable> pendingActions = new ArrayList<>();
    private final ExecutorService backgroundExecutor = Executors.newSingleThreadExecutor();
    private final Object stateLock = new Object();

    private String baseUrl = "";
    private final List<NativeMusicRepository.AlbumRecord> albums = new ArrayList<>();
    private final List<NativeMusicRepository.MusicRecord> musics = new ArrayList<>();
    private final Map<Integer, NativeMusicRepository.MusicRecord> musicById = new LinkedHashMap<>();
    private final List<Integer> queueIds = new ArrayList<>();
    private final Map<Integer, String> cachedTrackUrls = new LinkedHashMap<>();
    private Integer storedCurrentMusicId = null;
    private String repeatMode = "off";
    private boolean shuffleEnabled = false;
    /** 伴奏模式（与 MusicService 同步，持久化在服务的 SharedPreferences 里）。 */
    private boolean accompanimentMode = false;
    private final List<NativeMusicRepository.ListeningSessionRecord> listeningSessions = new ArrayList<>();
    private String listeningTimezone = NativeMusicRepository.DEFAULT_TIMEZONE;
    private int listeningTotalMinutes = 0;
    private int listeningUniqueListeners = 0;
    /**
     * Monotonic version of the "structural" state (library, queue, current track,
     * shuffle/repeat). Carried in getProgress()/getSnapshot() and in the
     * "snapshotChanged" event so the JS side only pulls the full snapshot when
     * something other than playback position actually changed.
     */
    private long stateVersion = 0L;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            MusicService.MusicBinder binder = (MusicService.MusicBinder) service;
            musicService = binder.getService();
            bound = true;
            binding = false;
            syncServiceBaseUrl();
            synchronized (stateLock) {
                accompanimentMode = musicService.isAccompanimentMode();
            }
            pushCatalogToService();
            musicService.setEventCallback((event, data) -> runOnMainThread(() -> {
                boolean currentChanged = false;
                if (musicService != null) {
                    int currentTrackId = musicService.getCurrentTrackId();
                    synchronized (stateLock) {
                        if (currentTrackId > 0 && musicById.containsKey(currentTrackId)) {
                            Integer previous = storedCurrentMusicId;
                            storedCurrentMusicId = currentTrackId;
                            currentChanged = previous == null || previous != currentTrackId;
                        }
                    }
                }
                if ("shuffleChanged".equals(event)) {
                    synchronized (stateLock) {
                        shuffleEnabled = data.optBoolean("shuffleEnabled", shuffleEnabled);
                    }
                    emitSnapshotChanged("shuffle");
                    return;
                }
                if ("repeatChanged".equals(event)) {
                    synchronized (stateLock) {
                        repeatMode = data.optString("repeatMode", repeatMode);
                    }
                    emitSnapshotChanged("repeat");
                    return;
                }
                notifyListeners(event, data);
                if ("trackChanged".equals(event) || currentChanged) {
                    emitSnapshotChanged("trackChanged");
                }
            }));
            flushPendingActions();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            bound = false;
            binding = false;
            musicService = null;
        }
    };

    @Override
    public void load() {
        ensureServiceBinding(false);
    }

    @Override
    protected void handleOnDestroy() {
        if (musicService != null) {
            musicService.setEventCallback(null);
        }
        if (bound) {
            try {
                getContext().unbindService(connection);
            } catch (IllegalArgumentException ignored) {
            }
        }
        bound = false;
        binding = false;
        startedForPlayback = false;
        musicService = null;
        pendingActions.clear();
        backgroundExecutor.shutdown();
    }

    @PluginMethod
    public void ready(PluginCall call) {
        String requestedBaseUrl = call.getString("baseUrl", "");
        if (requestedBaseUrl != null && !requestedBaseUrl.trim().isEmpty()) {
            setBaseUrlValue(requestedBaseUrl);
        }
        if (!runWhenServiceReady(false, () -> resolve(call))) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void bootstrap(PluginCall call) {
        String requestedBaseUrl = call.getString("baseUrl", "");
        boolean includeListening = call.getBoolean("includeListening", false);
        if (requestedBaseUrl == null || requestedBaseUrl.trim().isEmpty()) {
            call.reject("baseUrl is required");
            return;
        }

        backgroundExecutor.execute(() -> {
            try {
                setBaseUrlValue(requestedBaseUrl);
                ensureServiceBinding(false);
                refreshLibraryState(includeListening, true);
                resolve(call, buildSnapshot());
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    @PluginMethod
    public void refreshLibrary(PluginCall call) {
        boolean includeListening = call.getBoolean("includeListening", !listeningSessions.isEmpty());
        backgroundExecutor.execute(() -> {
            try {
                refreshLibraryState(includeListening, false);
                resolve(call, buildSnapshot());
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    @PluginMethod
    public void getSnapshot(PluginCall call) {
        if (!ensureServiceBinding(false)) {
            call.reject("Native music service is unavailable");
            return;
        }
        resolve(call, buildSnapshot());
    }

    @PluginMethod
    public void setCachedTrackSources(PluginCall call) {
        JSArray items = call.getArray("items");
        Map<Integer, String> nextCachedTrackUrls = new LinkedHashMap<>();

        if (items != null) {
            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.optJSONObject(index);
                if (item == null) continue;
                int trackId = item.optInt("id", -1);
                String url = item.optString("url", "").trim();
                if (trackId > 0 && !url.isEmpty()) {
                    nextCachedTrackUrls.put(trackId, url);
                }
            }
        }

        synchronized (stateLock) {
            cachedTrackUrls.clear();
            cachedTrackUrls.putAll(nextCachedTrackUrls);
        }

        // Only swap the sources of loaded items in place; the service decides whether
        // the currently playing item needs a (position-preserving) re-source at all.
        syncTrackSourcesToService();
        resolve(call);
    }

    @PluginMethod
    public void playMusic(PluginCall call) {
        Integer musicId = call.getInt("musicId");
        JSArray queue = call.getArray("queueIds");
        if (musicId == null) {
            call.reject("musicId is required");
            return;
        }

        synchronized (stateLock) {
            List<Integer> requestedQueueIds = normalizeQueueIds(queue);
            queueIds.clear();
            if (requestedQueueIds.isEmpty()) {
                queueIds.add(musicId);
            } else {
                queueIds.addAll(requestedQueueIds);
                if (!queueIds.contains(musicId)) {
                    queueIds.add(0, musicId);
                }
            }
            storedCurrentMusicId = musicId;
        }

        try {
            loadPlaylistOnService(musicId, 0L, true);
            persistQueueStateAsync();
            emitSnapshotChanged("queue");
            resolve(call, buildSnapshot(musicId));
        } catch (Exception e) {
            reject(call, e);
        }
    }

    @PluginMethod
    public void togglePlayback(PluginCall call) {
        if (!ensureServiceBinding(true)) {
            call.reject("Native music service is unavailable");
            return;
        }

        try {
            if (musicService != null && musicService.isPlaying()) {
                musicService.pause();
                resolve(call, buildSnapshot());
                return;
            }

            boolean resumable = musicService != null && musicService.getDurationMs() > 0 && musicService.getCurrentTrackId() > 0;
            if (resumable) {
                musicService.resume();
                resolve(call, buildSnapshot());
                return;
            }

            synchronized (stateLock) {
                if (storedCurrentMusicId == null && !queueIds.isEmpty()) {
                    storedCurrentMusicId = queueIds.get(0);
                }
            }
            loadPlaylistOnService(0L, true);
            persistQueueStateAsync();
            emitSnapshotChanged("queue");
            resolve(call, buildSnapshot());
        } catch (Exception e) {
            reject(call, e);
        }
    }

    @PluginMethod
    public void appendToQueue(PluginCall call) {
        Integer musicId = call.getInt("musicId");
        if (musicId == null) {
            call.reject("musicId is required");
            return;
        }

        synchronized (stateLock) {
            if (!musicById.containsKey(musicId)) {
                call.reject("musicId does not exist");
                return;
            }
            if (!queueIds.contains(musicId)) {
                queueIds.add(musicId);
            }
            storedCurrentMusicId = queueIds.isEmpty() ? null : queueIds.get(0);
        }

        try {
            Integer nextCurrentMusicId;
            synchronized (stateLock) {
                nextCurrentMusicId = storedCurrentMusicId;
            }
            loadPlaylistOnService(nextCurrentMusicId, 0L, true);
            persistQueueStateAsync();
            emitSnapshotChanged("queue");
            resolve(call, buildSnapshot(nextCurrentMusicId));
        } catch (Exception e) {
            reject(call, e);
        }
    }

    @PluginMethod
    public void removeFromQueue(PluginCall call) {
        Integer musicId = call.getInt("musicId");
        if (musicId == null) {
            call.reject("musicId is required");
            return;
        }

        boolean removedCurrent;
        synchronized (stateLock) {
            queueIds.removeIf(id -> id == musicId);
            removedCurrent = storedCurrentMusicId != null && storedCurrentMusicId == musicId;
            if (queueIds.isEmpty()) {
                storedCurrentMusicId = null;
            } else if (removedCurrent) {
                storedCurrentMusicId = queueIds.get(0);
            }
        }

        if (isQueueEmpty()) {
            stopServicePlayback();
        } else {
            // Removing a non-current item is done in place; only fall back to a full
            // (position-preserving) reload when the playing item itself was removed.
            boolean removedInPlace = !removedCurrent
                && ensureServiceBinding(false)
                && musicService != null
                && musicService.getCurrentTrackId() > 0
                && musicService.removePlaylistItemById(musicId);
            if (!removedInPlace) {
                syncPlaylistPreservingState();
            }
        }
        persistQueueStateAsync();
        emitSnapshotChanged("queue");
        resolve(call, buildSnapshot());
    }

    @PluginMethod
    public void clearQueue(PluginCall call) {
        synchronized (stateLock) {
            queueIds.clear();
            storedCurrentMusicId = null;
        }
        stopServicePlayback();
        persistQueueStateAsync();
        emitSnapshotChanged("queue");
        resolve(call, buildSnapshot());
    }

    @PluginMethod
    public void playFromQueue(PluginCall call) {
        Integer musicId = call.getInt("musicId");
        if (musicId == null) {
            call.reject("musicId is required");
            return;
        }

        synchronized (stateLock) {
            if (!queueIds.contains(musicId)) {
                call.reject("musicId is not in queue");
                return;
            }
            storedCurrentMusicId = musicId;
        }

        try {
            loadPlaylistOnService(musicId, 0L, true);
            persistQueueStateAsync();
            emitSnapshotChanged("queue");
            resolve(call, buildSnapshot(musicId));
        } catch (Exception e) {
            reject(call, e);
        }
    }

    @PluginMethod
    public void playRelative(PluginCall call) {
        Integer step = call.getInt("step");
        if (step == null || (step != -1 && step != 1)) {
            call.reject("step must be -1 or 1");
            return;
        }
        if (!ensureServiceBinding(true) || musicService == null) {
            call.reject("Native music service is unavailable");
            return;
        }

        if (step < 0) {
            musicService.skipToPrevious();
        } else {
            musicService.skipToNext();
        }
        resolve(call, buildSnapshot());
    }

    @PluginMethod
    public void toggleShuffle(PluginCall call) {
        synchronized (stateLock) {
            shuffleEnabled = !shuffleEnabled;
        }
        if (runWhenServiceReady(false, () -> {
            if (musicService != null) {
                musicService.setShuffleEnabled(isShuffleEnabledLocked());
            }
        })) {
            emitSnapshotChanged("shuffle");
            resolve(call, buildSnapshot());
            return;
        }
        call.reject("Native music service is unavailable");
    }

    @PluginMethod
    public void takeOverPlayback(PluginCall call) {
        if (!runWhenServiceReady(true, () -> {
            if (musicService != null) musicService.takeOverPlayback();
            resolve(call, buildSnapshot());
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void toggleAccompanimentMode(PluginCall call) {
        boolean next;
        synchronized (stateLock) {
            next = !accompanimentMode;
        }
        applyAccompanimentMode(call, next);
    }

    @PluginMethod
    public void setAccompanimentMode(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required");
            return;
        }
        applyAccompanimentMode(call, enabled);
    }

    /** 切换伴奏模式后，把队列里每首歌的源换成对应版本；当前曲原位换源并保留进度。 */
    private void applyAccompanimentMode(PluginCall call, boolean enabled) {
        Map<Integer, String> urlById = new LinkedHashMap<>();
        synchronized (stateLock) {
            accompanimentMode = enabled;
            for (Integer queueId : queueIds) {
                NativeMusicRepository.MusicRecord music = musicById.get(queueId);
                if (music != null) {
                    urlById.put(music.id, resolvePlaybackUrlLocked(music));
                }
            }
        }
        if (!runWhenServiceReady(false, () -> {
            if (musicService == null) return;
            musicService.setAccompanimentMode(enabled);
            if (!urlById.isEmpty()) {
                musicService.updatePlaylistSources(urlById, true);
            }
        })) {
            call.reject("Native music service is unavailable");
            return;
        }
        emitSnapshotChanged("accompaniment");
        resolve(call, buildSnapshot());
    }

    @PluginMethod
    public void cycleRepeat(PluginCall call) {
        String nextMode;
        synchronized (stateLock) {
            if ("off".equals(repeatMode)) nextMode = "all";
            else if ("all".equals(repeatMode)) nextMode = "one";
            else nextMode = "off";
            repeatMode = nextMode;
        }
        if (runWhenServiceReady(false, () -> {
            if (musicService != null) {
                musicService.setRepeatMode(toExoRepeat(nextMode));
            }
        })) {
            emitSnapshotChanged("repeat");
            resolve(call, buildSnapshot());
            return;
        }
        call.reject("Native music service is unavailable");
    }

    @PluginMethod
    public void setPlaylist(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        Integer startIndex = call.getInt("startIndex", 0);
        String requestedRepeatMode = call.getString("repeatMode", "off");
        if (tracks == null || tracks.length() == 0) {
            call.reject("tracks array is required");
            return;
        }

        List<MusicService.PlaylistItem> items = new ArrayList<>();
        try {
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject data = tracks.getJSONObject(i);
                items.add(
                    new MusicService.PlaylistItem(
                        data.optInt("id", -1),
                        data.optString("url", ""),
                        data.optString("title", ""),
                        data.optString("album", DEFAULT_ALBUM_LABEL),
                        data.optString("coverUrl", "")
                    )
                );
            }
        } catch (Exception e) {
            call.reject("Failed to parse tracks: " + e.getMessage());
            return;
        }

        synchronized (stateLock) {
            repeatMode = requestedRepeatMode;
        }

        if (!runWhenServiceReady(true, () -> {
            musicService.setBaseUrl(baseUrl);
            musicService.setPlaylist(items, startIndex, toExoRepeat(requestedRepeatMode));
            resolve(call);
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        String title = call.getString("title", "");
        String album = call.getString("album", DEFAULT_ALBUM_LABEL);
        String coverUrl = call.getString("coverUrl", "");

        if (!runWhenServiceReady(true, () -> {
            musicService.setBaseUrl(baseUrl);
            musicService.play(url, title, album, coverUrl);
            resolve(call);
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void skipToIndex(PluginCall call) {
        Integer index = call.getInt("index");
        if (index == null) {
            call.reject("index is required");
            return;
        }
        if (!runWhenServiceReady(false, () -> {
            musicService.skipToIndex(index);
            resolve(call, buildSnapshot());
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        String mode = call.getString("mode", "off");
        synchronized (stateLock) {
            repeatMode = mode;
        }
        if (!runWhenServiceReady(false, () -> {
            musicService.setRepeatMode(toExoRepeat(mode));
            emitSnapshotChanged("repeat");
            resolve(call, buildSnapshot());
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (!runWhenServiceReady(false, () -> {
            musicService.pause();
            resolve(call, buildSnapshot());
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (!runWhenServiceReady(false, () -> {
            musicService.resume();
            resolve(call, buildSnapshot());
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double positionMs = call.getDouble("positionMs");
        if (positionMs == null) {
            call.reject("positionMs is required");
            return;
        }
        if (!runWhenServiceReady(false, () -> {
            musicService.seekTo(Math.round(positionMs));
            resolve(call, buildSnapshot());
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    /**
     * Lightweight progress payload for high-frequency polling. Contains scalars only
     * (no library / queue arrays); {@code stateVersion} tells the caller whether a
     * full {@link #getSnapshot} is needed.
     */
    @PluginMethod
    public void getProgress(PluginCall call) {
        if (!runWhenServiceReady(false, () -> resolve(call, buildProgress()))) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopServicePlayback();
        emitSnapshotChanged("stop");
        resolve(call, buildSnapshot());
    }

    private void refreshLibraryState(boolean includeListening, boolean restoreQueue) throws Exception {
        String baseUrlSnapshot;
        synchronized (stateLock) {
            baseUrlSnapshot = baseUrl;
        }
        if (baseUrlSnapshot == null || baseUrlSnapshot.isEmpty()) {
            throw new IllegalStateException("baseUrl is required before loading native music data");
        }

        String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(getContext(), baseUrlSnapshot);
        String cookie = authorizationHeader == null ? getCookie(baseUrlSnapshot + "/api/music/albums") : null;
        NativeMusicRepository.LibraryPayload payload =
            NativeMusicRepository.loadLibrary(baseUrlSnapshot, cookie, authorizationHeader, includeListening);

        synchronized (stateLock) {
            albums.clear();
            albums.addAll(payload.albums);
            musics.clear();
            musics.addAll(payload.musics);
            musicById.clear();
            for (NativeMusicRepository.MusicRecord music : payload.musics) {
                musicById.put(music.id, music);
            }
            listeningSessions.clear();
            listeningSessions.addAll(payload.listeningSessions);
            listeningTimezone = payload.listeningTimezone;
            listeningTotalMinutes = payload.listeningTotalMinutes;
            listeningUniqueListeners = payload.listeningUniqueListeners;

            if (restoreQueue) {
                NativeMusicRepository.QueuePayload queuePayload =
                    NativeMusicRepository.loadQueueState(baseUrlSnapshot, cookie, authorizationHeader, payload.musics);
                queueIds.clear();
                queueIds.addAll(normalizeQueueIds(queuePayload.queueIds));
                storedCurrentMusicId =
                    queuePayload.currentMusicId != null && musicById.containsKey(queuePayload.currentMusicId)
                        ? queuePayload.currentMusicId
                        : (!queueIds.isEmpty() ? queueIds.get(0) : null);
            } else {
                List<Integer> nextQueueIds = normalizeQueueIds(new ArrayList<>(queueIds));
                queueIds.clear();
                queueIds.addAll(nextQueueIds);
                if (storedCurrentMusicId != null && !musicById.containsKey(storedCurrentMusicId)) {
                    storedCurrentMusicId = queueIds.isEmpty() ? null : queueIds.get(0);
                }
            }
        }
        pushCatalogToService();
        emitSnapshotChanged("library");
    }

    private JSObject buildSnapshot() {
        return buildSnapshot(null);
    }

    private JSObject buildSnapshot(Integer preferredCurrentMusicId) {
        JSArray albumsArray = new JSArray();
        JSArray musicsArray = new JSArray();
        JSArray queueArray = new JSArray();
        JSArray listeningArray = new JSArray();

        NativeMusicRepository.MusicRecord currentMusic = null;
        Integer currentMusicId;
        boolean hasPlaybackSession;
        boolean shuffleEnabledSnapshot;
        String repeatModeSnapshot;
        int totalMinutes;
        int uniqueListeners;
        String timezone;

        synchronized (stateLock) {
            for (NativeMusicRepository.AlbumRecord album : albums) {
                albumsArray.put(album.toJSObject());
            }
            for (NativeMusicRepository.MusicRecord music : musics) {
                musicsArray.put(music.toJSObject());
            }
            currentMusicId = resolveCurrentMusicIdLocked(preferredCurrentMusicId);
            for (Integer queueId : queueIds) {
                NativeMusicRepository.MusicRecord music = musicById.get(queueId);
                if (music != null) {
                    queueArray.put(music.toJSObject());
                }
            }
            for (NativeMusicRepository.ListeningSessionRecord session : listeningSessions) {
                listeningArray.put(session.toJSObject());
            }
            currentMusic = currentMusicId != null ? musicById.get(currentMusicId) : null;
            hasPlaybackSession = currentMusicId != null && !queueIds.isEmpty();
            shuffleEnabledSnapshot = shuffleEnabled;
            repeatModeSnapshot = repeatMode;
            totalMinutes = listeningTotalMinutes;
            uniqueListeners = listeningUniqueListeners;
            timezone = listeningTimezone;
        }

        long positionMs = 0L;
        long durationMs = 0L;
        long bufferedMs = 0L;
        boolean isPlaying = false;
        boolean isBuffering = false;
        if (musicService != null) {
            positionMs = musicService.getPositionMs();
            durationMs = musicService.getDurationMs();
            bufferedMs = musicService.getBufferedPositionMs();
            isPlaying = musicService.isPlaying();
            isBuffering = musicService.isBuffering();
        }

        JSObject snapshot = new JSObject();
        snapshot.put("stateVersion", getStateVersion());
        snapshot.put("bufferedMs", bufferedMs);
        snapshot.put("isBuffering", isBuffering);
        snapshot.put("albums", albumsArray);
        snapshot.put("musics", musicsArray);
        snapshot.put("queue", queueArray);
        snapshot.put("currentMusic", currentMusic != null ? currentMusic.toJSObject() : null);
        snapshot.put("currentMusicId", currentMusicId);
        snapshot.put("isPlaying", isPlaying);
        snapshot.put("hasPlaybackSession", hasPlaybackSession);
        snapshot.put("shuffleEnabled", shuffleEnabledSnapshot);
        snapshot.put("repeatMode", repeatModeSnapshot);
        snapshot.put("accompanimentMode", isAccompanimentModeLocked());
        snapshot.put("deviceId", musicService != null ? musicService.getPlaybackDeviceId() : "");
        snapshot.put("deviceName", musicService != null ? musicService.getPlaybackDeviceName() : "");
        snapshot.put("pausedByRemoteDevice", musicService != null && musicService.isPausedByRemoteDevice());
        snapshot.put("progressMs", positionMs);
        snapshot.put("durationMs", durationMs);
        snapshot.put("listeningTimezone", timezone);
        snapshot.put("listeningSessions", listeningArray);
        snapshot.put("listeningTotalMinutes", totalMinutes);
        snapshot.put("listeningUniqueListeners", uniqueListeners);
        return snapshot;
    }

    private JSObject buildProgress() {
        Integer currentMusicId;
        boolean hasPlaybackSession;
        boolean shuffleEnabledSnapshot;
        String repeatModeSnapshot;
        synchronized (stateLock) {
            currentMusicId = resolveCurrentMusicIdLocked(null);
            hasPlaybackSession = currentMusicId != null && !queueIds.isEmpty();
            shuffleEnabledSnapshot = shuffleEnabled;
            repeatModeSnapshot = repeatMode;
        }

        long positionMs = 0L;
        long durationMs = 0L;
        long bufferedMs = 0L;
        boolean isPlaying = false;
        boolean isBuffering = false;
        int currentTrackId = -1;
        if (musicService != null) {
            positionMs = musicService.getPositionMs();
            durationMs = musicService.getDurationMs();
            bufferedMs = musicService.getBufferedPositionMs();
            isPlaying = musicService.isPlaying();
            isBuffering = musicService.isBuffering();
            currentTrackId = musicService.getCurrentTrackId();
        }

        JSObject result = new JSObject();
        result.put("positionMs", positionMs);
        result.put("durationMs", durationMs);
        result.put("bufferedPositionMs", bufferedMs);
        result.put("isPlaying", isPlaying);
        result.put("isBuffering", isBuffering);
        result.put("currentTrackId", currentTrackId);
        result.put("currentMusicId", currentMusicId);
        result.put("hasPlaybackSession", hasPlaybackSession);
        result.put("shuffleEnabled", shuffleEnabledSnapshot);
        result.put("repeatMode", repeatModeSnapshot);
        result.put("accompanimentMode", isAccompanimentModeLocked());
        result.put("pausedByRemoteDevice", musicService != null && musicService.isPausedByRemoteDevice());
        result.put("stateVersion", getStateVersion());
        return result;
    }

    private boolean isAccompanimentModeLocked() {
        synchronized (stateLock) {
            return accompanimentMode;
        }
    }

    private long getStateVersion() {
        synchronized (stateLock) {
            return stateVersion;
        }
    }

    /**
     * Bumps the structural state version and pushes a "snapshotChanged" event so the
     * web layer knows a full getSnapshot() is worth doing.
     */
    private void emitSnapshotChanged(String reason) {
        long version;
        synchronized (stateLock) {
            stateVersion += 1;
            version = stateVersion;
        }
        JSObject payload = new JSObject();
        payload.put("reason", reason);
        payload.put("version", version);
        runOnMainThread(() -> notifyListeners("snapshotChanged", payload));
    }

    /**
     * Pushes the resolved playback URL of every queued track to the service, which
     * swaps only the media items whose source actually changed (never reloading the
     * whole playlist and never interrupting the current item on a downgrade).
     */
    private void syncTrackSourcesToService() {
        if (!ensureServiceBinding(false) || musicService == null || musicService.getCurrentTrackId() <= 0) {
            return;
        }
        Map<Integer, String> urlById = new LinkedHashMap<>();
        synchronized (stateLock) {
            for (Integer queueId : queueIds) {
                NativeMusicRepository.MusicRecord music = musicById.get(queueId);
                if (music == null) continue;
                urlById.put(music.id, resolvePlaybackUrlLocked(music));
            }
        }
        if (urlById.isEmpty()) {
            return;
        }
        try {
            musicService.updatePlaylistSources(urlById);
        } catch (Exception e) {
            Log.w(TAG, "syncTrackSourcesToService failed", e);
        }
    }

    private String resolvePlaybackUrlLocked(NativeMusicRepository.MusicRecord music) {
        if (accompanimentMode && music.hasAccompaniment) {
            // 伴奏版不走本地缓存，直接串流。
            return baseUrl + "/api/music/accompaniment/" + music.id;
        }
        String playbackUrl = cachedTrackUrls.get(music.id);
        if (playbackUrl == null || playbackUrl.trim().isEmpty()) {
            playbackUrl = baseUrl + "/api/music/download/" + music.id;
        }
        return playbackUrl;
    }

    private void loadPlaylistOnService(long positionMs, boolean playWhenReady) throws Exception {
        loadPlaylistOnService(null, positionMs, playWhenReady);
    }

    private void loadPlaylistOnService(Integer preferredCurrentMusicId, long positionMs, boolean playWhenReady) throws Exception {
        List<MusicService.PlaylistItem> playlistItems = new ArrayList<>();
        Integer currentMusicIdSnapshot;
        String repeatModeSnapshot;
        boolean shuffleEnabledSnapshot;
        String baseUrlSnapshot;

        synchronized (stateLock) {
            currentMusicIdSnapshot = resolveCurrentMusicIdLocked(preferredCurrentMusicId);
            repeatModeSnapshot = repeatMode;
            shuffleEnabledSnapshot = shuffleEnabled;
            baseUrlSnapshot = baseUrl;
            for (Integer queueId : queueIds) {
                NativeMusicRepository.MusicRecord music = musicById.get(queueId);
                if (music == null) continue;
                String playbackUrl = resolvePlaybackUrlLocked(music);
                playlistItems.add(
                    new MusicService.PlaylistItem(
                        music.id,
                        playbackUrl,
                        music.title,
                        music.album != null && music.album.name != null ? music.album.name : DEFAULT_ALBUM_LABEL,
                        resolveMusicCoverUrl(music)
                    )
                );
            }
            if (currentMusicIdSnapshot != null) {
                storedCurrentMusicId = currentMusicIdSnapshot;
            }
        }

        if (playlistItems.isEmpty()) {
            throw new IllegalStateException("Playback queue is empty");
        }

        int startIndex = 0;
        if (currentMusicIdSnapshot != null) {
            for (int i = 0; i < playlistItems.size(); i++) {
                if (playlistItems.get(i).id == currentMusicIdSnapshot) {
                    startIndex = i;
                    break;
                }
            }
        }
        final int startIndexSnapshot = startIndex;

        if (!runWhenServiceReady(true, () -> {
            musicService.setBaseUrl(baseUrlSnapshot);
            musicService.loadPlaylist(
                playlistItems,
                startIndexSnapshot,
                toExoRepeat(repeatModeSnapshot),
                shuffleEnabledSnapshot,
                positionMs,
                playWhenReady
            );
        })) {
            throw new IllegalStateException("Native music service is unavailable");
        }
    }

    private void syncPlaylistPreservingState() {
        if (!ensureServiceBinding(false) || musicService == null || musicService.getCurrentTrackId() <= 0) {
            return;
        }
        try {
            long positionMs = musicService.getPositionMs();
            boolean playWhenReady = musicService.isPlayWhenReady();
            loadPlaylistOnService(positionMs, playWhenReady);
        } catch (Exception e) {
            Log.w(TAG, "syncPlaylistPreservingState failed", e);
        }
    }

    private void stopServicePlayback() {
        runWhenServiceReady(false, () -> {
            if (musicService != null) {
                musicService.stop();
            }
        });
    }

    private Integer resolveCurrentMusicIdLocked() {
        return resolveCurrentMusicIdLocked(null);
    }

    private Integer resolveCurrentMusicIdLocked(Integer preferredCurrentMusicId) {
        if (preferredCurrentMusicId != null && musicById.containsKey(preferredCurrentMusicId)) {
            storedCurrentMusicId = preferredCurrentMusicId;
            return preferredCurrentMusicId;
        }
        int serviceTrackId = musicService != null ? musicService.getCurrentTrackId() : -1;
        if (serviceTrackId > 0 && musicById.containsKey(serviceTrackId)) {
            storedCurrentMusicId = serviceTrackId;
            return serviceTrackId;
        }
        if (storedCurrentMusicId != null && musicById.containsKey(storedCurrentMusicId)) {
            return storedCurrentMusicId;
        }
        if (!queueIds.isEmpty()) {
            return queueIds.get(0);
        }
        return null;
    }

    private List<Integer> normalizeQueueIds(JSArray rawQueue) {
        List<Integer> ids = new ArrayList<>();
        if (rawQueue == null) {
            return ids;
        }
        for (int i = 0; i < rawQueue.length(); i++) {
            int musicId = rawQueue.optInt(i, -1);
            if (musicId > 0) {
                ids.add(musicId);
            }
        }
        return normalizeQueueIds(ids);
    }

    private List<Integer> normalizeQueueIds(List<Integer> rawQueue) {
        LinkedHashSet<Integer> normalized = new LinkedHashSet<>();
        synchronized (stateLock) {
            for (Integer musicId : rawQueue) {
                if (musicId != null && musicById.containsKey(musicId)) {
                    normalized.add(musicId);
                }
            }
        }
        return new ArrayList<>(normalized);
    }

    private boolean isQueueEmpty() {
        synchronized (stateLock) {
            return queueIds.isEmpty();
        }
    }

    private boolean isShuffleEnabledLocked() {
        synchronized (stateLock) {
            return shuffleEnabled;
        }
    }

    private void persistQueueStateAsync() {
        String baseUrlSnapshot;
        List<Integer> queueIdsSnapshot;
        Integer currentMusicIdSnapshot;
        synchronized (stateLock) {
            baseUrlSnapshot = baseUrl;
            queueIdsSnapshot = new ArrayList<>(queueIds);
            currentMusicIdSnapshot = resolveCurrentMusicIdLocked();
        }
        if (baseUrlSnapshot == null || baseUrlSnapshot.isEmpty()) {
            return;
        }
        backgroundExecutor.execute(() -> {
            try {
                String authorizationHeader = NativeAuthSessionStore.getAuthorizationHeader(getContext(), baseUrlSnapshot);
                String cookie = authorizationHeader == null ? getCookie(baseUrlSnapshot + "/api/music/queue") : null;
                NativeMusicRepository.saveQueueState(
                    baseUrlSnapshot,
                    cookie,
                    authorizationHeader,
                    queueIdsSnapshot,
                    currentMusicIdSnapshot
                );
            } catch (Exception e) {
                Log.w(TAG, "saveQueueState failed", e);
            }
        });
    }

    private String resolveMusicCoverUrl(NativeMusicRepository.MusicRecord music) {
        if (music.album != null && music.album.image != null && !music.album.image.isEmpty()) {
            return music.album.image;
        }
        if (music.coverUrl != null && !music.coverUrl.isEmpty()) {
            return music.coverUrl;
        }
        return baseUrl + "/api/music/album_cover/defult.jpeg";
    }

    private void setBaseUrlValue(String requestedBaseUrl) {
        synchronized (stateLock) {
            baseUrl = NativeMusicRepository.normalizeBaseUrl(requestedBaseUrl);
        }
        syncServiceBaseUrl();
    }

    private void syncServiceBaseUrl() {
        String baseUrlSnapshot;
        synchronized (stateLock) {
            baseUrlSnapshot = baseUrl;
        }
        if (baseUrlSnapshot == null || baseUrlSnapshot.isEmpty()) {
            return;
        }
        runWhenServiceReady(false, () -> {
            if (musicService != null) {
                musicService.setBaseUrl(baseUrlSnapshot);
            }
        });
    }

    private void pushCatalogToService() {
        MusicService service = musicService;
        if (service == null) {
            return;
        }
        List<NativeMusicRepository.AlbumRecord> albumSnapshot;
        List<NativeMusicRepository.MusicRecord> musicSnapshot;
        synchronized (stateLock) {
            if (albums.isEmpty() && musics.isEmpty()) {
                return;
            }
            albumSnapshot = new ArrayList<>(albums);
            musicSnapshot = new ArrayList<>(musics);
        }
        service.setCatalog(albumSnapshot, musicSnapshot);
    }

    private String getCookie(String url) {
        try {
            return CookieManager.getInstance().getCookie(url);
        } catch (Exception ignored) {
            return null;
        }
    }

    private int toExoRepeat(String mode) {
        if ("one".equals(mode)) return Player.REPEAT_MODE_ONE;
        if ("all".equals(mode)) return Player.REPEAT_MODE_ALL;
        return Player.REPEAT_MODE_OFF;
    }

    private boolean ensureServiceBinding(boolean startForPlayback) {
        Context ctx = getContext();
        if (ctx == null) {
            Log.e(TAG, "Context unavailable");
            return false;
        }

        Intent intent = new Intent(ctx, MusicService.class);
        if (startForPlayback && !ensureServiceStarted(ctx, intent)) return false;
        if (bound || binding) return true;

        try {
            binding = ctx.bindService(intent, connection, Context.BIND_AUTO_CREATE);
        } catch (Exception e) {
            binding = false;
            Log.e(TAG, "bindService failed", e);
            return false;
        }
        if (!binding) {
            Log.e(TAG, "bindService returned false");
            return false;
        }
        return true;
    }

    private boolean ensureServiceStarted(Context ctx, Intent intent) {
        if (startedForPlayback) return true;
        try {
            ContextCompat.startForegroundService(ctx, intent);
            startedForPlayback = true;
            return true;
        } catch (Exception e) {
            Log.e(TAG, "startForegroundService failed", e);
            return false;
        }
    }

    private boolean runWhenServiceReady(boolean startForPlayback, Runnable action) {
        if (!ensureServiceBinding(startForPlayback)) return false;
        if (bound && musicService != null) {
            action.run();
            return true;
        }
        pendingActions.add(action);
        return true;
    }

    private void flushPendingActions() {
        List<Runnable> copy = new ArrayList<>(pendingActions);
        pendingActions.clear();
        for (Runnable action : copy) {
            action.run();
        }
    }

    private void resolve(PluginCall call) {
        runOnMainThread(call::resolve);
    }

    private void resolve(PluginCall call, JSObject result) {
        runOnMainThread(() -> call.resolve(result));
    }

    private void reject(PluginCall call, Exception e) {
        String message = e.getMessage() != null ? e.getMessage() : "Native music action failed";
        runOnMainThread(() -> call.reject(message));
    }

    private void runOnMainThread(Runnable action) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(action);
            return;
        }
        action.run();
    }
}
