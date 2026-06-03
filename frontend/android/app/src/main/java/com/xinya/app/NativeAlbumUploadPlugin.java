package com.xinya.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Range;
import android.util.Size;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(name = "NativeAlbumUpload")
public class NativeAlbumUploadPlugin extends Plugin {

    private static final String DEFAULT_BASE_URL = "https://utbabuddha.com";
    private static final String[] ACCEPTED_MIME_TYPES = new String[] {
        "image/*",
        "video/*"
    };

    private Uri pendingCaptureUri;
    private File pendingCaptureFile;
    private String pendingCaptureMimeType;
    private String pendingCaptureName;
    private Integer previousRequestedOrientation;

    @PluginMethod
    public void pickAndUpload(PluginCall call) {
        Integer eventId = call.getInt("eventId");
        String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
        if (eventId == null || eventId <= 0) {
            call.reject("eventId is required");
            return;
        }
        if (baseUrl.isEmpty()) {
            call.reject("baseUrl is required");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_MIME_TYPES, ACCEPTED_MIME_TYPES);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "handlePickedFiles");
    }

    @PluginMethod
    public void captureAndUpload(PluginCall call) {
        Integer eventId = call.getInt("eventId");
        String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
        String mediaType = call.getString("mediaType", "image");
        if (eventId == null || eventId <= 0) {
            call.reject("eventId is required");
            return;
        }
        if (baseUrl.isEmpty()) {
            call.reject("baseUrl is required");
            return;
        }

        boolean captureVideo = "video".equalsIgnoreCase(mediaType);
        try {
            File captureFile = createCaptureFile(captureVideo);
            Uri captureUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                captureFile
            );
            Intent intent = new Intent(captureVideo ? MediaStore.ACTION_VIDEO_CAPTURE : MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
            intent.setClipData(ClipData.newRawUri("capture", captureUri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                deleteQuietly(captureFile);
                call.reject("Camera is unavailable");
                return;
            }

            pendingCaptureUri = captureUri;
            pendingCaptureFile = captureFile;
            pendingCaptureMimeType = captureVideo ? "video/mp4" : "image/jpeg";
            pendingCaptureName = captureFile.getName();
            startActivityForResult(call, intent, "handleCapturedFile");
        } catch (Exception error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "Unable to open camera");
        }
    }

    @ActivityCallback
    private void handlePickedFiles(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(statusToJSObject(NativeAlbumUploadStore.idleStatus()));
            return;
        }

        try {
            Intent data = result.getData();
            Set<Uri> uris = extractUris(data);
            if (uris.isEmpty()) {
                call.resolve(statusToJSObject(NativeAlbumUploadStore.idleStatus()));
                return;
            }

            Integer eventIdValue = call.getInt("eventId");
            int eventId = eventIdValue != null ? eventIdValue : 0;
            String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
            JSONArray items = new JSONArray();
            for (Uri uri : uris) {
                persistReadPermission(uri);
                items.put(buildItem(uri));
            }

            enqueueUpload(call, eventId, baseUrl, items);
        } catch (Exception error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "Native album upload failed");
        }
    }

    @ActivityCallback
    private void handleCapturedFile(PluginCall call, ActivityResult result) {
        if (call == null) {
            clearPendingCapture(false);
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK) {
            clearPendingCapture(true);
            call.resolve(statusToJSObject(NativeAlbumUploadStore.idleStatus()));
            return;
        }

        try {
            Uri uri = result.getData() != null && result.getData().getData() != null
                ? result.getData().getData()
                : pendingCaptureUri;
            if (uri == null) {
                clearPendingCapture(true);
                call.resolve(statusToJSObject(NativeAlbumUploadStore.idleStatus()));
                return;
            }

            Integer eventIdValue = call.getInt("eventId");
            int eventId = eventIdValue != null ? eventIdValue : 0;
            String baseUrl = normalizeBaseUrl(call.getString("baseUrl", ""));
            JSONArray items = new JSONArray();
            items.put(buildCapturedItem(uri));
            clearPendingCapture(false);
            enqueueUpload(call, eventId, baseUrl, items);
        } catch (Exception error) {
            clearPendingCapture(true);
            call.reject(error.getMessage() != null ? error.getMessage() : "Native album capture failed");
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        String jobId = call.getString("jobId", "");
        call.resolve(statusToJSObject(NativeAlbumUploadStore.readStatus(getContext(), jobId)));
    }

    @PluginMethod
    public void setCameraOrientationLock(PluginCall call) {
        boolean locked = Boolean.TRUE.equals(call.getBoolean("locked", false));
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is unavailable");
            return;
        }

        activity.runOnUiThread(() -> {
            if (locked) {
                if (previousRequestedOrientation == null) {
                    previousRequestedOrientation = activity.getRequestedOrientation();
                }
                activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            } else {
                int restoreOrientation = previousRequestedOrientation != null
                    ? previousRequestedOrientation
                    : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
                previousRequestedOrientation = null;
                activity.setRequestedOrientation(restoreOrientation);
            }
            JSObject result = new JSObject();
            updateStatus(result, "locked", locked);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String jobId = call.getString("jobId", "");
        JSONObject status = NativeAlbumUploadStore.readStatus(getContext(), jobId);
        String resolvedJobId = status.optString("jobId", jobId);
        if (!resolvedJobId.trim().isEmpty()) {
            updateStatus(status, "status", "canceled");
            updateStatus(status, "error", "已取消");
            NativeAlbumUploadStore.writeStatus(getContext(), status);

            Intent intent = new Intent(getContext(), NativeAlbumUploadService.class);
            intent.setAction(NativeAlbumUploadService.ACTION_CANCEL);
            intent.putExtra(NativeAlbumUploadService.EXTRA_JOB_ID, resolvedJobId);
            try {
                getContext().startService(intent);
            } catch (Exception ignored) {
            }
        }
        call.resolve(statusToJSObject(status));
    }

    @PluginMethod
    public void getCameraProfile(PluginCall call) {
        JSObject profile = new JSObject();
        String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
        String brand = Build.BRAND != null ? Build.BRAND : "";
        String model = Build.MODEL != null ? Build.MODEL : "";
        boolean isSamsung = "samsung".equalsIgnoreCase(manufacturer) || "samsung".equalsIgnoreCase(brand);
        PackageManager packageManager = getContext().getPackageManager();

        updateStatus(profile, "manufacturer", manufacturer);
        updateStatus(profile, "brand", brand);
        updateStatus(profile, "model", model);
        updateStatus(profile, "sdkInt", Build.VERSION.SDK_INT);
        updateStatus(profile, "isSamsung", isSamsung);
        updateStatus(profile, "isEmulator", isLikelyEmulator());
        updateStatus(profile, "hasCamera", packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY));
        updateStatus(profile, "hasBackCamera", packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA));
        updateStatus(profile, "hasFrontCamera", packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT));
        updateStatus(profile, "recommendedPhotoMaxWidth", isSamsung ? 1920 : 2560);
        updateStatus(profile, "recommendedPhotoQuality", isSamsung ? 0.88 : 0.9);
        updateStatus(profile, "recommendedVideoWidth", isSamsung ? 1280 : 1920);
        updateStatus(profile, "recommendedVideoHeight", isSamsung ? 720 : 1080);
        updateStatus(profile, "recommendedFrameRate", 30);

        CameraCapabilitySummary summary = readCameraCapabilities();
        updateStatus(profile, "supportsCamera2", summary.supportsCamera2);
        updateStatus(profile, "backCameraCount", summary.backCameraCount);
        updateStatus(profile, "frontCameraCount", summary.frontCameraCount);
        updateStatus(profile, "externalCameraCount", summary.externalCameraCount);
        updateStatus(profile, "hasFlash", summary.hasFlash);
        updateStatus(profile, "hasOpticalStabilization", summary.hasOpticalStabilization);
        updateStatus(profile, "hasVideoStabilization", summary.hasVideoStabilization);
        updateStatus(profile, "supportsHighSpeedVideo", summary.supportsHighSpeedVideo);
        updateStatus(profile, "maxPhotoWidth", summary.maxPhotoWidth);
        updateStatus(profile, "maxPhotoHeight", summary.maxPhotoHeight);
        updateStatus(profile, "maxVideoWidth", summary.maxVideoWidth);
        updateStatus(profile, "maxVideoHeight", summary.maxVideoHeight);
        updateStatus(profile, "hardwareLevels", summary.hardwareLevels);
        updateStatus(profile, "cameras", summary.cameras);
        updateStatus(profile, "samsungEnhancedMode", isSamsung && summary.supportsCamera2 && summary.backCameraCount > 0);
        call.resolve(profile);
    }

    private Set<Uri> extractUris(Intent data) {
        Set<Uri> uris = new LinkedHashSet<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int index = 0; index < clipData.getItemCount(); index += 1) {
                Uri uri = clipData.getItemAt(index).getUri();
                if (uri != null) {
                    uris.add(uri);
                }
            }
        }
        Uri singleUri = data.getData();
        if (singleUri != null) {
            uris.add(singleUri);
        }
        return uris;
    }

    private void persistReadPermission(Uri uri) {
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // Some providers expose temporary read grants only; the foreground service starts immediately.
        }
    }

    private JSONObject buildItem(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        JSONObject item = new JSONObject();
        String name = "";
        long size = -1L;

        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, new String[] {
                OpenableColumns.DISPLAY_NAME,
                OpenableColumns.SIZE
            }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex >= 0) {
                    name = cursor.getString(nameIndex);
                }
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeIndex >= 0) {
                    size = cursor.getLong(sizeIndex);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        if (name == null || name.trim().isEmpty()) {
            name = uri.getLastPathSegment();
        }
        if (name == null || name.trim().isEmpty()) {
            name = "media";
        }

        String mimeType = resolver.getType(uri);
        if (mimeType == null || mimeType.trim().isEmpty()) {
            mimeType = "application/octet-stream";
        }

        updateStatus(item, "uri", uri.toString());
        updateStatus(item, "name", name);
        updateStatus(item, "mimeType", mimeType);
        updateStatus(item, "size", size);
        return item;
    }

    private JSONObject buildCapturedItem(Uri uri) {
        JSONObject item = buildItem(uri);
        if (pendingCaptureName != null && !pendingCaptureName.trim().isEmpty()) {
            updateStatus(item, "name", pendingCaptureName);
        }
        if (pendingCaptureMimeType != null && !pendingCaptureMimeType.trim().isEmpty()) {
            updateStatus(item, "mimeType", pendingCaptureMimeType);
        }
        if (pendingCaptureFile != null) {
            updateStatus(item, "size", pendingCaptureFile.length());
            updateStatus(item, "localPath", pendingCaptureFile.getAbsolutePath());
        }
        return item;
    }

    private void enqueueUpload(PluginCall call, int eventId, String baseUrl, JSONArray items) {
        String jobId = UUID.randomUUID().toString();
        JSONObject status = newStatus(jobId, eventId, items.length());
        NativeAlbumUploadStore.writeStatus(getContext(), status);

        String authorization = NativeAuthSessionStore.getAuthorizationHeader(getContext());
        String cookie = authorization == null || authorization.trim().isEmpty()
            ? getCookieHeader(baseUrl)
            : null;

        Intent serviceIntent = new Intent(getContext(), NativeAlbumUploadService.class);
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
        ContextCompat.startForegroundService(getContext(), serviceIntent);
        call.resolve(statusToJSObject(NativeAlbumUploadStore.readStatus(getContext(), jobId)));
    }

    private File createCaptureFile(boolean video) throws Exception {
        File captureDir = new File(getContext().getCacheDir(), "album-capture");
        if (!captureDir.exists() && !captureDir.mkdirs()) {
            throw new IllegalStateException("Unable to prepare camera cache");
        }
        String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        String prefix = video ? "video_" : "photo_";
        String extension = video ? ".mp4" : ".jpg";
        File file = new File(captureDir, prefix + timestamp + "_" + UUID.randomUUID().toString() + extension);
        if (!file.createNewFile()) {
            throw new IllegalStateException("Unable to create camera file");
        }
        return file;
    }

    private void clearPendingCapture(boolean deleteFile) {
        if (deleteFile && pendingCaptureFile != null) {
            deleteQuietly(pendingCaptureFile);
        }
        pendingCaptureUri = null;
        pendingCaptureFile = null;
        pendingCaptureMimeType = null;
        pendingCaptureName = null;
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

    private JSObject statusToJSObject(JSONObject status) {
        try {
            return JSObject.fromJSONObject(status != null ? status : NativeAlbumUploadStore.idleStatus());
        } catch (Exception ignored) {
            return new JSObject();
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
            normalized = DEFAULT_BASE_URL;
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private CameraCapabilitySummary readCameraCapabilities() {
        CameraCapabilitySummary summary = new CameraCapabilitySummary();
        try {
            CameraManager cameraManager = (CameraManager) getContext().getSystemService(Activity.CAMERA_SERVICE);
            if (cameraManager == null) {
                return summary;
            }

            for (String cameraId : cameraManager.getCameraIdList()) {
                CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
                JSObject camera = new JSObject();
                updateStatus(camera, "id", cameraId);

                Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                String facingName = cameraFacingName(facing);
                updateStatus(camera, "facing", facingName);
                if ("back".equals(facingName)) {
                    summary.backCameraCount += 1;
                } else if ("front".equals(facingName)) {
                    summary.frontCameraCount += 1;
                } else if ("external".equals(facingName)) {
                    summary.externalCameraCount += 1;
                }

                Integer hardwareLevel = characteristics.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL);
                String hardwareLevelName = cameraHardwareLevelName(hardwareLevel);
                updateStatus(camera, "hardwareLevel", hardwareLevelName);
                if (hardwareLevelName.length() > 0) {
                    summary.hardwareLevels.put(hardwareLevelName);
                }
                if (hardwareLevel != null && hardwareLevel != CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY) {
                    summary.supportsCamera2 = true;
                }

                Boolean flashAvailable = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                boolean hasFlash = flashAvailable != null && flashAvailable;
                updateStatus(camera, "hasFlash", hasFlash);
                summary.hasFlash = summary.hasFlash || hasFlash;

                boolean hasOpticalStabilization = intArrayContains(
                    characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION),
                    CameraCharacteristics.LENS_OPTICAL_STABILIZATION_MODE_ON
                );
                boolean hasVideoStabilization = intArrayContains(
                    characteristics.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES),
                    CameraCharacteristics.CONTROL_VIDEO_STABILIZATION_MODE_ON
                );
                updateStatus(camera, "hasOpticalStabilization", hasOpticalStabilization);
                updateStatus(camera, "hasVideoStabilization", hasVideoStabilization);
                summary.hasOpticalStabilization = summary.hasOpticalStabilization || hasOpticalStabilization;
                summary.hasVideoStabilization = summary.hasVideoStabilization || hasVideoStabilization;

                StreamConfigurationMap streamMap = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                if (streamMap != null) {
                    Size maxPhotoSize = maxSize(streamMap.getOutputSizes(ImageFormat.JPEG));
                    Size maxVideoSize = maxSize(streamMap.getOutputSizes(MediaRecorder.class));
                    if (maxPhotoSize != null) {
                        updateStatus(camera, "maxPhotoWidth", maxPhotoSize.getWidth());
                        updateStatus(camera, "maxPhotoHeight", maxPhotoSize.getHeight());
                        summary.maxPhotoWidth = Math.max(summary.maxPhotoWidth, maxPhotoSize.getWidth());
                        summary.maxPhotoHeight = Math.max(summary.maxPhotoHeight, maxPhotoSize.getHeight());
                    }
                    if (maxVideoSize != null) {
                        updateStatus(camera, "maxVideoWidth", maxVideoSize.getWidth());
                        updateStatus(camera, "maxVideoHeight", maxVideoSize.getHeight());
                        summary.maxVideoWidth = Math.max(summary.maxVideoWidth, maxVideoSize.getWidth());
                        summary.maxVideoHeight = Math.max(summary.maxVideoHeight, maxVideoSize.getHeight());
                    }
                    boolean supportsHighSpeedVideo = streamMap.getHighSpeedVideoSizes().length > 0;
                    updateStatus(camera, "supportsHighSpeedVideo", supportsHighSpeedVideo);
                    summary.supportsHighSpeedVideo = summary.supportsHighSpeedVideo || supportsHighSpeedVideo;
                }

                Range<Integer>[] fpsRanges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES);
                if (fpsRanges != null && fpsRanges.length > 0) {
                    JSONArray ranges = new JSONArray();
                    for (Range<Integer> range : fpsRanges) {
                        JSObject fps = new JSObject();
                        updateStatus(fps, "min", range.getLower());
                        updateStatus(fps, "max", range.getUpper());
                        ranges.put(fps);
                    }
                    updateStatus(camera, "fpsRanges", ranges);
                }

                summary.cameras.put(camera);
            }
        } catch (Exception ignored) {
        }
        return summary;
    }

    private boolean isLikelyEmulator() {
        String fingerprint = Build.FINGERPRINT != null ? Build.FINGERPRINT.toLowerCase(Locale.US) : "";
        String model = Build.MODEL != null ? Build.MODEL.toLowerCase(Locale.US) : "";
        String product = Build.PRODUCT != null ? Build.PRODUCT.toLowerCase(Locale.US) : "";
        String hardware = Build.HARDWARE != null ? Build.HARDWARE.toLowerCase(Locale.US) : "";
        return fingerprint.contains("generic")
            || fingerprint.contains("unknown")
            || model.contains("google_sdk")
            || model.contains("emulator")
            || model.contains("android sdk built for")
            || product.contains("sdk")
            || product.contains("emulator")
            || hardware.contains("goldfish")
            || hardware.contains("ranchu");
    }

    private String cameraFacingName(Integer facing) {
        if (facing == null) {
            return "";
        }
        if (facing == CameraCharacteristics.LENS_FACING_BACK) {
            return "back";
        }
        if (facing == CameraCharacteristics.LENS_FACING_FRONT) {
            return "front";
        }
        if (facing == CameraCharacteristics.LENS_FACING_EXTERNAL) {
            return "external";
        }
        return "unknown";
    }

    private String cameraHardwareLevelName(Integer hardwareLevel) {
        if (hardwareLevel == null) {
            return "";
        }
        if (hardwareLevel == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY) {
            return "legacy";
        }
        if (hardwareLevel == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED) {
            return "limited";
        }
        if (hardwareLevel == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL) {
            return "full";
        }
        if (hardwareLevel == CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3) {
            return "level_3";
        }
        return "unknown";
    }

    private boolean intArrayContains(int[] values, int target) {
        if (values == null) {
            return false;
        }
        for (int value : values) {
            if (value == target) {
                return true;
            }
        }
        return false;
    }

    private Size maxSize(Size[] sizes) {
        if (sizes == null || sizes.length == 0) {
            return null;
        }
        Size best = null;
        long bestPixels = -1L;
        for (Size size : sizes) {
            if (size == null) {
                continue;
            }
            long pixels = (long) size.getWidth() * (long) size.getHeight();
            if (pixels > bestPixels) {
                best = size;
                bestPixels = pixels;
            }
        }
        return best;
    }

    private static final class CameraCapabilitySummary {
        boolean supportsCamera2 = false;
        int backCameraCount = 0;
        int frontCameraCount = 0;
        int externalCameraCount = 0;
        boolean hasFlash = false;
        boolean hasOpticalStabilization = false;
        boolean hasVideoStabilization = false;
        boolean supportsHighSpeedVideo = false;
        int maxPhotoWidth = 0;
        int maxPhotoHeight = 0;
        int maxVideoWidth = 0;
        int maxVideoHeight = 0;
        final JSONArray hardwareLevels = new JSONArray();
        final JSONArray cameras = new JSONArray();
    }
}
