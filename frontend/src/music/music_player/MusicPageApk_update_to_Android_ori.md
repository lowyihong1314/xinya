# Upgrading APK Music Player to Native Android Background Playback

## Current State (What Exists)

The current APK music player is **entirely WebView-based**:

- Audio is an `<audio>` HTML element managed by `MusicPlayerController.ts`
- `MusicPlaybackContext` (React) owns the queue, shuffle, repeat state
- `MusicPageApk.tsx` renders the full-page UI and calls `musicPlayerController.togglePlay()`, `seekTo()`, `getProgress()`, `getDuration()`
- `AppLayout.tsx` calls `musicPlayerController.sync({ hidden: IS_APK })` — this keeps the audio element alive but hides the floating web widget
- The `AndroidManifest.xml` already has `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, and `WAKE_LOCK` permissions declared

**The problem:** Android aggressively pauses WebView audio when the app goes to the background. The `<audio>` element stops playback. There is no lock screen notification and no system media controls.

---

## Goal

Replace the `<audio>` HTML element with a **native Android foreground service** that:

1. Keeps playing audio even when the app is backgrounded or screen is off
2. Shows a persistent notification with track info and transport controls
3. Integrates with Android's `MediaSession` / lock screen controls
4. Is controlled from JavaScript via a **custom Capacitor plugin**

---

## Architecture After the Upgrade

```
MusicPageApk.tsx  ──calls──▶  NativeMusicPlugin (JS bridge)
                                    │
                         Capacitor bridge
                                    │
                    NativeMusicPlugin.java (Capacitor plugin)
                                    │
                    MusicService.java  (foreground Service)
                         ├── ExoPlayer  ←  audio stream
                         └── MediaSession  ←  lock screen / notification
```

`MusicPlayerController.ts` keeps running on the web side **only for the web build**. For APK, all audio is delegated to the native plugin.

---

## Step 1 — Create the Native Capacitor Plugin

### 1a. Create plugin class

Create `frontend/android/app/src/main/java/com/xinya/app/NativeMusicPlugin.java`:

```java
package com.utba.app;

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

@CapacitorPlugin(name = "NativeMusic")
public class NativeMusicPlugin extends Plugin {

    private MusicService musicService;
    private boolean bound = false;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            MusicService.MusicBinder binder = (MusicService.MusicBinder) service;
            musicService = binder.getService();
            bound = true;
            musicService.setEventCallback(NativeMusicPlugin.this::notifyListeners);
        }
        @Override
        public void onServiceDisconnected(ComponentName name) {
            bound = false;
        }
    };

    @Override
    public void load() {
        Intent intent = new Intent(getContext(), MusicService.class);
        getContext().startService(intent);
        getContext().bindService(intent, connection, Context.BIND_AUTO_CREATE);
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "");
        String album = call.getString("album", "");
        String coverUrl = call.getString("coverUrl", "");
        if (bound) musicService.play(url, title, album, coverUrl);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (bound) musicService.pause();
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (bound) musicService.resume();
        call.resolve();
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        double posMs = call.getDouble("positionMs", 0.0);
        if (bound) musicService.seekTo((long) posMs);
        call.resolve();
    }

    @PluginMethod
    public void getProgress(PluginCall call) {
        JSObject ret = new JSObject();
        if (bound) {
            ret.put("positionMs", musicService.getPositionMs());
            ret.put("durationMs", musicService.getDurationMs());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (bound) musicService.stop();
        call.resolve();
    }
}
```

### 1b. Create MusicService

Create `frontend/android/app/src/main/java/com/xinya/app/MusicService.java`:

```java
package com.utba.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;

import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.Player;

public class MusicService extends Service {

    private static final String CHANNEL_ID = "xinya_music";
    private static final int NOTIF_ID = 1;

    public interface EventCallback {
        void emit(String event, com.getcapacitor.JSObject data);
    }

    public class MusicBinder extends Binder {
        MusicService getService() { return MusicService.this; }
    }

