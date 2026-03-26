package com.xinya.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;

import com.getcapacitor.JSObject;
import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.audio.AudioAttributes;
import com.google.android.exoplayer2.source.ProgressiveMediaSource;
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource;

import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.FutureTask;

public class MusicService extends Service {

    private static final String CHANNEL_ID = "xinya_music";
    private static final int NOTIFICATION_ID = 1042;
    private static final String TAG = "MusicService";

    public interface EventCallback {
        void emit(String event, JSObject data);
    }

    public class MusicBinder extends Binder {
        MusicService getService() {
            return MusicService.this;
        }
    }

    private final IBinder binder = new MusicBinder();
    private ExoPlayer player;
    private MediaSessionCompat mediaSession;
    private NotificationManager notificationManager;
    private EventCallback eventCallback;
    private String currentTitle = "";
    private String currentAlbum = "";
    private String currentCoverUrl = "";
    private boolean isForeground = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = getSystemService(NotificationManager.class);
        createNotificationChannel();

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
                updateNotification();
                if (state == Player.STATE_ENDED && eventCallback != null) {
                    eventCallback.emit("trackEnded", new JSObject());
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updatePlaybackState();
                updateNotification();
                emitPlayStateChanged(isPlaying);
            }
        });

        mediaSession = new MediaSessionCompat(this, "XinyaMusic");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                resume();
            }

            @Override
            public void onPause() {
                pause();
            }

            @Override
            public void onSkipToNext() {
                if (eventCallback != null) {
                    eventCallback.emit("next", new JSObject());
                }
            }

            @Override
            public void onSkipToPrevious() {
                if (eventCallback != null) {
                    eventCallback.emit("prev", new JSObject());
                }
            }

            @Override
            public void onSeekTo(long pos) {
                seekTo(pos);
            }
        });
        mediaSession.setActive(true);
        updatePlaybackState();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureForegroundService();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    public void setEventCallback(EventCallback callback) {
        eventCallback = callback;
    }

    public void play(String url, String title, String album, String coverUrl) {
        runOnPlayerThread(() -> {
            currentTitle = title != null ? title : "";
            currentAlbum = album != null ? album : "";
            currentCoverUrl = coverUrl != null ? coverUrl : "";
            ensureForegroundService();

            DefaultHttpDataSource.Factory dataSourceFactory = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true);

            String cookieHeader = CookieManager.getInstance().getCookie(url);
            if (cookieHeader != null && !cookieHeader.isEmpty()) {
                Map<String, String> requestHeaders = new HashMap<>();
                requestHeaders.put("Cookie", cookieHeader);
                dataSourceFactory.setDefaultRequestProperties(requestHeaders);
            }

            MediaItem mediaItem = MediaItem.fromUri(url);
            ProgressiveMediaSource mediaSource = new ProgressiveMediaSource.Factory(dataSourceFactory)
                .createMediaSource(mediaItem);

            player.setMediaSource(mediaSource);
            player.prepare();
            player.play();
            updatePlaybackState();
            updateNotification();
        });
    }

    public void pause() {
        runOnPlayerThread(() -> {
            if (player != null) {
                player.pause();
            }
            updatePlaybackState();
            updateNotification();
        });
    }

    public void resume() {
        runOnPlayerThread(() -> {
            if (player != null) {
                player.play();
            }
            updatePlaybackState();
            updateNotification();
        });
    }

    public void stop() {
        runOnPlayerThread(() -> {
            if (player != null) {
                player.stop();
            }
            currentTitle = "";
            currentAlbum = "";
            currentCoverUrl = "";
            updatePlaybackState();
            emitPlayStateChanged(false);
            if (isForeground) {
                stopForeground(true);
                isForeground = false;
            }
            if (notificationManager != null) {
                notificationManager.cancel(NOTIFICATION_ID);
            }
        });
    }

    public void seekTo(long positionMs) {
        runOnPlayerThread(() -> {
            if (player != null) {
                player.seekTo(Math.max(positionMs, 0L));
            }
            updatePlaybackState();
        });
    }

    public long getPositionMs() {
        return callOnPlayerThread(() -> {
            if (player == null) {
                return 0L;
            }
            return Math.max(player.getCurrentPosition(), 0L);
        }, 0L);
    }

    public long getDurationMs() {
        return callOnPlayerThread(() -> {
            if (player == null) {
                return 0L;
            }
            long duration = player.getDuration();
            return duration > 0 ? duration : 0L;
        }, 0L);
    }

    public boolean isPlaying() {
        return callOnPlayerThread(() -> player != null && player.isPlaying(), false);
    }

    private void emitPlayStateChanged(boolean isPlaying) {
        if (eventCallback == null) {
            return;
        }
        JSObject payload = new JSObject();
        payload.put("isPlaying", isPlaying);
        eventCallback.emit("playStateChanged", payload);
    }

    private void updatePlaybackState() {
        if (mediaSession == null || player == null) {
            return;
        }

        long actions =
            PlaybackStateCompat.ACTION_PLAY |
            PlaybackStateCompat.ACTION_PAUSE |
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
            PlaybackStateCompat.ACTION_SEEK_TO |
            PlaybackStateCompat.ACTION_PLAY_PAUSE;

        int state;
        if (player.isPlaying()) {
            state = PlaybackStateCompat.STATE_PLAYING;
        } else if (player.getPlaybackState() == Player.STATE_ENDED) {
            state = PlaybackStateCompat.STATE_STOPPED;
        } else {
            state = PlaybackStateCompat.STATE_PAUSED;
        }

        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, getPositionMs(), player.isPlaying() ? 1.0f : 0.0f)
            .build();
        mediaSession.setPlaybackState(playbackState);
    }

    private void updateNotification() {
        if (player == null || mediaSession == null || notificationManager == null) {
            return;
        }

        try {
            Notification notification = buildPlaybackNotification();
            promoteNotification(notification);
        } catch (Exception error) {
            Log.e(TAG, "Failed to build playback notification, falling back", error);
            promoteNotification(buildFallbackNotification());
        }
    }

    private Notification buildPlaybackNotification() {
        String title = currentTitle.isEmpty() ? "心芽音乐" : currentTitle;
        String album = currentAlbum.isEmpty() ? "后台播放中" : currentAlbum;

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(album)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(player.isPlaying())
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .addAction(
                R.drawable.ic_music_prev,
                "Prev",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            )
            .addAction(
                player.isPlaying() ? R.drawable.ic_music_pause : R.drawable.ic_music_play,
                player.isPlaying() ? "Pause" : "Play",
                MediaButtonReceiver.buildMediaButtonPendingIntent(
                    this,
                    player.isPlaying() ? PlaybackStateCompat.ACTION_PAUSE : PlaybackStateCompat.ACTION_PLAY
                )
            )
            .addAction(
                R.drawable.ic_music_next,
                "Next",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
            )
            .setStyle(
                new androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build();
    }

    private Notification buildFallbackNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = currentTitle.isEmpty() ? "心芽音乐" : currentTitle;
        String album = currentAlbum.isEmpty() ? "准备播放" : currentAlbum;

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(album)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .build();
    }

    private void ensureForegroundService() {
        promoteNotification(buildFallbackNotification());
    }

    private void promoteNotification(Notification notification) {
        try {
            if (!isForeground) {
                startForeground(NOTIFICATION_ID, notification);
                isForeground = true;
                return;
            }

            notificationManager.notify(NOTIFICATION_ID, notification);
        } catch (Exception error) {
            Log.e(TAG, "Failed to promote music notification", error);
        }
    }

    private void createNotificationChannel() {
        if (notificationManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Music Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Xinya music playback controls");
        notificationManager.createNotificationChannel(channel);
    }

    private void runOnPlayerThread(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
            return;
        }
        mainHandler.post(action);
    }

    private <T> T callOnPlayerThread(java.util.concurrent.Callable<T> action, T fallback) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try {
                return action.call();
            } catch (Exception error) {
                Log.e(TAG, "Player action failed on main thread", error);
                return fallback;
            }
        }

        FutureTask<T> task = new FutureTask<>(() -> {
            try {
                return action.call();
            } catch (Exception error) {
                Log.e(TAG, "Player action failed on main thread", error);
                return fallback;
            }
        });
        mainHandler.post(task);

        try {
            return task.get();
        } catch (Exception error) {
            Log.e(TAG, "Failed waiting for player action", error);
            return fallback;
        }
    }
}
