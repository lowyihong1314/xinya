import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { CachedImage } from "../../components/CachedMedia";
import { uploadEventMedia } from "../../event/shared/api";
import {
  NativeAlbumUploadPluginBridge,
  type NativeAlbumCameraProfile,
} from "../../mobile/native/albumUploadPlugin";

type CaptureUploadStatus = "queued" | "uploading" | "success" | "error";

type CaptureUploadItem = {
  id: string;
  name: string;
  type: "image" | "video";
  previewUrl: string;
  status: CaptureUploadStatus;
  progress: number;
  error?: string | null;
};

type ContinuousCapturePanelProps = {
  eventId: number;
  eventName?: string;
  isMobile: boolean;
  onExit: () => void;
  onUploaded: () => Promise<void> | void;
};

type FacingMode = "environment" | "user";
type CaptureOrientation = "portrait" | "landscape";
type CaptureScreenOrientation = ScreenOrientation & {
  lock?: (orientation: "portrait-primary") => Promise<void>;
  unlock?: () => void;
};
type SensorPermissionConstructor = {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};
type ZoomSettings = {
  supported: boolean;
  min: number;
  max: number;
  step: number;
  value: number;
};

type ZoomTrackCapabilities = MediaTrackCapabilities & {
  zoom?: {
    min?: number;
    max?: number;
    step?: number;
  };
};

type ZoomTrackSettings = MediaTrackSettings & {
  zoom?: number;
};

type ZoomTrackConstraintSet = MediaTrackConstraintSet & {
  zoom?: number;
};

const LONG_PRESS_MS = 520;
const MAX_VISIBLE_ITEMS = 8;