    private final IBinder binder = new MusicBinder();
    private ExoPlayer player;
    private MediaSessionCompat mediaSession;
    private EventCallback eventCallback;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        player = new ExoPlayer.Builder(this).build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                updatePlaybackState();
                if (state == Player.STATE_ENDED && eventCallback != null) {
                    eventCallback.emit("trackEnded", new com.getcapacitor.JSObject());
                }
            }
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("isPlaying", isPlaying);
                if (eventCallback != null) eventCallback.emit("playStateChanged", data);
            }
        });

        mediaSession = new MediaSessionCompat(this, "XinyaMusic");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay()   { player.play(); }
            @Override public void onPause()  { player.pause(); }
            @Override public void onSkipToNext()     { if (eventCallback != null) eventCallback.emit("next", new com.getcapacitor.JSObject()); }
            @Override public void onSkipToPrevious() { if (eventCallback != null) eventCallback.emit("prev", new com.getcapacitor.JSObject()); }
            @Override public void onSeekTo(long pos) { player.seekTo(pos); }
        });
        mediaSession.setActive(true);
    }

    public void setEventCallback(EventCallback cb) { this.eventCallback = cb; }

    public void play(String url, String title, String album, String coverUrl) {
        player.setMediaItem(MediaItem.fromUri(url));
        player.prepare();
        player.play();
        updateNotification(title, album);
    }

    public void pause()  { player.pause(); }
    public void resume() { player.play(); }
    public void stop()   { player.stop(); }
    public void seekTo(long posMs) { player.seekTo(posMs); }
    public long getPositionMs() { return player.getCurrentPosition(); }
    public long getDurationMs() { return player.getDuration(); }

    private void updatePlaybackState() {
        PlaybackStateCompat.Builder sb = new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO);
        int state = player.isPlaying()
            ? PlaybackStateCompat.STATE_PLAYING
            : PlaybackStateCompat.STATE_PAUSED;
        sb.setState(state, player.getCurrentPosition(), 1.0f);
        mediaSession.setPlaybackState(sb.build());
    }

    private void updateNotification(String title, String album) {
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0,
            new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);

        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(album)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(R.drawable.ic_prev, "Prev",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
            .addAction(player.isPlaying()
                    ? new NotificationCompat.Action(R.drawable.ic_pause, "Pause",
                        MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE))
                    : new NotificationCompat.Action(R.drawable.ic_play, "Play",
                        MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY)))
            .addAction(R.drawable.ic_next, "Next",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();

        startForeground(NOTIF_ID, notif);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Music Playback", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Xinya music player");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    @Override
    public IBinder onBind(Intent intent) { return binder; }

    @Override
    public void onDestroy() {
        player.release();
        mediaSession.release();
        super.onDestroy();
    }
}
```

---

## Step 2 — Add ExoPlayer Dependency

In `frontend/android/app/build.gradle`, add inside `dependencies {}`:

```groovy
implementation 'com.google.android.exoplayer:exoplayer:2.19.1'
implementation 'androidx.media:media:1.7.0'
```

---

## Step 3 — Register Plugin and Service in AndroidManifest.xml

In `frontend/android/app/src/main/AndroidManifest.xml`:

```xml
<!-- Already present — confirm these exist -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.INTERNET" />

<application ...>

    <!-- Add MusicService inside <application> -->
    <service
        android:name=".MusicService"
        android:foregroundServiceType="mediaPlayback"
        android:exported="false" />

    <!-- Add MediaButtonReceiver for lock screen / notification controls -->
    <receiver android:name="androidx.media.session.MediaButtonReceiver"
        android:exported="true">
        <intent-filter>
            <action android:name="android.intent.action.MEDIA_BUTTON" />
        </intent-filter>
    </receiver>

</application>
```

---

## Step 4 — Register Plugin in MainActivity.java

```java
package com.utba.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeMusicPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

---

## Step 5 — Create a TypeScript Bridge (nativeMusicPlugin.ts)

Create `frontend/src/music/react/nativeMusicPlugin.ts`:

```typescript
import { registerPlugin } from "@capacitor/core";

export interface NativeMusicPlugin {
  play(options: { url: string; title: string; album: string; coverUrl: string }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seekTo(options: { positionMs: number }): Promise<void>;
  getProgress(): Promise<{ positionMs: number; durationMs: number }>;
  stop(): Promise<void>;
  addListener(event: "playStateChanged", handler: (data: { isPlaying: boolean }) => void): Promise<{ remove: () => void }>;
  addListener(event: "trackEnded", handler: () => void): Promise<{ remove: () => void }>;
  addListener(event: "next", handler: () => void): Promise<{ remove: () => void }>;
  addListener(event: "prev", handler: () => void): Promise<{ remove: () => void }>;
}

export const NativeMusic = registerPlugin<NativeMusicPlugin>("NativeMusic");
```

---

## Step 6 — Update MusicPageApk.tsx

The page currently calls `musicPlayerController.togglePlay()`, `seekTo()`, `getProgress()`, `getDuration()`.

Replace these with calls to `NativeMusic`:

### 6a. Replace audio control calls

