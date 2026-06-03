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
import android.view.OrientationEventListener;
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
import androidx.camera.core.AspectRatio;
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
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
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
    private static final AspectMode[] ASPECT_MODES = new AspectMode[] {
        new AspectMode("Full", 0, 0, null),
        new AspectMode("19:10", 10, 19, null),
        new AspectMode("16:9", 9, 16, AspectRatio.RATIO_16_9),
        new AspectMode("4:3", 3, 4, AspectRatio.RATIO_4_3)
    };

    private static final class AspectMode {
        final String label;
        final int portraitWidth;
        final int portraitHeight;
        final Integer cameraXAspectRatio;

        AspectMode(String label, int portraitWidth, int portraitHeight, Integer cameraXAspectRatio) {
            this.label = label;
            this.portraitWidth = portraitWidth;
            this.portraitHeight = portraitHeight;
            this.cameraXAspectRatio = cameraXAspectRatio;
        }
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<TextView> rotatingTextViews = new ArrayList<>();

    private FrameLayout rootLayout;
    private OrientationEventListener orientationEventListener;
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
    private LinearLayout aspectStrip;
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
    private boolean globalPinchInProgress = false;
    private int zoomButtonMask = -1;
    private CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;
    private AspectMode selectedAspectMode = ASPECT_MODES[0];
    private int controlsRotationDegrees = 0;

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
        setupOrientationListener();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            requestPermissions(new String[] { Manifest.permission.CAMERA }, REQUEST_CAMERA_PERMISSION);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (orientationEventListener != null && orientationEventListener.canDetectOrientation()) {
            orientationEventListener.enable();
        }
    }

    @Override
    protected void onPause() {
        if (orientationEventListener != null) {
            orientationEventListener.disable();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        stopVideoRecording();
        if (cameraController != null) {
            cameraController.unbind();
        }
        if (orientationEventListener != null) {
            orientationEventListener.disable();
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
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (scaleGestureDetector != null) {
            scaleGestureDetector.onTouchEvent(event);
        }
        if (event.getPointerCount() > 1) {
            globalPinchInProgress = true;
            previewHadMultiTouch = true;
            return true;
        }
        if (globalPinchInProgress) {
            if (event.getAction() == MotionEvent.ACTION_UP || event.getAction() == MotionEvent.ACTION_CANCEL) {
                globalPinchInProgress = false;
                previewHadMultiTouch = false;
            }
            return true;
        }
        return super.dispatchTouchEvent(event);
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

    private void setupOrientationListener() {
        orientationEventListener = new OrientationEventListener(this) {
            @Override
            public void onOrientationChanged(int orientation) {
                if (orientation == OrientationEventListener.ORIENTATION_UNKNOWN) {
                    return;
                }
                int nextRotation = controlRotationForOrientation(orientation);
                if (nextRotation != controlsRotationDegrees) {
                    controlsRotationDegrees = nextRotation;
                    applyControlsRotation();
                }
            }
        };
    }

    private int controlRotationForOrientation(int orientation) {
        int deviceRotation;
        if (orientation < 45 || orientation >= 315) {
            deviceRotation = 0;
        } else if (orientation < 135) {
            deviceRotation = 90;
        } else if (orientation < 225) {
            deviceRotation = 180;
        } else {
            deviceRotation = 270;
        }
        return (360 - deviceRotation) % 360;
    }

    private void registerRotatingTextView(TextView view) {
        if (view == null || rotatingTextViews.contains(view)) {
            return;
        }
        rotatingTextViews.add(view);
        view.setRotation(controlsRotationDegrees);
    }

    private void unregisterRotatingChildren(ViewGroup group) {
        if (group == null) {
            return;
        }
        for (int index = 0; index < group.getChildCount(); index += 1) {
            View child = group.getChildAt(index);
            if (child instanceof TextView) {
                rotatingTextViews.remove(child);
            } else if (child instanceof ViewGroup) {
                unregisterRotatingChildren((ViewGroup) child);
            }
        }
    }

    private void applyControlsRotation() {
        for (int index = rotatingTextViews.size() - 1; index >= 0; index -= 1) {
            TextView view = rotatingTextViews.get(index);
            if (view == null || view.getParent() == null) {
                rotatingTextViews.remove(index);
                continue;
            }
            view.animate().rotation(controlsRotationDegrees).setDuration(140).start();
        }
    }

    private void buildUi() {
        enableFullscreenLayout();

        FrameLayout root = new FrameLayout(this);
        rootLayout = root;
        root.setBackgroundColor(Color.BLACK);
        root.setClipChildren(false);
        root.setClipToPadding(false);

        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        focusRing = new TextView(this);
        focusRing.setText("");
        focusRing.setVisibility(View.GONE);
        focusRing.setBackground(circleDrawable(Color.TRANSPARENT, Color.argb(235, 255, 214, 82), 2));
        root.addView(focusRing, new FrameLayout.LayoutParams(dp(78), dp(78), Gravity.TOP | Gravity.START));

        FrameLayout topBar = new FrameLayout(this);
        topBar.setPadding(dp(18), dp(34), dp(18), 0);
        topBar.setClipChildren(false);
        topBar.setClipToPadding(false);
        root.addView(topBar, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(166),
            Gravity.TOP
        ));

        TextView closeButton = iconButton("×", 46, 26);
        registerRotatingTextView(closeButton);
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
        statusText.setBackground(pillDrawable(Color.argb(64, 0, 0, 0), Color.TRANSPARENT, 0));
        statusText.setText(eventName != null && !eventName.trim().isEmpty() ? eventName : "相机");
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
        registerRotatingTextView(counterText);
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
        registerRotatingTextView(recordingBadge);
        FrameLayout.LayoutParams recordingParams = new FrameLayout.LayoutParams(dp(62), dp(30), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        recordingParams.setMargins(0, dp(54), 0, 0);
        topBar.addView(recordingBadge, recordingParams);

        aspectStrip = new LinearLayout(this);
        aspectStrip.setOrientation(LinearLayout.HORIZONTAL);
        aspectStrip.setGravity(Gravity.CENTER);
        aspectStrip.setPadding(0, 0, 0, 0);
        aspectStrip.setClipChildren(false);
        aspectStrip.setClipToPadding(false);
        FrameLayout.LayoutParams aspectParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dp(40),
            Gravity.TOP | Gravity.CENTER_HORIZONTAL
        );
        aspectParams.setMargins(0, dp(92), 0, 0);
        topBar.addView(aspectStrip, aspectParams);
        buildAspectButtons();

        zoomStrip = new LinearLayout(this);
        zoomStrip.setOrientation(LinearLayout.HORIZONTAL);
        zoomStrip.setGravity(Gravity.CENTER);
        zoomStrip.setPadding(dp(5), dp(5), dp(5), dp(5));
        zoomStrip.setClipChildren(false);
        zoomStrip.setClipToPadding(false);
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
        bottomBar.setClipChildren(false);
        bottomBar.setClipToPadding(false);
        root.addView(bottomBar, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(132),
            Gravity.BOTTOM
        ));

        torchButton = iconButton("⚡", 58, 22);
        registerRotatingTextView(torchButton);
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
        registerRotatingTextView(flipButton);
        flipButton.setOnClickListener((view) -> flipCamera());
        FrameLayout.LayoutParams flipParams = new FrameLayout.LayoutParams(dp(58), dp(58), Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        bottomBar.addView(flipButton, flipParams);

        setContentView(root);
        root.post(this::applyAspectModeLayout);
    }

    private void startCamera() {
        try {
            cameraController = new LifecycleCameraController(this);
            cameraController.setEnabledUseCases(CameraController.IMAGE_CAPTURE | CameraController.VIDEO_CAPTURE);
            cameraController.setCameraSelector(cameraSelector);
            cameraController.setPinchToZoomEnabled(false);
            cameraController.setTapToFocusEnabled(true);
            applyCameraTargetAspect();
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
                    float nextZoom = Math.max(1f, Math.min(maxZoomRatio, pinchStartZoomRatio * detector.getScaleFactor()));
                    pinchStartZoomRatio = nextZoom;
                    setNativeZoomRatio(nextZoom);
                    return true;
                }
            });
            previewView.setOnTouchListener((view, event) -> handlePreviewTouch(event));
            cameraController.getZoomState().observe(this, this::updateZoomState);
        } catch (Exception error) {
            setStatus(error.getMessage() != null ? error.getMessage() : "无法打开原生相机");
        }
    }

    private boolean handlePreviewTouch(MotionEvent event) {
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
        showFocusRingAtPreviewPoint(x, y);
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

    private void showFocusRingAtPreviewPoint(float x, float y) {
        if (previewView == null || rootLayout == null) {
            showFocusRing(x, y);
            return;
        }
        int[] previewLocation = new int[2];
        int[] rootLocation = new int[2];
        previewView.getLocationOnScreen(previewLocation);
        rootLayout.getLocationOnScreen(rootLocation);
        float rootX = previewLocation[0] - rootLocation[0] + x;
        float rootY = previewLocation[1] - rootLocation[1] + y;
        showFocusRing(rootX, rootY);
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
        updateZoomButtons();
    }

    private void buildZoomButtons() {
        if (zoomStrip == null) {
            return;
        }
        zoomButtonMask = -1;
        updateZoomButtons();
    }

    private void updateZoomButtons() {
        if (zoomStrip == null) {
            return;
        }
        int nextMask = supportedZoomButtonMask();
        if (nextMask != zoomButtonMask) {
            rebuildZoomButtons(nextMask);
            return;
        }
        for (int index = 0; index < zoomStrip.getChildCount(); index += 1) {
            View child = zoomStrip.getChildAt(index);
            Object tag = child.getTag();
            if (child instanceof TextView && tag instanceof Float) {
                styleZoomButton((TextView) child, (Float) tag);
            }
        }
    }

    private int supportedZoomButtonMask() {
        int mask = 0;
        for (int index = 0; index < QUICK_ZOOMS.length; index += 1) {
            float zoom = QUICK_ZOOMS[index];
            if (zoom <= maxZoomRatio + 0.05f || zoom <= 1f) {
                mask |= (1 << index);
            }
        }
        return mask;
    }

    private void rebuildZoomButtons(int nextMask) {
        unregisterRotatingChildren(zoomStrip);
        zoomStrip.removeAllViews();
        zoomButtonMask = nextMask;
        for (int index = 0; index < QUICK_ZOOMS.length; index += 1) {
            if ((nextMask & (1 << index)) == 0) {
                continue;
            }
            float zoom = QUICK_ZOOMS[index];
            TextView button = zoomButton(zoom);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(48), dp(34));
            params.setMargins(dp(3), 0, dp(3), 0);
            zoomStrip.addView(button, params);
        }
    }

    private TextView zoomButton(float zoom) {
        TextView button = new TextView(this);
        button.setTag(zoom);
        button.setText(formatZoom(zoom));
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setOnClickListener((view) -> setNativeZoomRatio(zoom));
        registerRotatingTextView(button);
        styleZoomButton(button, zoom);
        return button;
    }

    private void styleZoomButton(TextView button, float zoom) {
        boolean active = isActiveZoom(zoom);
        button.setTextSize(active ? 12 : 11);
        button.setTextColor(active ? Color.BLACK : Color.WHITE);
        button.setBackground(pillDrawable(active ? Color.WHITE : Color.TRANSPARENT, Color.argb(active ? 0 : 70, 255, 255, 255), 1));
    }

    private void buildAspectButtons() {
        if (aspectStrip == null) {
            return;
        }
        unregisterRotatingChildren(aspectStrip);
        aspectStrip.removeAllViews();
        for (AspectMode mode : ASPECT_MODES) {
            TextView button = aspectButton(mode);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(mode == selectedAspectMode ? 66 : 60), dp(38));
            params.setMargins(dp(4), 0, dp(4), 0);
            aspectStrip.addView(button, params);
        }
    }

    private TextView aspectButton(AspectMode mode) {
        boolean active = mode == selectedAspectMode;
        TextView button = new TextView(this);
        button.setText(mode.label);
        button.setTextSize(active ? 12 : 11);
        button.setIncludeFontPadding(false);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setTextColor(active ? Color.BLACK : Color.WHITE);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(pillDrawable(active ? Color.WHITE : Color.argb(72, 0, 0, 0), Color.argb(active ? 0 : 64, 255, 255, 255), 1));
        button.setOnClickListener((view) -> switchAspectMode(mode));
        registerRotatingTextView(button);
        return button;
    }

    private void switchAspectMode(AspectMode mode) {
        if (mode == null || mode == selectedAspectMode) {
            return;
        }
        if (activeRecording != null) {
            setStatus("录像中不能切换比例");
            return;
        }
        selectedAspectMode = mode;
        buildAspectButtons();
        applyAspectModeLayout();
        applyCameraTargetAspect();
    }

    private void applyAspectModeLayout() {
        if (rootLayout == null || previewView == null) {
            return;
        }
        int rootWidth = rootLayout.getWidth();
        int rootHeight = rootLayout.getHeight();
        if (rootWidth <= 0 || rootHeight <= 0) {
            rootLayout.post(this::applyAspectModeLayout);
            return;
        }

        FrameLayout.LayoutParams params;
        if (selectedAspectMode.portraitWidth <= 0 || selectedAspectMode.portraitHeight <= 0) {
            params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            );
        } else {
            int targetWidth = rootWidth;
            int targetHeight = Math.round(targetWidth * (selectedAspectMode.portraitHeight / (float) selectedAspectMode.portraitWidth));
            if (targetHeight > rootHeight) {
                targetHeight = rootHeight;
                targetWidth = Math.round(targetHeight * (selectedAspectMode.portraitWidth / (float) selectedAspectMode.portraitHeight));
            }
            params = new FrameLayout.LayoutParams(targetWidth, targetHeight, Gravity.CENTER);
        }
        previewView.setLayoutParams(params);
    }

    private void applyCameraTargetAspect() {
        if (cameraController == null) {
            return;
        }
        int targetAspectRatio = selectedAspectMode.cameraXAspectRatio != null
            ? selectedAspectMode.cameraXAspectRatio
            : AspectRatio.RATIO_16_9;
        try {
            CameraController.OutputSize outputSize = new CameraController.OutputSize(targetAspectRatio);
            cameraController.setPreviewTargetSize(outputSize);
            cameraController.setImageCaptureTargetSize(outputSize);
        } catch (Exception error) {
            setStatus("当前比例不可用");
        }
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
            currentZoomRatio = nextZoom;
            updateZoomButtons();
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
        int ringRadius = dp(39);
        int maxLeft = rootLayout != null ? Math.max(0, rootLayout.getWidth() - dp(78)) : Integer.MAX_VALUE;
        int maxTop = rootLayout != null ? Math.max(0, rootLayout.getHeight() - dp(78)) : Integer.MAX_VALUE;
        params.leftMargin = Math.min(maxLeft, Math.max(0, Math.round(x - ringRadius)));
        params.topMargin = Math.min(maxTop, Math.max(0, Math.round(y - ringRadius)));
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
            statusText.setText(text != null && !text.trim().isEmpty() ? text : "相机");
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
