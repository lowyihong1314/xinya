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

  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [items, setItems] = useState<CaptureUploadItem[]>([]);
  const [cameraProfile, setCameraProfile] = useState<NativeAlbumCameraProfile | null>(null);

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
      stopStream();

      try {
        const stream = await requestCameraStream(facingMode, cameraProfile);
        if (canceled) {
          stopTracks(stream);
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch (error) {
        if (!canceled) {
          setCameraError(error instanceof Error ? error.message : "无法打开相机");
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
  }, [cameraProfile, facingMode]);

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

  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);

  return (
    <div style={capturePanelStyle(isMobile)}>
      <div style={captureTopBarStyle}>
        <div style={captureTitleWrapStyle}>
          <div style={captureEyebrowStyle}>{cameraProfile?.isSamsung ? "Samsung Capture" : "Live Capture"}</div>
          <div style={captureTitleStyle}>{eventName || `活动 #${eventId}`}</div>
        </div>
        <button type="button" style={exitButtonStyle} onClick={handleExit}>
          退出
        </button>
      </div>

      <div style={cameraStageStyle}>
        <video ref={videoRef} muted playsInline autoPlay style={videoStyle(facingMode)} />
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

      <div style={captureControlsStyle(isMobile)}>
        <button
          type="button"
          style={sideControlButtonStyle}
          disabled={recording}
          onClick={() => setFacingMode((current) => (current === "environment" ? "user" : "environment"))}
        >
          切换
        </button>
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
        <button type="button" style={sideControlButtonStyle} onClick={() => void capturePhoto()} disabled={!cameraReady || recording}>
          拍照
        </button>
      </div>

      {toast ? <div style={captureToastStyle}>{toast}</div> : null}

      <div style={uploadStripStyle(isMobile)}>
        {!visibleItems.length ? <div style={emptyStripStyle}>暂无拍摄文件</div> : null}
        {visibleItems.map((item) => (
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
  );
}

async function requestCameraStream(facingMode: FacingMode, cameraProfile: NativeAlbumCameraProfile | null) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前设备不支持相机");
  }

  const recommendedWidth = clampNumber(cameraProfile?.recommendedVideoWidth, 640, 3840, cameraProfile?.isSamsung ? 1280 : 1920);
  const recommendedHeight = clampNumber(cameraProfile?.recommendedVideoHeight, 360, 2160, cameraProfile?.isSamsung ? 720 : 1080);
  const recommendedFrameRate = clampNumber(cameraProfile?.recommendedFrameRate, 15, 60, 30);
  const video: MediaTrackConstraints = {
    facingMode: { ideal: facingMode },
    width: cameraProfile?.isSamsung ? { ideal: recommendedWidth, max: 1920 } : { ideal: recommendedWidth },
    height: cameraProfile?.isSamsung ? { ideal: recommendedHeight, max: 1080 } : { ideal: recommendedHeight },
    frameRate: cameraProfile?.isSamsung
      ? { ideal: recommendedFrameRate, max: 30 }
      : { ideal: recommendedFrameRate },
    resizeMode: "crop-and-scale",
  };

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: true });
  } catch (error) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch {
      throw error instanceof Error ? error : new Error("无法打开相机");
    }
  }
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

function captureStatusLabel(status: CaptureUploadStatus) {
  if (status === "success") return "完成";
  if (status === "error") return "失败";
  if (status === "uploading") return "上传";
  return "等待";
}

function capturePanelStyle(isMobile: boolean): CSSProperties {
  return {
    height: isMobile ? "calc(100vh - 20px)" : "min(780px, 90vh)",
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto auto auto",
    background: "#080b10",
    color: "#f8fafc",
    overflow: "hidden",
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

function videoStyle(facingMode: FacingMode): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: facingMode === "user" ? "scaleX(-1)" : undefined,
  };
}

const cameraOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
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
  top: "14px",
  left: "14px",
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
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  color: "#f8fafc",
  fontSize: "12px",
  fontWeight: 800,
};

function captureControlsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: isMobile ? "14px" : "20px",
    padding: isMobile ? "16px 20px" : "18px 28px",
    background: "#080b10",
  };
}

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