export function ContinuousCapturePanel({
  eventId,
  eventName,
  isMobile,
  onExit,
  onUploaded,
}: ContinuousCapturePanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const uploadFilesRef = useRef<Map<string, File>>(new Map());
  const pendingUploadIdsRef = useRef<string[]>([]);
  const processingUploadRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const recordingStartedByPressRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const captureOrientationRef = useRef<CaptureOrientation>("portrait");
  const orientationSensorActiveRef = useRef(false);

  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [items, setItems] = useState<CaptureUploadItem[]>([]);
  const [cameraProfile, setCameraProfile] = useState<NativeAlbumCameraProfile | null>(null);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [zoomSettings, setZoomSettings] = useState<ZoomSettings | null>(null);
  const [captureOrientation, setCaptureOrientation] = useState<CaptureOrientation>("portrait");

  const stats = useMemo(() => {
    return {
      total: items.length,
      uploading: items.filter((item) => item.status === "uploading" || item.status === "queued").length,
      success: items.filter((item) => item.status === "success").length,
      failed: items.filter((item) => item.status === "error").length,
    };
  }, [items]);

  useEffect(() => {
    let canceled = false;
    void NativeAlbumUploadPluginBridge.getCameraProfile()
      .then((profile) => {
        if (!canceled) {
          setCameraProfile(profile);
        }
      })
      .catch(() => undefined);

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    async function openCamera() {
      setCameraReady(false);
      setCameraError(null);
      setZoomSettings(null);
      stopStream();

      try {
        const stream = await requestCameraStream(facingMode);
        if (canceled) {
          stopTracks(stream);
          return;
        }

        streamRef.current = stream;
        setZoomSettings(readZoomSettings(stream));
        if (videoRef.current) {
          preparePreviewVideo(videoRef.current, stream);
          await videoRef.current.play();
          updateCaptureOrientationFromVideo();
        }
        setCameraReady(true);
      } catch (error) {
        if (!canceled) {
          setCameraReady(false);
          setCameraError(cameraErrorMessage(error));
        }
      }
    }

    void openCamera();

    return () => {
      canceled = true;
      clearLongPressTimer();
      stopRecording();
      stopStream();
    };
  }, [facingMode]);

  useEffect(() => {
    const releaseCameraScreenLock = lockCameraScreenForCapture(isMobile);
    return releaseCameraScreenLock;
  }, [isMobile]);

  useEffect(() => {
    let canceled = false;

    const handleDeviceOrientation = (event: DeviceOrientationEvent) => {
      applySensorOrientation(detectOrientationFromDeviceOrientation(event));
    };

    const handleDeviceMotion = (event: DeviceMotionEvent) => {
      applySensorOrientation(detectOrientationFromDeviceMotion(event));
    };

    const startSensorListeners = () => {
      if (canceled || typeof window === "undefined") {
        return;
      }
      window.addEventListener("deviceorientation", handleDeviceOrientation, true);
      window.addEventListener("devicemotion", handleDeviceMotion, true);
    };

    void requestDeviceSensorPermission().finally(startSensorListeners);

    return () => {
      canceled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
        window.removeEventListener("devicemotion", handleDeviceMotion, true);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearLongPressTimer();
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      stopRecording();
      stopStream();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  function stopStream() {
    const stream = streamRef.current;
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (stream) {
      stopTracks(stream);
    }
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function scheduleAlbumRefresh() {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void onUploaded();
    }, 650);
  }

  function patchItem(itemId: string, patch: Partial<CaptureUploadItem>) {
    if (!mountedRef.current) {
      return;
    }
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }

  function addUploadFile(file: File, type: "image" | "video", previewBlob?: Blob) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previewUrl = mountedRef.current ? URL.createObjectURL(previewBlob || file) : "";
    if (previewUrl) {
      objectUrlsRef.current.add(previewUrl);
    }
    uploadFilesRef.current.set(id, file);
    pendingUploadIdsRef.current.push(id);
    if (mountedRef.current) {
      setItems((current) => [
        {
          id,
          name: file.name,
          type,
          previewUrl,
          status: "queued",
          progress: 0,
          error: null,
        },
        ...current,
      ]);
    }
    void processUploadQueue();
  }

  async function processUploadQueue() {
    if (processingUploadRef.current) {
      return;
    }

    processingUploadRef.current = true;
    try {
      while (pendingUploadIdsRef.current.length) {
        const itemId = pendingUploadIdsRef.current.shift();
        if (!itemId) {
          continue;
        }
        const file = uploadFilesRef.current.get(itemId);
        if (!file) {
          continue;
        }

        patchItem(itemId, { status: "uploading", progress: 0, error: null });
        try {
          await uploadEventMedia(eventId, file, {
            onProgress: (percent) => patchItem(itemId, { status: "uploading", progress: percent }),
          });
          patchItem(itemId, { status: "success", progress: 100, error: null });
          if (mountedRef.current) {
            setToast("已上传");
          }
          scheduleAlbumRefresh();
        } catch (error) {
          patchItem(itemId, {
            status: "error",
            error: error instanceof Error ? error.message : "上传失败",
          });
          if (mountedRef.current) {
            setToast(error instanceof Error ? error.message : "上传失败");
          }
        } finally {
          uploadFilesRef.current.delete(itemId);
        }
      }
    } finally {
      processingUploadRef.current = false;
    }
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || !cameraReady) {
      setToast("相机还没有准备好");
      return;
    }

    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const size = scaleCaptureDimensions(sourceWidth, sourceHeight, cameraProfile?.recommendedPhotoMaxWidth ?? 2560);
    const canvas = canvasRef.current || document.createElement("canvas");
    canvasRef.current = canvas;
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) {
      setToast("无法读取相机画面");
      return;
    }

    context.drawImage(video, 0, 0, size.width, size.height);
    const photoQuality = clampPhotoQuality(cameraProfile?.recommendedPhotoQuality ?? 0.9);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", photoQuality));
    if (!blob) {
      setToast("照片生成失败");
      return;
    }

    const file = new File([blob], `event-${eventId}-photo-${timestampForFilename()}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    addUploadFile(file, "image", blob);
  }

  function startRecording() {
    if (!streamRef.current || !cameraReady) {
      setToast("相机还没有准备好");
      recordingStartedByPressRef.current = false;
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setToast("当前设备不支持连续录像");
      recordingStartedByPressRef.current = false;
      return;
    }
    if (recordingRef.current) {
      return;
    }

    try {
      const mimeType = pickRecorderMimeType(cameraProfile);
      recordingChunksRef.current = [];
      const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recordingStartedByPressRef.current = true;
      recordingRef.current = true;
      setRecording(true);
      setToast("录像中");

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        const resolvedType = recorder.mimeType || mimeType || "video/webm";
        recordingChunksRef.current = [];
        recordingRef.current = false;
        if (mountedRef.current) {
          setRecording(false);
        }
        if (!chunks.length) {
          if (mountedRef.current) {
            setToast("没有录到视频");
          }
          return;
        }
        const blob = new Blob(chunks, { type: resolvedType });
        const extension = videoExtensionFromMime(resolvedType);
        const file = new File([blob], `event-${eventId}-video-${timestampForFilename()}.${extension}`, {
          type: resolvedType,
          lastModified: Date.now(),
        });
        addUploadFile(file, "video", blob);
      };
      recorder.onerror = () => {
        recordingRef.current = false;
        if (mountedRef.current) {
          setRecording(false);
          setToast("录像失败");
        }
      };

      recorder.start(1000);
    } catch (error) {
      recordingStartedByPressRef.current = false;
      recordingRef.current = false;
      setRecording(false);
      setToast(error instanceof Error ? error.message : "录像启动失败");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
  }

  function handleShutterDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!cameraReady || recordingRef.current) {
      return;
    }
    clearLongPressTimer();
    recordingStartedByPressRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      startRecording();
    }, LONG_PRESS_MS);
  }

  function handleShutterUp(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startedRecording = recordingStartedByPressRef.current || recordingRef.current;
    clearLongPressTimer();
    if (startedRecording) {
      stopRecording();
      recordingStartedByPressRef.current = false;
      return;
    }
    void capturePhoto();
  }

  function handleExit() {
    clearLongPressTimer();
    stopRecording();
    stopStream();
    onExit();
  }

  function applyCaptureOrientation(orientation: CaptureOrientation) {
    captureOrientationRef.current = orientation;
    setCaptureOrientation(orientation);
  }

  function applySensorOrientation(orientation: CaptureOrientation | null) {
    if (!orientation) {
      return;
    }
    orientationSensorActiveRef.current = true;
    if (orientation !== captureOrientationRef.current) {
      applyCaptureOrientation(orientation);
    }
  }

  function updateCaptureOrientationFromVideo() {
    if (orientationSensorActiveRef.current) {
      return;
    }
    const video = videoRef.current;
    applyCaptureOrientation(detectCaptureOrientation(video, captureOrientationRef.current));
  }

  function handlePreviewFrameReady() {
    updateCaptureOrientationFromVideo();
    if (streamRef.current) {
      setCameraReady(true);
    }
  }

  function handleZoomInput(value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !zoomSettings?.supported) {
      return;
    }
    const nextValue = clampNumber(parsed, zoomSettings.min, zoomSettings.max, zoomSettings.value);
    setZoomSettings((current) => (current ? { ...current, value: nextValue } : current));
    void applyZoom(nextValue);
  }

  function resetZoom() {
    if (!zoomSettings?.supported) {
      return;
    }
    const nextValue = clampNumber(1, zoomSettings.min, zoomSettings.max, zoomSettings.min);
    setZoomSettings((current) => (current ? { ...current, value: nextValue } : current));
    void applyZoom(nextValue);
  }

  async function applyZoom(value: number) {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track?.applyConstraints) {
      return;
    }
    try {
      await track.applyConstraints({
        advanced: [{ zoom: value } as ZoomTrackConstraintSet],
      });
    } catch {
      if (mountedRef.current) {
        setToast("缩放调整失败");
      }
    }
  }

  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const zoomSupported = Boolean(zoomSettings?.supported);
  const zoomValue = zoomSettings?.value ?? 1;
  const latestItem = visibleItems[0] || null;

  return (
    <div style={capturePanelStyle(isMobile)}>
      <div style={cameraStageStyle}>
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          style={videoStyle(facingMode, cameraReady)}
          onLoadedMetadata={handlePreviewFrameReady}
          onLoadedData={handlePreviewFrameReady}
          onCanPlay={handlePreviewFrameReady}
          onResize={updateCaptureOrientationFromVideo}
        />
        <div style={cameraTopOverlayStyle}>
          <button type="button" style={iconButtonStyle} onClick={handleExit} aria-label="退出">
            x
          </button>
          <div style={cameraTitlePillStyle}>
            <span style={cameraModeStyle}>{recording ? "录像中" : cameraProfile?.isSamsung ? "Samsung" : "相机"}</span>
            <span style={cameraTitleTextStyle}>{eventName || `活动 #${eventId}`}</span>
          </div>
          <div style={orientationPillStyle}>
            {captureOrientation === "landscape" ? "横向" : "竖向"}
          </div>
        </div>
        {gridEnabled ? (
          <div style={gridOverlayStyle} aria-hidden="true">
            <span style={gridVerticalLineStyle("33.333%")} />
            <span style={gridVerticalLineStyle("66.666%")} />
            <span style={gridHorizontalLineStyle("33.333%")} />
            <span style={gridHorizontalLineStyle("66.666%")} />
          </div>
        ) : null}
        {!cameraReady ? (
          <div style={cameraOverlayStyle}>
            {cameraError || "相机准备中"}
          </div>
        ) : null}
        {recording ? <div style={recordBadgeStyle}>REC</div> : null}
        <div style={cameraStatsStyle}>
          <span>上传 {stats.success}</span>
          <span>等待 {stats.uploading}</span>
          <span>失败 {stats.failed}</span>
        </div>
      </div>

      <div style={nativeBottomPanelStyle(isMobile)}>
        <div style={captureToolBarStyle(isMobile)}>
        <button
          type="button"
          style={toolToggleButtonStyle(gridEnabled)}
          onClick={() => setGridEnabled((current) => !current)}
        >
          九宫格
        </button>
        <div style={zoomControlStyle(zoomSupported)}>
          <button
            type="button"
            style={zoomResetButtonStyle}
            onClick={resetZoom}
            disabled={!zoomSupported || recording}
          >
            1x
          </button>
          <input
            type="range"
            min={zoomSettings?.min ?? 1}
            max={zoomSettings?.max ?? 1}
            step={zoomSettings?.step ?? 0.1}
            value={zoomValue}
            disabled={!zoomSupported || recording}
            onChange={(event) => handleZoomInput(event.currentTarget.value)}
            style={zoomSliderStyle}
            aria-label="缩放"
          />
          <span style={zoomValueStyle}>{zoomSupported ? `${formatZoomValue(zoomValue)}x` : "缩放不可用"}</span>
        </div>
        </div>

        {toast ? <div style={captureToastStyle}>{toast}</div> : null}

        <div style={captureControlsStyle(isMobile)}>
          <div style={latestPreviewSlotStyle}>
            {latestItem ? (
              latestItem.type === "image" ? (
                <CachedImage src={latestItem.previewUrl} alt="" style={latestPreviewStyle(latestItem.status)} />
              ) : (
                <video src={latestItem.previewUrl} muted playsInline style={latestPreviewStyle(latestItem.status)} />
              )
            ) : (
              <div style={emptyLatestPreviewStyle} />
            )}
          </div>
          <button
            type="button"
            style={shutterButtonStyle(recording, cameraReady)}
            disabled={!cameraReady}
            onPointerDown={handleShutterDown}
            onPointerUp={handleShutterUp}
            onPointerCancel={handleShutterUp}
            onContextMenu={(event) => event.preventDefault()}
            aria-label="拍摄"
          >
            <span style={shutterInnerStyle(recording)} />
          </button>
          <button
            type="button"
            style={flipCameraButtonStyle}
            disabled={recording}
            onClick={() => setFacingMode((current) => (current === "environment" ? "user" : "environment"))}
            aria-label="切换镜头"
          >
            <span style={flipCameraIconStyle}>↻</span>
          </button>
        </div>

        <div style={captureHintRowStyle}>
          <span>点按拍照</span>
          <span>长按录像</span>
          <span>{captureOrientation === "landscape" ? "横向拍摄" : "竖向拍摄"}</span>
        </div>

        <div style={uploadStripStyle(isMobile)}>
          {!visibleItems.length ? null : visibleItems.map((item) => (
            <div key={item.id} style={uploadTileStyle(item.status)}>
              {item.type === "image" ? (
                <CachedImage src={item.previewUrl} alt="" style={uploadThumbStyle} />
              ) : (
                <video src={item.previewUrl} muted playsInline style={uploadThumbStyle} />
              )}
              <div style={uploadTileMetaStyle}>
                <div style={uploadTileNameStyle}>{item.type === "image" ? "照片" : "视频"}</div>
                <div style={uploadTileStatusStyle(item.status)}>
                  {captureStatusLabel(item.status)} {item.status === "uploading" ? `${item.progress}%` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function readZoomSettings(stream: MediaStream): ZoomSettings {
  const track = stream.getVideoTracks()[0];
  const capabilities = track?.getCapabilities?.() as ZoomTrackCapabilities | undefined;
  const range = capabilities?.zoom;
  if (
    !track ||
    !range ||
    typeof range.min !== "number" ||
    typeof range.max !== "number" ||
    range.max <= range.min
  ) {
    return {
      supported: false,
      min: 1,
      max: 1,
      step: 0.1,
      value: 1,
    };
  }

  const settings = track.getSettings?.() as ZoomTrackSettings | undefined;
  const min = range.min;
  const max = Math.max(min, range.max);
  const step = typeof range.step === "number" && range.step > 0 ? range.step : 0.1;
  const value = clampNumber(settings?.zoom, min, max, min);
  return {
    supported: true,
    min,
    max,
    step,
    value,
  };
}

function detectCaptureOrientation(video: HTMLVideoElement | null, fallback: CaptureOrientation): CaptureOrientation {
  if (video?.videoWidth && video.videoHeight) {
    return video.videoWidth >= video.videoHeight ? "landscape" : "portrait";
  }
  return fallback;
}

function detectOrientationFromDeviceOrientation(event: DeviceOrientationEvent): CaptureOrientation | null {
  const beta = typeof event.beta === "number" ? event.beta : null;
  const gamma = typeof event.gamma === "number" ? event.gamma : null;
  if (beta === null || gamma === null) {
    return null;
  }

  const absBeta = Math.abs(beta);
  const absGamma = Math.abs(gamma);
  if (Math.max(absBeta, absGamma) < 35) {
    return null;
  }
  if (absGamma > absBeta + 12) {
    return "landscape";
  }
  if (absBeta > absGamma + 12) {
    return "portrait";
  }
  return null;
}

function detectOrientationFromDeviceMotion(event: DeviceMotionEvent): CaptureOrientation | null {
  const gravity = event.accelerationIncludingGravity;
  const x = typeof gravity?.x === "number" ? gravity.x : null;
  const y = typeof gravity?.y === "number" ? gravity.y : null;
  if (x === null || y === null) {
    return null;
  }

  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (Math.max(absX, absY) < 4) {
    return null;
  }
  if (absX > absY + 1.2) {
    return "landscape";
  }
  if (absY > absX + 1.2) {
    return "portrait";
  }
  return null;
}

async function requestDeviceSensorPermission() {
  const permissionConstructors: SensorPermissionConstructor[] = [];
  if (typeof DeviceOrientationEvent !== "undefined") {
    permissionConstructors.push(DeviceOrientationEvent as unknown as SensorPermissionConstructor);
  }
  if (typeof DeviceMotionEvent !== "undefined") {
    permissionConstructors.push(DeviceMotionEvent as unknown as SensorPermissionConstructor);
  }

  for (const permissionConstructor of permissionConstructors) {
    if (typeof permissionConstructor.requestPermission !== "function") {
      continue;
    }
    await permissionConstructor.requestPermission().catch(() => "denied");
  }
}

function lockCameraScreenForCapture(isMobile: boolean) {
  if (!isMobile) {
    return () => undefined;
  }

  void NativeAlbumUploadPluginBridge.setCameraOrientationLock?.({ locked: true }).catch(() => undefined);

  const orientation = typeof screen !== "undefined"
    ? (screen.orientation as CaptureScreenOrientation | undefined)
    : undefined;
  let shouldUnlockScreen = false;
  if (orientation?.lock) {
    void orientation.lock("portrait-primary")
      .then(() => {
        shouldUnlockScreen = true;
      })
      .catch(() => undefined);
  }

  return () => {
    void NativeAlbumUploadPluginBridge.setCameraOrientationLock?.({ locked: false }).catch(() => undefined);
    if (shouldUnlockScreen) {
      orientation?.unlock?.();
    }
  };
}

async function requestCameraStream(facingMode: FacingMode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前设备不支持相机");
  }

  const video: MediaTrackConstraints = {
    facingMode: { ideal: facingMode },
  };

  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

function preparePreviewVideo(video: HTMLVideoElement, stream: MediaStream) {
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.srcObject = stream;
}

function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function pickRecorderMimeType(cameraProfile?: NativeAlbumCameraProfile | null) {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  const samsungCandidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const defaultCandidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return (cameraProfile?.isSamsung ? samsungCandidates : defaultCandidates).find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function videoExtensionFromMime(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("mp4")) {
    return "mp4";
  }
  if (normalized.includes("3gpp")) {
    return "3gp";
  }
  return "webm";
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function formatZoomValue(value: number) {
  if (!Number.isFinite(value)) {
    return "1.0";
  }
  return value.toFixed(value >= 10 ? 0 : 1);
}

function scaleCaptureDimensions(sourceWidth: number, sourceHeight: number, maxWidth: number) {
  const width = Math.max(1, Math.round(sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight));
  const boundedMaxWidth = clampNumber(maxWidth, 640, 4096, 2560);
  if (width <= boundedMaxWidth) {
    return { width, height };
  }
  const ratio = boundedMaxWidth / width;
  return {
    width: boundedMaxWidth,
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function clampPhotoQuality(value: number) {
  return Math.min(0.95, Math.max(0.72, value));
}

function clampNumber(value: number | null | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function cameraErrorMessage(error: unknown) {
  const namedError = error as { name?: string; message?: string } | null | undefined;
  const name = (namedError?.name || "").toLowerCase();
  const message = (namedError?.message || "").toLowerCase();

  if (name.includes("notfound") || message.includes("device not found")) {
    return "未找到可用相机";
  }
  if (name.includes("notallowed") || name.includes("security")) {
    return "需要允许相机权限";
  }
  if (name.includes("notreadable")) {
    return "相机正在被其他应用使用";
  }
  if (name.includes("overconstrained")) {
    return "当前相机不支持请求参数";
  }
  return "无法打开相机";
}

function captureStatusLabel(status: CaptureUploadStatus) {
  if (status === "success") return "完成";
  if (status === "error") return "失败";
  if (status === "uploading") return "上传";
  return "等待";
}

function capturePanelStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100vw",
    height: "100dvh",
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr) auto",
    background: "#020305",
    color: "#f8fafc",
    overflow: "hidden",
    paddingBottom: isMobile ? "env(safe-area-inset-bottom)" : undefined,
  };
}

const captureTopBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  padding: "14px 16px",
  background: "rgba(8, 11, 16, 0.96)",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
};

const captureTitleWrapStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "3px",
};

const captureEyebrowStyle: CSSProperties = {
  fontSize: "11px",
  color: "rgba(248,250,252,0.58)",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};

const captureTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const exitButtonStyle: CSSProperties = {
  minHeight: "38px",
  padding: "0 14px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.08)",
  color: "#f8fafc",
  fontWeight: 800,
  cursor: "pointer",
};

const cameraStageStyle: CSSProperties = {
  position: "relative",
  minHeight: 0,
  background: "#000",
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
};

const cameraTopOverlayStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 5,
  display: "grid",
  gridTemplateColumns: "44px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: "10px",
  padding: "calc(env(safe-area-inset-top) + 12px) 14px 18px",
  background: "linear-gradient(180deg, rgba(0,0,0,0.72), rgba(0,0,0,0))",
};

const iconButtonStyle: CSSProperties = {
  width: "42px",
  height: "42px",
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.44)",
  color: "#fff",
  fontSize: "22px",
  lineHeight: 1,
  fontWeight: 500,
  cursor: "pointer",
};

const cameraTitlePillStyle: CSSProperties = {
  minWidth: 0,
  justifySelf: "center",
  maxWidth: "100%",
  display: "grid",
  justifyItems: "center",
  gap: "2px",
  padding: "7px 12px",
  borderRadius: "999px",
  background: "rgba(0,0,0,0.38)",
  border: "1px solid rgba(255,255,255,0.1)",
  backdropFilter: "blur(10px)",
};

const cameraModeStyle: CSSProperties = {
  fontSize: "10px",
  fontWeight: 800,
  color: "rgba(255,255,255,0.62)",
  textTransform: "uppercase",
};

const cameraTitleTextStyle: CSSProperties = {
  maxWidth: "54vw",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#fff",
  fontSize: "14px",
  fontWeight: 800,
};

const orientationPillStyle: CSSProperties = {
  minWidth: "48px",
  padding: "8px 10px",
  borderRadius: "999px",
  textAlign: "center",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.44)",
  color: "#fff",
  fontSize: "12px",
  fontWeight: 900,
};

const gridOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2,
};

function gridVerticalLineStyle(left: string): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    left,
    width: "1px",
    background: "rgba(255,255,255,0.42)",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.16)",
  };
}

