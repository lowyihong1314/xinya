package com.xinya.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.ContextCompat;

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
            musicService.setEventCallback(new MusicService.EventCallback() {
                @Override
                public void emit(String event, JSObject data) {
                    runOnMainThread(() -> notifyListeners(event, data));
                }
            });
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
                // Service may already be unbound during teardown.
            }
        }
        bound = false;
        binding = false;
        startedForPlayback = false;
        musicService = null;
        pendingActions.clear();
    }

    @PluginMethod
    public void ready(PluginCall call) {
        if (!runWhenServiceReady(false, () -> resolve(call))) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        final String url = call.getString("url");
        final String title = call.getString("title", "");
        final String album = call.getString("album", "");
        final String coverUrl = call.getString("coverUrl", "");

        if (url == null || url.trim().isEmpty()) {
            call.reject("Music URL is required");
            return;
        }

        if (!runWhenServiceReady(true, () -> {
            try {
                musicService.play(url, title, album, coverUrl);
                resolve(call);
            } catch (Exception error) {
                reject(call, error);
            }
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (!runWhenServiceReady(false, () -> {
            musicService.pause();
            resolve(call);
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (!runWhenServiceReady(false, () -> {
            musicService.resume();
            resolve(call);
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        final Double positionMs = call.getDouble("positionMs");
        if (positionMs == null) {
            call.reject("positionMs is required");
            return;
        }

        if (!runWhenServiceReady(false, () -> {
            musicService.seekTo(Math.round(positionMs));
            resolve(call);
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void getProgress(PluginCall call) {
        if (!runWhenServiceReady(false, () -> {
            JSObject result = new JSObject();
            result.put("positionMs", musicService.getPositionMs());
            result.put("durationMs", musicService.getDurationMs());
            result.put("isPlaying", musicService.isPlaying());
            resolve(call, result);
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!runWhenServiceReady(false, () -> {
            musicService.stop();
            resolve(call);
        })) {
            call.reject("Native music service is unavailable");
        }
    }

    private boolean ensureServiceBinding(boolean startForPlayback) {
        Context context = getContext();
        if (context == null) {
            Log.e(TAG, "Context is unavailable while binding music service");
            return false;
        }

        Intent intent = new Intent(context, MusicService.class);
        if (startForPlayback && !ensureServiceStarted(context, intent)) {
            return false;
        }

        if (bound || binding) {
            return true;
        }

        try {
            binding = context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
        } catch (Exception error) {
            binding = false;
            Log.e(TAG, "Failed to bind music service", error);
            return false;
        }

        if (!binding) {
            Log.e(TAG, "bindService returned false for music service");
            return false;
        }

        return true;
    }

    private boolean ensureServiceStarted(Context context, Intent intent) {
        if (startedForPlayback) {
            return true;
        }

        try {
            ContextCompat.startForegroundService(context, intent);
            startedForPlayback = true;
            return true;
        } catch (Exception error) {
            Log.e(TAG, "Failed to start foreground music service", error);
            return false;
        }
    }

    private boolean runWhenServiceReady(boolean startForPlayback, Runnable action) {
        if (!ensureServiceBinding(startForPlayback)) {
            return false;
        }

        if (bound && musicService != null) {
            action.run();
            return true;
        }

        pendingActions.add(action);
        return true;
    }

    private void flushPendingActions() {
        List<Runnable> actions = new ArrayList<>(pendingActions);
        pendingActions.clear();
        for (Runnable action : actions) {
            action.run();
        }
    }

    private void resolve(PluginCall call) {
        runOnMainThread(call::resolve);
    }

    private void resolve(PluginCall call, JSObject result) {
        runOnMainThread(() -> call.resolve(result));
    }

    private void reject(PluginCall call, Exception error) {
        final String message = error.getMessage() != null ? error.getMessage() : "Native music action failed";
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
