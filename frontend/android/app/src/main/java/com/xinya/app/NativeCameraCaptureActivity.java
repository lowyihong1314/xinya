package com.xinya.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ZoomState;
import androidx.camera.video.FileOutputOptions;
import androidx.camera.video.Recording;
import androidx.camera.video.VideoRecordEvent;
import androidx.camera.view.CameraController;
import androidx.camera.view.LifecycleCameraController;
import androidx.camera.view.PreviewView;
import androidx.camera.view.video.AudioConfig;
import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;

public class NativeCameraCaptureActivity extends AppCompatActivity {

    public static final String EXTRA_EVENT_ID = "eventId";
    public static final String EXTRA_EVENT_NAME = "eventName";
    public static final String EXTRA_BASE_URL = "baseUrl";

    private static final int REQUEST_CAMERA_PERMISSION = 3104;
    private static final int LONG_PRESS_MS = 520;
    private static final float[] QUICK_ZOOMS = new float[] { 1f, 2f, 3f, 5f, 10f };

    private final Handler handler = new Handler(Looper.getMainLooper());

    private LifecycleCameraController cameraController;
    private PreviewView previewView;
    private TextView statusText;
    private TextView zoomText;
    private TextView counterText;
    private TextView focusRing;
    private Button shutterButton;
    private Button flipButton;
    private Button torchButton;
    private LinearLayout zoomStrip;

    private int eventId;
    private String eventName;
    private String baseUrl;
    private int capturedCount = 0;
    private int queuedCount = 0;
    private boolean torchEnabled = false;
    private boolean longPressStartedRecording = false;
    private Recording activeRecording;
    private File activeVideoFile;
    private float maxZoomRatio = 1f;
    private float currentZoomRatio = 1f;
    private CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;

    private final Runnable startRecordingRunnable = () -> {
        longPressStartedRecording = true;
        startVideoRecording();
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        eventId = getIntent().getIntExtra(EXTRA_EVENT_ID, 0);
        eventName = getIntent().getStringExtra(EXTRA_EVENT_NAME);
        baseUrl = normalizeBaseUrl(getIntent().getStringExtra(EXTRA_BASE_URL));
        buildUi();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            requestPermissions(new String[] { Manifest.permission.CAMERA }, REQUEST_CAMERA_PERMISSION);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        stopVideoRecording();
        if (cameraController != null) {
            cameraController.unbind();
        }
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_CAMERA_PERMISSION && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            setStatus("需要允许相机权限");
        }
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        focusRing = new TextView(this);
        focusRing.setText("");
        focusRing.setVisibility(View.GONE);
        focusRing.setBackground(circleDrawable(Color.TRANSPARENT, Color.argb(230, 255, 255, 255), 2));
        root.addView(focusRing, new FrameLayout.LayoutParams(dp(72), dp(72), Gravity.TOP | Gravity.START));