function gridHorizontalLineStyle(top: string): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    top,
    height: "1px",
    background: "rgba(255,255,255,0.42)",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.16)",
  };
}

function videoStyle(facingMode: FacingMode, ready: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    zIndex: 1,
    transform: facingMode === "user" ? "scaleX(-1)" : undefined,
    opacity: ready ? 1 : 0,
  };
}

const cameraOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 4,
  display: "grid",
  placeItems: "center",
  padding: "20px",
  textAlign: "center",
  background: "rgba(8, 11, 16, 0.82)",
  color: "#f8fafc",
  fontWeight: 800,
};

const recordBadgeStyle: CSSProperties = {
  position: "absolute",
  top: "calc(env(safe-area-inset-top) + 74px)",
  left: "18px",
  zIndex: 6,
  padding: "7px 10px",
  borderRadius: "999px",
  background: "#dc2626",
  color: "#fff",
  fontSize: "12px",
  fontWeight: 900,
  letterSpacing: "0.08em",
};

const cameraStatsStyle: CSSProperties = {
  position: "absolute",
  right: "12px",
  bottom: "12px",
  zIndex: 3,
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  color: "#f8fafc",
  fontSize: "12px",
  fontWeight: 800,
};

function nativeBottomPanelStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "12px",
    padding: isMobile ? "12px 14px 14px" : "14px 24px 18px",
    background: "#020305",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  };
}

function captureToolBarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "auto minmax(0, 1fr)" : "160px minmax(0, 440px)",
    gap: "10px",
    alignItems: "center",
    padding: 0,
    background: "transparent",
  };
}

function toolToggleButtonStyle(enabled: boolean): CSSProperties {
  return {
    minHeight: "38px",
    padding: "0 12px",
    borderRadius: "999px",
    border: enabled ? "1px solid rgba(20,184,166,0.72)" : "1px solid rgba(255,255,255,0.16)",
    background: enabled ? "rgba(20,184,166,0.22)" : "rgba(255,255,255,0.08)",
    color: "#f8fafc",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function zoomControlStyle(supported: boolean): CSSProperties {
  return {
    minHeight: "38px",
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "10px",
    padding: "0 12px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    opacity: supported ? 1 : 0.64,
  };
}

const zoomResetButtonStyle: CSSProperties = {
  minWidth: "34px",
  height: "28px",
  padding: 0,
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.1)",
  color: "#f8fafc",
  fontWeight: 900,
  cursor: "pointer",
};

const zoomSliderStyle: CSSProperties = {
  width: "100%",
  accentColor: "#14b8a6",
};

const zoomValueStyle: CSSProperties = {
  minWidth: "54px",
  textAlign: "right",
  fontSize: "12px",
  fontWeight: 900,
  color: "#f8fafc",
};

function captureControlsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: isMobile ? "14px" : "20px",
    padding: isMobile ? "4px 4px 0" : "6px 10px 0",
    background: "transparent",
  };
}

