package com.xinya.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.ContextCompat;

import com.google.android.exoplayer2.Player;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "NativeMusic")
public class NativeMusicPlugin extends Plugin {

    private static final String TAG = "NativeMusicPlugin";

    private MusicService musicService;
    private boolean bound = false;
    private boolean binding = false;
    private boolean startedForPlayback = false;
    private final List<Runnable> pendingActions = new ArrayList<>();

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            MusicService.MusicBinder binder = (MusicService.MusicBinder) service;
            musicService = binder.getService();
            bound = true;
            binding = false;
            musicService.setEventCallback((event, data) ->
                runOnMainThread(() -> notifyListeners(event, data))
            );
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
    public void load() { ensureServiceBinding(false); }

    @Override
    protected void handleOnDestroy() {
        if (musicService != null) musicService.setEventCallback(null);
        if (bound) {
            try { getContext().unbindService(connection); }
            catch (IllegalArgumentException ignored) {}
        }
        bound = false; binding = false; startedForPlayback = false;
        musicService = null;
        pendingActions.clear();
    }

    // ── Plugin methods ───────────────────────────────────────────────────────

    @PluginMethod
    public void ready(PluginCall call) {
        if (!runWhenServiceReady(false, () -> resolve(call)))
            call.reject("Native music service is unavailable");
    }

    /**
     * Load and play a full ordered playlist.
     * tracks: [{ id, url, title, album, coverUrl }]
     * startIndex: int
     * repeatMode: "off" | "all" | "one"
     */
    @PluginMethod
    public void setPlaylist(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        int startIndex = call.getInt("startIndex", 0);
        String repeatMode = call.getString("repeatMode", "off");

        if (tracks == null || tracks.length() == 0) {
            call.reject("tracks array is required");
            return;
        }

        List<MusicService.PlaylistItem> items = new ArrayList<>();
        try {
            for (int i = 0; i < tracks.length(); i++) {
                org.json.JSONObject t = tracks.getJSONObject(i);
                String url = t.optString("url", "");
                if (url.isEmpty()) continue;
                int id = t.optInt("id", -1);
                String title = t.optString("title", "");
                String album = t.optString("album", "");
                String coverUrl = t.optString("coverUrl", "");
                items.add(new MusicService.PlaylistItem(id, url, title, album, coverUrl));
            }
        } catch (Exception e) {
            call.reject("Failed to parse tracks: " + e.getMessage());
            return;
        }

        if (items.isEmpty()) {
            call.reject("No valid tracks in playlist");
            return;
        }

        int exoRepeat = toExoRepeat(repeatMode);
        final List<MusicService.PlaylistItem> finalItems = items;

        if (!runWhenServiceReady(true, () -> {
            try {
                musicService.setPlaylist(finalItems, startIndex, exoRepeat);
                resolve(call);
            } catch (Exception e) { reject(call, e); }
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    /** Backward-compat single track play. */
    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("url is required"); return; }
        String title = call.getString("title", "");
        String album = call.getString("album", "");
        String coverUrl = call.getString("coverUrl", "");

        if (!runWhenServiceReady(true, () -> {
            try { musicService.play(url, title, album, coverUrl); resolve(call); }
            catch (Exception e) { reject(call, e); }
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void skipToIndex(PluginCall call) {
        Integer index = call.getInt("index");
        if (index == null) { call.reject("index is required"); return; }
        if (!runWhenServiceReady(false, () -> { musicService.skipToIndex(index); resolve(call); }))
            call.reject("Native music service is unavailable");
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        String mode = call.getString("mode", "off");
        int exoRepeat = toExoRepeat(mode);
        if (!runWhenServiceReady(false, () -> { musicService.setRepeatMode(exoRepeat); resolve(call); }))
            call.reject("Native music service is unavailable");
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (!runWhenServiceReady(false, () -> { musicService.pause(); resolve(call); }))
            call.reject("Native music service is unavailable");
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (!runWhenServiceReady(false, () -> { musicService.resume(); resolve(call); }))
            call.reject("Native music service is unavailable");
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double posMs = call.getDouble("positionMs");
        if (posMs == null) { call.reject("positionMs is required"); return; }
        if (!runWhenServiceReady(false, () -> { musicService.seekTo(Math.round(posMs)); resolve(call); }))
            call.reject("Native music service is unavailable");
    }

    @PluginMethod
    public void getProgress(PluginCall call) {
        if (!runWhenServiceReady(false, () -> {
            JSObject result = new JSObject();
            result.put("positionMs", musicService.getPositionMs());
            result.put("durationMs", musicService.getDurationMs());
            result.put("isPlaying", musicService.isPlaying());
            result.put("currentTrackId", musicService.getCurrentTrackId());
            resolve(call, result);
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!runWhenServiceReady(false, () -> { musicService.stop(); resolve(call); }))
            call.reject("Native music service is unavailable");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private int toExoRepeat(String mode) {
        if ("one".equals(mode)) return Player.REPEAT_MODE_ONE;
        if ("all".equals(mode)) return Player.REPEAT_MODE_ALL;
        return Player.REPEAT_MODE_OFF;
    }

    private boolean ensureServiceBinding(boolean startForPlayback) {
        Context ctx = getContext();
        if (ctx == null) { Log.e(TAG, "Context unavailable"); return false; }

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
        if (!binding) { Log.e(TAG, "bindService returned false"); return false; }
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
        if (bound && musicService != null) { action.run(); return true; }
        pendingActions.add(action);
        return true;
    }

    private void flushPendingActions() {
        List<Runnable> copy = new ArrayList<>(pendingActions);
        pendingActions.clear();
        for (Runnable a : copy) a.run();
    }

    private void resolve(PluginCall call) { runOnMainThread(call::resolve); }
    private void resolve(PluginCall call, JSObject result) { runOnMainThread(() -> call.resolve(result)); }
    private void reject(PluginCall call, Exception e) {
        String msg = e.getMessage() != null ? e.getMessage() : "Native music action failed";
        runOnMainThread(() -> call.reject(msg));
    }
    private void runOnMainThread(Runnable action) {
        if (getActivity() != null) { getActivity().runOnUiThread(action); return; }
        action.run();
    }
}