        LinearLayout topBar = new LinearLayout(this);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(14), dp(14), dp(14), dp(10));
        topBar.setBackgroundColor(Color.argb(120, 0, 0, 0));
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        root.addView(topBar, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        ));

        Button closeButton = pillButton("退出");
        closeButton.setOnClickListener((view) -> finishWithResult());
        topBar.addView(closeButton, new LinearLayout.LayoutParams(dp(64), dp(42)));

        statusText = new TextView(this);
        statusText.setTextColor(Color.WHITE);
        statusText.setTextSize(14);
        statusText.setTypeface(Typeface.DEFAULT_BOLD);
        statusText.setSingleLine(false);
        statusText.setGravity(Gravity.CENTER);
        statusText.setText(eventName != null && !eventName.trim().isEmpty() ? eventName : "原生相机");
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        statusParams.setMargins(dp(10), 0, dp(10), 0);
        topBar.addView(statusText, statusParams);

        counterText = new TextView(this);
        counterText.setTextColor(Color.WHITE);
        counterText.setTextSize(12);
        counterText.setTypeface(Typeface.DEFAULT_BOLD);
        counterText.setGravity(Gravity.CENTER);
        counterText.setBackground(pillDrawable(Color.argb(120, 0, 0, 0), Color.argb(40, 255, 255, 255), 1));
        counterText.setText("0");
        topBar.addView(counterText, new LinearLayout.LayoutParams(dp(54), dp(36)));

        zoomText = new TextView(this);
        zoomText.setTextColor(Color.WHITE);
        zoomText.setTextSize(15);
        zoomText.setTypeface(Typeface.DEFAULT_BOLD);
        zoomText.setGravity(Gravity.CENTER);
        zoomText.setBackground(pillDrawable(Color.argb(120, 0, 0, 0), Color.argb(40, 255, 255, 255), 1));
        FrameLayout.LayoutParams zoomTextParams = new FrameLayout.LayoutParams(dp(72), dp(42), Gravity.TOP | Gravity.RIGHT);
        zoomTextParams.setMargins(0, dp(76), dp(14), 0);
        root.addView(zoomText, zoomTextParams);

        zoomStrip = new LinearLayout(this);
        zoomStrip.setOrientation(LinearLayout.HORIZONTAL);
        zoomStrip.setGravity(Gravity.CENTER);
        zoomStrip.setPadding(dp(6), dp(6), dp(6), dp(6));
        zoomStrip.setBackground(pillDrawable(Color.argb(105, 0, 0, 0), Color.argb(24, 255, 255, 255), 1));
        FrameLayout.LayoutParams zoomStripParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
        );
        zoomStripParams.setMargins(0, 0, 0, dp(132));
        root.addView(zoomStrip, zoomStripParams);
        buildZoomButtons();

        LinearLayout bottomBar = new LinearLayout(this);
        bottomBar.setGravity(Gravity.CENTER);
        bottomBar.setPadding(dp(18), dp(14), dp(18), dp(22));
        bottomBar.setOrientation(LinearLayout.HORIZONTAL);
        bottomBar.setBackgroundColor(Color.argb(170, 0, 0, 0));
        root.addView(bottomBar, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        ));

        torchButton = roundButton("灯");
        torchButton.setOnClickListener((view) -> toggleTorch());
        bottomBar.addView(torchButton, new LinearLayout.LayoutParams(dp(58), dp(58), 1f));

        shutterButton = roundButton("");
        shutterButton.setBackground(circleDrawable(Color.WHITE, Color.argb(210, 255, 255, 255), 5));
        shutterButton.setOnTouchListener((view, event) -> handleShutterTouch(event));
        LinearLayout.LayoutParams shutterParams = new LinearLayout.LayoutParams(dp(84), dp(84));
        shutterParams.setMargins(dp(34), 0, dp(34), 0);
        bottomBar.addView(shutterButton, shutterParams);

        flipButton = roundButton("↻");
        flipButton.setOnClickListener((view) -> flipCamera());
        bottomBar.addView(flipButton, new LinearLayout.LayoutParams(dp(58), dp(58), 1f));

        setContentView(root);
    }

    private void startCamera() {
        try {
            cameraController = new LifecycleCameraController(this);
            cameraController.setEnabledUseCases(CameraController.IMAGE_CAPTURE | CameraController.VIDEO_CAPTURE);
            cameraController.setCameraSelector(cameraSelector);
            cameraController.setPinchToZoomEnabled(true);
            cameraController.setTapToFocusEnabled(true);
            cameraController.bindToLifecycle(this);
            previewView.setController(cameraController);
            previewView.setOnTouchListener((view, event) -> {
                if (event.getAction() == MotionEvent.ACTION_UP) {
                    showFocusRing(event.getX(), event.getY());
                }
                return false;
            });
            cameraController.getZoomState().observe(this, this::updateZoomState);
            setStatus("点击画面对焦，双指缩放");
        } catch (Exception error) {
            setStatus(error.getMessage() != null ? error.getMessage() : "无法打开原生相机");
        }
    }

    private boolean handleShutterTouch(MotionEvent event) {
        if (cameraController == null) {
            return true;
        }
        if (event.getAction() == MotionEvent.ACTION_DOWN) {
            longPressStartedRecording = false;
            handler.postDelayed(startRecordingRunnable, LONG_PRESS_MS);
            return true;
        }
        if (event.getAction() == MotionEvent.ACTION_UP || event.getAction() == MotionEvent.ACTION_CANCEL) {
            handler.removeCallbacks(startRecordingRunnable);
            if (activeRecording != null) {
                stopVideoRecording();
            } else if (!longPressStartedRecording && event.getAction() == MotionEvent.ACTION_UP) {
                takePhoto();
            }
            return true;
        }
        return true;
    }

    private void takePhoto() {
        try {
            File file = createCaptureFile(false);
            ImageCapture.OutputFileOptions outputOptions = new ImageCapture.OutputFileOptions.Builder(file).build();
            setStatus("拍照中");
            cameraController.takePicture(outputOptions, ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
                @Override
                public void onImageSaved(@NonNull ImageCapture.OutputFileResults outputFileResults) {
                    enqueueCapturedFile(file, "image/jpeg");
                    capturedCount += 1;
                    setStatus("照片已加入后台上传");
                    updateCounter();
                }

                @Override
                public void onError(@NonNull ImageCaptureException exception) {
                    deleteQuietly(file);
                    setStatus(exception.getMessage() != null ? exception.getMessage() : "拍照失败");
                }
            });
        } catch (Exception error) {
            setStatus(error.getMessage() != null ? error.getMessage() : "拍照失败");
        }
    }

    private void startVideoRecording() {
        if (cameraController == null || activeRecording != null) {
            return;
        }
        try {
            activeVideoFile = createCaptureFile(true);
            FileOutputOptions outputOptions = new FileOutputOptions.Builder(activeVideoFile).build();
            activeRecording = cameraController.startRecording(
                outputOptions,
                AudioConfig.AUDIO_DISABLED,
                ContextCompat.getMainExecutor(this),
                new Consumer<VideoRecordEvent>() {
                    @Override
                    public void accept(VideoRecordEvent event) {
                        if (event instanceof VideoRecordEvent.Start) {
                            setStatus("录像中");
                            shutterButton.setBackground(circleDrawable(Color.rgb(239, 68, 68), Color.argb(210, 255, 255, 255), 5));
                        } else if (event instanceof VideoRecordEvent.Finalize) {
                            handleVideoFinalized((VideoRecordEvent.Finalize) event);
                        }
                    }
                }
            );
        } catch (Exception error) {
            deleteQuietly(activeVideoFile);
            activeVideoFile = null;
            activeRecording = null;
            setStatus(error.getMessage() != null ? error.getMessage() : "录像失败");
        }
    }

    private void stopVideoRecording() {
        if (activeRecording != null) {
            activeRecording.stop();
            activeRecording = null;
        }
    }

    private void handleVideoFinalized(VideoRecordEvent.Finalize event) {
        File file = activeVideoFile;
        activeVideoFile = null;
        activeRecording = null;
        shutterButton.setBackground(circleDrawable(Color.WHITE, Color.argb(210, 255, 255, 255), 5));
        if (file == null) {
            return;
        }
        if (event.getError() == VideoRecordEvent.Finalize.ERROR_NONE && file.length() > 0) {
            enqueueCapturedFile(file, "video/mp4");
            capturedCount += 1;
            setStatus("视频已加入后台上传");
            updateCounter();
        } else {
            deleteQuietly(file);
            setStatus("录像失败");
        }
    }

    private void flipCamera() {
        if (activeRecording != null || cameraController == null) {
            return;
        }
        cameraSelector = cameraSelector == CameraSelector.DEFAULT_BACK_CAMERA
            ? CameraSelector.DEFAULT_FRONT_CAMERA
            : CameraSelector.DEFAULT_BACK_CAMERA;
        try {
            torchEnabled = false;
            cameraController.setCameraSelector(cameraSelector);
            updateTorchButton();
        } catch (Exception error) {
            cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;
            setStatus("当前镜头不可用");
        }
    }

    private void toggleTorch() {
        if (cameraController == null) {
            return;
        }
        torchEnabled = !torchEnabled;
        try {
            cameraController.enableTorch(torchEnabled);
            updateTorchButton();
        } catch (Exception error) {
            torchEnabled = false;
            updateTorchButton();
            setStatus("闪光灯不可用");
        }
    }

    private void updateTorchButton() {
        torchButton.setText(torchEnabled ? "关灯" : "灯");
    }

    private void updateZoomState(ZoomState zoomState) {
        if (zoomState == null) {
            return;
        }
        currentZoomRatio = zoomState.getZoomRatio();
        maxZoomRatio = Math.max(1f, zoomState.getMaxZoomRatio());
        zoomText.setText(formatZoom(currentZoomRatio));
        buildZoomButtons();
    }

    private void buildZoomButtons() {
        if (zoomStrip == null) {
            return;
        }
        zoomStrip.removeAllViews();
        for (float zoom : QUICK_ZOOMS) {
            Button button = zoomButton(zoom);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(isActiveZoom(zoom) ? 42 : 36), dp(isActiveZoom(zoom) ? 42 : 36));
            params.setMargins(dp(4), 0, dp(4), 0);
            zoomStrip.addView(button, params);
        }
    }

    private Button zoomButton(float zoom) {
        boolean active = isActiveZoom(zoom);
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(formatZoom(zoom));
        button.setTextSize(active ? 12 : 11);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setTextColor(active ? Color.BLACK : Color.WHITE);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(circleDrawable(active ? Color.WHITE : Color.argb(80, 255, 255, 255), Color.argb(50, 255, 255, 255), 1));
        button.setOnClickListener((view) -> setNativeZoomRatio(zoom));
        return button;
    }

    private boolean isActiveZoom(float zoom) {
        return Math.abs(currentZoomRatio - zoom) < 0.16f;
    }

    private void setNativeZoomRatio(float requestedZoom) {
        if (cameraController == null) {
            return;
        }
        float nextZoom = Math.max(1f, Math.min(maxZoomRatio, requestedZoom));
        try {
            cameraController.setZoomRatio(nextZoom);
        } catch (Exception error) {
            setStatus("当前倍率不可用");
        }
    }

    private void showFocusRing(float x, float y) {
        if (focusRing == null) {
            return;
        }
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) focusRing.getLayoutParams();
        params.leftMargin = Math.max(0, Math.round(x - dp(36)));
        params.topMargin = Math.max(0, Math.round(y - dp(36)));
        focusRing.setLayoutParams(params);
        focusRing.setAlpha(1f);
        focusRing.setVisibility(View.VISIBLE);
        focusRing.animate().cancel();
        focusRing.animate().alpha(0f).setStartDelay(520).setDuration(260).withEndAction(() -> focusRing.setVisibility(View.GONE)).start();
    }

    private void enqueueCapturedFile(File file, String mimeType) {
        if (eventId <= 0 || file == null || !file.exists()) {
            deleteQuietly(file);
            setStatus("上传参数错误");
            return;
        }

        try {
            String jobId = UUID.randomUUID().toString();
            JSONArray items = new JSONArray();
            JSONObject item = new JSONObject();
            updateStatus(item, "uri", Uri.fromFile(file).toString());
            updateStatus(item, "name", file.getName());
            updateStatus(item, "mimeType", mimeType);
            updateStatus(item, "size", file.length());
            updateStatus(item, "localPath", file.getAbsolutePath());
            items.put(item);

            JSONObject status = newStatus(jobId, eventId, items.length());
            NativeAlbumUploadStore.writeStatus(this, status);

            String authorization = NativeAuthSessionStore.getAuthorizationHeader(this);
            String cookie = authorization == null || authorization.trim().isEmpty()
                ? getCookieHeader(baseUrl)
                : null;

            Intent serviceIntent = new Intent(this, NativeAlbumUploadService.class);
            serviceIntent.setAction(NativeAlbumUploadService.ACTION_ENQUEUE);
            serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_JOB_ID, jobId);
            serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_EVENT_ID, eventId);
            serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_BASE_URL, baseUrl);
            serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_ITEMS, items.toString());
            if (authorization != null && !authorization.trim().isEmpty()) {
                serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_AUTHORIZATION, authorization);
            }
            if (cookie != null && !cookie.trim().isEmpty()) {
                serviceIntent.putExtra(NativeAlbumUploadService.EXTRA_COOKIE, cookie);
            }
            ContextCompat.startForegroundService(this, serviceIntent);
            queuedCount += 1;
            updateCounter();
        } catch (Exception error) {
            deleteQuietly(file);
            setStatus(error.getMessage() != null ? error.getMessage() : "后台上传启动失败");
        }
    }

    private File createCaptureFile(boolean video) throws Exception {
        File captureDir = new File(getCacheDir(), "native-camera-capture");
        if (!captureDir.exists() && !captureDir.mkdirs()) {
            throw new IllegalStateException("Unable to prepare camera cache");
        }
        String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        String prefix = video ? "video_" : "photo_";
        String extension = video ? ".mp4" : ".jpg";
        File file = new File(captureDir, prefix + timestamp + "_" + UUID.randomUUID() + extension);
        if (!file.createNewFile()) {
            throw new IllegalStateException("Unable to create camera file");
        }
        return file;
    }

    private void finishWithResult() {
        setResult(Activity.RESULT_OK);
        finish();
    }

    private void setStatus(String text) {
        if (statusText != null) {
            statusText.setText(text != null && !text.trim().isEmpty() ? text : "原生相机");
        }
        if (text != null && text.length() > 0) {
            Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
        }
    }

    private void updateCounter() {
        if (counterText != null) {
            counterText.setText(capturedCount + "/" + queuedCount);
        }
    }

    private JSONObject newStatus(String jobId, int eventId, int total) {
        JSONObject status = new JSONObject();
        updateStatus(status, "jobId", jobId);
        updateStatus(status, "eventId", eventId);
        updateStatus(status, "status", "queued");
        updateStatus(status, "total", total);
        updateStatus(status, "completed", 0);
        updateStatus(status, "failed", 0);
        updateStatus(status, "currentFile", "");
        updateStatus(status, "currentProgress", 0);
        updateStatus(status, "startedAt", System.currentTimeMillis());
        updateStatus(status, "updatedAt", System.currentTimeMillis());
        return status;
    }

    private void updateStatus(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
        } catch (Exception ignored) {
        }
    }

    private String getCookieHeader(String baseUrl) {
        try {
            String cookie = CookieManager.getInstance().getCookie(baseUrl + "/media/upload_media");
            return cookie != null ? cookie : "";
        } catch (Exception ignored) {
            return "";
        }
    }

    private String normalizeBaseUrl(String value) {
        String normalized = value != null ? value.trim() : "";
        if (normalized.isEmpty()) {
            normalized = "https://utbabuddha.com";
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private String formatZoom(float value) {
        return value >= 10f
            ? String.format(Locale.US, "%.0fx", value)
            : String.format(Locale.US, "%.1fx", value);
    }

    private Button pillButton(String text) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(pillDrawable(Color.argb(95, 255, 255, 255), Color.argb(40, 255, 255, 255), 1));
        return button;
    }

    private Button roundButton(String text) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(17);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(circleDrawable(Color.argb(80, 255, 255, 255), Color.argb(50, 255, 255, 255), 1));
        return button;
    }

    private GradientDrawable pillDrawable(int fillColor, int strokeColor, int strokeWidthDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setColor(fillColor);
        drawable.setCornerRadius(dp(999));
        drawable.setStroke(dp(strokeWidthDp), strokeColor);
        return drawable;
    }

    private GradientDrawable circleDrawable(int fillColor, int strokeColor, int strokeWidthDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        drawable.setColor(fillColor);
        drawable.setStroke(dp(strokeWidthDp), strokeColor);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void deleteQuietly(File file) {
        if (file == null) {
            return;
        }
        try {
            if (file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        } catch (Exception ignored) {
        }
    }
}