const latestPreviewSlotStyle: CSSProperties = {
  width: "58px",
  height: "58px",
  alignSelf: "center",
  justifySelf: "start",
};

function latestPreviewStyle(status: CaptureUploadStatus): CSSProperties {
  return {
    width: "58px",
    height: "58px",
    borderRadius: "12px",
    objectFit: "cover",
    border:
      status === "success"
        ? "2px solid #34d399"
        : status === "error"
          ? "2px solid #f87171"
          : "2px solid rgba(255,255,255,0.48)",
    background: "#111827",
  };
}

const emptyLatestPreviewStyle: CSSProperties = {
  width: "58px",
  height: "58px",
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
};

const flipCameraButtonStyle: CSSProperties = {
  width: "58px",
  height: "58px",
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.1)",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
};

const flipCameraIconStyle: CSSProperties = {
  fontSize: "28px",
  lineHeight: 1,
  fontWeight: 800,
};

const captureHintRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: "14px",
  flexWrap: "wrap",
  color: "rgba(248,250,252,0.52)",
  fontSize: "12px",
  fontWeight: 700,
};

const sideControlButtonStyle: CSSProperties = {
  minHeight: "44px",
  padding: "0 14px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.08)",
  color: "#f8fafc",
  fontWeight: 800,
  cursor: "pointer",
};

