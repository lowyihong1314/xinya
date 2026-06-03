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
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.MeteringPointFactory;
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
import java.util.concurrent.TimeUnit;
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
    private TextView recordingBadge;
    private FrameLayout shutterButton;
    private View shutterCore;
    private TextView flipButton;
    private TextView torchButton;
    private LinearLayout zoomStrip;
    private ScaleGestureDetector scaleGestureDetector;

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
    private float pinchStartZoomRatio = 1f;
    private boolean previewHadMultiTouch = false;
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
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableFullscreenLayout();
        }
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
        enableFullscreenLayout();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        View topScrim = new View(this);
        topScrim.setBackground(new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { Color.argb(185, 0, 0, 0), Color.TRANSPARENT }
        ));
        root.addView(topScrim, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(148),
            Gravity.TOP
        ));

        View bottomScrim = new View(this);
        bottomScrim.setBackground(new GradientDrawable(
            GradientDrawable.Orientation.BOTTOM_TOP,
            new int[] { Color.argb(230, 0, 0, 0), Color.TRANSPARENT }
        ));
        root.addView(bottomScrim, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(292),
            Gravity.BOTTOM
        ));

        focusRing = new TextView(this);
        focusRing.setText("");
        focusRing.setVisibility(View.GONE);
        focusRing.setBackground(circleDrawable(Color.TRANSPARENT, Color.argb(235, 255, 214, 82), 2));
        root.addView(focusRing, new FrameLayout.LayoutParams(dp(78), dp(78), Gravity.TOP | Gravity.START));

        FrameLayout topBar = new FrameLayout(this);
        topBar.setPadding(dp(18), dp(34), dp(18), 0);
        root.addView(topBar, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(126),
            Gravity.TOP
        ));

        TextView closeButton = iconButton("×", 46, 26);
        closeButton.setOnClickListener((view) -> finishWithResult());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(46), dp(46), Gravity.LEFT | Gravity.TOP);
        topBar.addView(closeButton, closeParams);

        statusText = new TextView(this);
        statusText.setTextColor(Color.WHITE);
        statusText.setTextSize(14);
        statusText.setTypeface(Typeface.DEFAULT_BOLD);
        statusText.setSingleLine(true);
        statusText.setEllipsize(TextUtils.TruncateAt.END);
        statusText.setGravity(Gravity.CENTER);
        statusText.setText(eventName != null && !eventName.trim().isEmpty() ? eventName : "原生相机");
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(46),
            Gravity.TOP | Gravity.CENTER_HORIZONTAL
        );
        statusParams.setMargins(dp(68), 0, dp(88), 0);
        topBar.addView(statusText, statusParams);

        counterText = new TextView(this);
        counterText.setTextColor(Color.WHITE);
        counterText.setTextSize(12);
        counterText.setTypeface(Typeface.DEFAULT_BOLD);
        counterText.setGravity(Gravity.CENTER);
        counterText.setBackground(pillDrawable(Color.argb(82, 0, 0, 0), Color.argb(70, 255, 255, 255), 1));
        counterText.setText("0");
        FrameLayout.LayoutParams counterParams = new FrameLayout.LayoutParams(dp(58), dp(36), Gravity.RIGHT | Gravity.TOP);
        counterParams.setMargins(0, dp(5), 0, 0);
        topBar.addView(counterText, counterParams);

        recordingBadge = new TextView(this);
        recordingBadge.setText("REC");
        recordingBadge.setTextColor(Color.WHITE);
        recordingBadge.setTextSize(12);
        recordingBadge.setTypeface(Typeface.DEFAULT_BOLD);
        recordingBadge.setGravity(Gravity.CENTER);
        recordingBadge.setVisibility(View.GONE);
        recordingBadge.setBackground(pillDrawable(Color.rgb(220, 38, 38), Color.TRANSPARENT, 0));
        FrameLayout.LayoutParams recordingParams = new FrameLayout.LayoutParams(dp(62), dp(30), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        recordingParams.setMargins(0, dp(54), 0, 0);
        topBar.addView(recordingBadge, recordingParams);

        zoomStrip = new LinearLayout(this);
        zoomStrip.setOrientation(LinearLayout.HORIZONTAL);
        zoomStrip.setGravity(Gravity.CENTER);
        zoomStrip.setPadding(dp(5), dp(5), dp(5), dp(5));
        zoomStrip.setBackground(pillDrawable(Color.argb(104, 0, 0, 0), Color.argb(44, 255, 255, 255), 1));
        FrameLayout.LayoutParams zoomStripParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
        );
        zoomStripParams.setMargins(0, 0, 0, dp(146));
        root.addView(zoomStrip, zoomStripParams);
        buildZoomButtons();

        FrameLayout bottomBar = new FrameLayout(this);
        bottomBar.setPadding(dp(24), 0, dp(24), dp(24));
        root.addView(bottomBar, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(132),
            Gravity.BOTTOM
        ));

        torchButton = iconButton("⚡", 58, 22);
        torchButton.setOnClickListener((view) -> toggleTorch());
        FrameLayout.LayoutParams torchParams = new FrameLayout.LayoutParams(dp(58), dp(58), Gravity.LEFT | Gravity.CENTER_VERTICAL);
        bottomBar.addView(torchButton, torchParams);

        shutterButton = new FrameLayout(this);
        shutterButton.setBackground(circleDrawable(Color.TRANSPARENT, Color.argb(240, 255, 255, 255), 4));
        shutterButton.setOnTouchListener((view, event) -> handleShutterTouch(event));
        shutterCore = new View(this);
        shutterCore.setBackground(circleDrawable(Color.WHITE, Color.TRANSPARENT, 0));
        shutterButton.addView(shutterCore, new FrameLayout.LayoutParams(dp(64), dp(64), Gravity.CENTER));
        FrameLayout.LayoutParams shutterParams = new FrameLayout.LayoutParams(dp(88), dp(88), Gravity.CENTER);
        bottomBar.addView(shutterButton, shutterParams);

        flipButton = iconButton("⇄", 58, 24);
        flipButton.setOnClickListener((view) -> flipCamera());
        FrameLayout.LayoutParams flipParams = new FrameLayout.LayoutParams(dp(58), dp(58), Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        bottomBar.addView(flipButton, flipParams);

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
            scaleGestureDetector = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                @Override
                public boolean onScaleBegin(ScaleGestureDetector detector) {
                    pinchStartZoomRatio = currentZoomRatio;
                    return true;
                }

                @Override
                public boolean onScale(ScaleGestureDetector detector) {
                    setNativeZoomRatio(pinchStartZoomRatio * detector.getScaleFactor());
                    return true;
                }
            });
            previewView.setOnTouchListener((view, event) -> handlePreviewTouch(event));
            cameraController.getZoomState().observe(this, this::updateZoomState);
            setStatus("相机已开启");
        } catch (Exception error) {
            setStatus(error.getMessage() != null ? error.getMessage() : "无法打开原生相机");
        }
    }

    private boolean handlePreviewTouch(MotionEvent event) {
        if (scaleGestureDetector != null) {
            scaleGestureDetector.onTouchEvent(event);
        }
        if (event.getPointerCount() > 1) {
            previewHadMultiTouch = true;
        }
        if (event.getAction() == MotionEvent.ACTION_UP && event.getPointerCount() == 1 && !previewHadMultiTouch) {
            focusAt(event.getX(), event.getY());
        }
        if (event.getAction() == MotionEvent.ACTION_UP || event.getAction() == MotionEvent.ACTION_CANCEL) {
            previewHadMultiTouch = false;
        }
        return true;
    }

    private void focusAt(float x, float y) {
        showFocusRing(x, y);
        if (cameraController == null || previewView == null) {
            return;
        }
        try {
            MeteringPointFactory factory = previewView.getMeteringPointFactory();
            MeteringPoint point = factory.createPoint(x, y);
            FocusMeteringAction action = new FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF)
                .addPoint(point, FocusMeteringAction.FLAG_AE)
                .setAutoCancelDuration(3, TimeUnit.SECONDS)
                .build();
            cameraController.getCameraControl().startFocusAndMetering(action);
        } catch (Exception ignored) {
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
                            setRecordingUi(true);
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
        setRecordingUi(false);
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
        if (torchButton != null) {
            torchButton.setText("⚡");
            torchButton.setTextColor(torchEnabled ? Color.rgb(255, 214, 82) : Color.WHITE);
            torchButton.setBackground(circleDrawable(
                torchEnabled ? Color.argb(58, 255, 214, 82) : Color.argb(56, 0, 0, 0),
                torchEnabled ? Color.argb(180, 255, 214, 82) : Color.argb(62, 255, 255, 255),
                1
            ));
        }
    }

    private void updateZoomState(ZoomState zoomState) {
        if (zoomState == null) {
            return;
        }
        currentZoomRatio = zoomState.getZoomRatio();
        maxZoomRatio = Math.max(1f, zoomState.getMaxZoomRatio());
        if (zoomText != null) {
            zoomText.setText(formatZoom(currentZoomRatio));
        }
        buildZoomButtons();
    }

    private void buildZoomButtons() {
        if (zoomStrip == null) {
            return;
        }
        zoomStrip.removeAllViews();
        for (float zoom : QUICK_ZOOMS) {
            if (zoom > maxZoomRatio + 0.05f && zoom > 1f) {
                continue;
            }
            TextView button = zoomButton(zoom);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(isActiveZoom(zoom) ? 48 : 42), dp(34));
            params.setMargins(dp(3), 0, dp(3), 0);
            zoomStrip.addView(button, params);
        }
    }

    private TextView zoomButton(float zoom) {
        boolean active = isActiveZoom(zoom);
        TextView button = new TextView(this);
        button.setText(formatZoom(zoom));
        button.setTextSize(active ? 12 : 11);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setTextColor(active ? Color.BLACK : Color.WHITE);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(pillDrawable(active ? Color.WHITE : Color.TRANSPARENT, Color.argb(active ? 0 : 70, 255, 255, 255), 1));
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
        params.leftMargin = Math.max(0, Math.round(x - dp(39)));
        params.topMargin = Math.max(0, Math.round(y - dp(39)));
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
        int rounded = Math.round(value);
        if (Math.abs(value - rounded) < 0.06f) {
            return String.format(Locale.US, "%dx", rounded);
        }
        return String.format(Locale.US, "%.1fx", value);
    }

    private void enableFullscreenLayout() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.BLACK);
        window.getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private TextView iconButton(String text, int sizeDp, int textSizeSp) {
        TextView button = new TextView(this);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(textSizeSp);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, dp(1));
        button.setMinWidth(dp(sizeDp));
        button.setMinHeight(dp(sizeDp));
        button.setBackground(circleDrawable(Color.argb(56, 0, 0, 0), Color.argb(62, 255, 255, 255), 1));
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    private void setRecordingUi(boolean recording) {
        if (recordingBadge != null) {
            recordingBadge.setVisibility(recording ? View.VISIBLE : View.GONE);
        }
        if (shutterButton != null) {
            shutterButton.setBackground(circleDrawable(
                Color.TRANSPARENT,
                recording ? Color.argb(235, 248, 113, 113) : Color.argb(240, 255, 255, 255),
                recording ? 3 : 4
            ));
        }
        if (shutterCore != null) {
            shutterCore.setBackground(circleDrawable(
                recording ? Color.rgb(220, 38, 38) : Color.WHITE,
                Color.TRANSPARENT,
                0
            ));
        }
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