| Old (WebView audio) | New (native plugin) |
|---|---|
| `musicPlayerController.togglePlay()` | `isPlaying ? NativeMusic.pause() : NativeMusic.resume()` |
| `musicPlayerController.seekTo(t)` | `NativeMusic.seekTo({ positionMs: t * 1000 })` |
| `musicPlayerController.getProgress()` | `NativeMusic.getProgress()` → `.positionMs / 1000` |
| `musicPlayerController.getDuration()` | `NativeMusic.getProgress()` → `.durationMs / 1000` |

### 6b. Replace `selectMusic` trigger

When a track is selected, call the native play instead of letting `MusicPlaybackContext` set `audioSrc`:

```typescript
async function handleSelectTrack(track: MusicRecord) {
  // 1. Update React state (for UI)
  setQueue(albumTracks);
  selectMusic(track.id);           // updates currentMusic in context
  // 2. Tell native service to start playing
  await NativeMusic.play({
    url: `${API_BASE}${track.audio_url}`,
    title: track.title,
    album: track.album?.name ?? "",
    coverUrl: track.cover_url ? `${API_BASE}${track.cover_url}` : "",
  });
}
```

### 6c. Listen for native events

In a `useEffect` inside `MusicPageApk`:

```typescript
useEffect(() => {
  const subs: Array<Promise<{ remove: () => void }>> = [];

  subs.push(NativeMusic.addListener("trackEnded", () => handleTrackEnded()));
  subs.push(NativeMusic.addListener("next", () => playRelative(1)));
  subs.push(NativeMusic.addListener("prev", () => playRelative(-1)));
  subs.push(NativeMusic.addListener("playStateChanged", ({ isPlaying }) => {
    // Sync React state with native play state (e.g. user paused from notification)
    // You may need to expose a setter on MusicPlaybackContext for this
  }));

  return () => { subs.forEach(p => p.then(s => s.remove())); };
}, [handleTrackEnded, playRelative]);
```

### 6d. Replace the progress polling interval

Instead of polling `musicPlayerController.getProgress()` every 500 ms, poll `NativeMusic.getProgress()`:

```typescript
useEffect(() => {
  if (!isPlaying) return;
  const id = setInterval(async () => {
    const { positionMs, durationMs } = await NativeMusic.getProgress();
    setProgress(positionMs / 1000);
    setDuration(durationMs / 1000);
  }, 500);
  return () => clearInterval(id);
}, [isPlaying, autoplayKey]);
```

---

## Step 7 — Suppress the Web Audio Path in APK Mode

`MusicPlayerController.sync()` still creates an `<audio>` element in the web layer. In APK mode we need to prevent that from also trying to play audio.

In `AppLayout.tsx` (already passes `hidden: IS_APK`), extend the `SyncOptions` to also pass `audioDisabled: IS_APK`. Then in `MusicPlayerController.ts`, skip `audio.src` assignment when `audioDisabled` is true. This ensures only the native service plays audio.

---

## Step 8 — Drawable Icons for Notification

Create small 24dp PNG icon files at:

```
android/app/src/main/res/drawable/ic_play.png
android/app/src/main/res/drawable/ic_pause.png
android/app/src/main/res/drawable/ic_prev.png
android/app/src/main/res/drawable/ic_next.png
```

These are used only inside the notification. You can copy standard Material Design icons.

---

## Summary of Files to Create / Modify

| File | Action |
|---|---|
| `android/app/src/main/java/com/xinya/app/NativeMusicPlugin.java` | **CREATE** |
| `android/app/src/main/java/com/xinya/app/MusicService.java` | **CREATE** |
| `android/app/src/main/java/com/xinya/app/MainActivity.java` | **MODIFY** — register plugin |
| `android/app/src/main/AndroidManifest.xml` | **MODIFY** — add `<service>` and `<receiver>` |
| `android/app/build.gradle` | **MODIFY** — add ExoPlayer + media deps |
| `android/app/src/main/res/drawable/ic_play.png` etc. | **CREATE** |
| `src/music/react/nativeMusicPlugin.ts` | **CREATE** |
| `src/music/react/MusicPageApk.tsx` | **MODIFY** — use NativeMusic for play/pause/seek/events |
| `src/music/react/MusicPlayerController.ts` | **MODIFY** — add `audioDisabled` option to skip `<audio>` in APK |

---

## What Does NOT Change

- `MusicPlaybackContext` — still owns queue, shuffle, repeat, `currentMusic`. The native plugin only handles audio transport, not track selection logic.
- `MusicPage.tsx` (web version) — unchanged. Still uses `<audio>` via `MusicPlayerController`.
- `IS_APK` flag — still the compile-time gate. `nativeMusicPlugin.ts` is only called when `IS_APK` is true.
- The full-page APK UI in `MusicPageApk.tsx` — same layout, just different backend calls.