function shutterButtonStyle(recording: boolean, ready: boolean): CSSProperties {
  return {
    width: "82px",
    height: "82px",
    borderRadius: "50%",
    border: recording ? "4px solid rgba(248,113,113,0.9)" : "4px solid rgba(255,255,255,0.84)",
    background: "rgba(255,255,255,0.12)",
    display: "grid",
    placeItems: "center",
    cursor: ready ? "pointer" : "not-allowed",
    opacity: ready ? 1 : 0.5,
    touchAction: "none",
  };
}

function shutterInnerStyle(recording: boolean): CSSProperties {
  return {
    width: recording ? "34px" : "58px",
    height: recording ? "34px" : "58px",
    borderRadius: recording ? "10px" : "50%",
    background: recording ? "#ef4444" : "#f8fafc",
    transition: "border-radius 160ms ease, width 160ms ease, height 160ms ease",
  };
}

const captureToastStyle: CSSProperties = {
  margin: "0 14px 12px",
  padding: "10px 12px",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.08)",
  color: "#f8fafc",
  fontSize: "13px",
};

function uploadStripStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: isMobile ? "138px" : "160px",
    gap: "10px",
    overflowX: "auto",
    padding: "0 14px 14px",
    background: "#080b10",
  };
}

const emptyStripStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minHeight: "70px",
  padding: "12px",
  borderRadius: "14px",
  border: "1px dashed rgba(255,255,255,0.16)",
  color: "rgba(248,250,252,0.6)",
};

function uploadTileStyle(status: CaptureUploadStatus): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "48px minmax(0, 1fr)",
    gap: "8px",
    alignItems: "center",
    padding: "8px",
    minHeight: "70px",
    borderRadius: "14px",
    border:
      status === "error"
        ? "1px solid rgba(248,113,113,0.42)"
        : status === "success"
          ? "1px solid rgba(52,211,153,0.42)"
          : "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.07)",
  };
}

const uploadThumbStyle: CSSProperties = {
  width: "48px",
  height: "48px",
  borderRadius: "10px",
  objectFit: "cover",
  background: "#111827",
};

const uploadTileMetaStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "4px",
};

const uploadTileNameStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function uploadTileStatusStyle(status: CaptureUploadStatus): CSSProperties {
  return {
    fontSize: "12px",
    color:
      status === "success"
        ? "#34d399"
        : status === "error"
          ? "#f87171"
          : status === "uploading"
            ? "#93c5fd"
            : "rgba(248,250,252,0.62)",
  };
}
