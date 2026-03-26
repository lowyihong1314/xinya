package com.xinya.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "NativeMusic")
public class NativeMusicPlugin extends Plugin {

    private MusicService musicService;
    private boolean bound = false;
    private boolean binding = false;
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
        ensureServiceBinding();
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
        musicService = null;
        pendingActions.clear();
    }

    @PluginMethod
    public void ready(PluginCall call) {
        runWhenServiceReady(() -> resolve(call));
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

        runWhenServiceReady(() -> {
            try {
                musicService.play(url, title, album, coverUrl);
                resolve(call);
            } catch (Exception error) {
                reject(call, error);
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        runWhenServiceReady(() -> {
            musicService.pause();
            resolve(call);
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        runWhenServiceReady(() -> {
            musicService.resume();
            resolve(call);
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        final Double positionMs = call.getDouble("positionMs");
        if (positionMs == null) {
            call.reject("positionMs is required");
            return;
        }

        runWhenServiceReady(() -> {
            musicService.seekTo(Math.round(positionMs));
            resolve(call);
        });
    }

    @PluginMethod
    public void getProgress(PluginCall call) {
        runWhenServiceReady(() -> {
            JSObject result = new JSObject();
            result.put("positionMs", musicService.getPositionMs());
            result.put("durationMs", musicService.getDurationMs());
            result.put("isPlaying", musicService.isPlaying());
            resolve(call, result);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        runWhenServiceReady(() -> {
            musicService.stop();
            resolve(call);
        });
    }

    private void ensureServiceBinding() {
        if (bound || binding) {
            return;
        }

        Context context = getContext();
        Intent intent = new Intent(context, MusicService.class);
        context.startService(intent);
        binding = context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
        if (!binding) {
            binding = false;
        }
    }

    private void runWhenServiceReady(Runnable action) {
        if (bound && musicService != null) {
            action.run();
            return;
        }

        pendingActions.add(action);
        ensureServiceBinding();
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
