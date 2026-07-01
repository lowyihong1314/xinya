import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type SyntheticEvent,
} from "react";

import { API_BASE } from "../js/apiBase";
import { clearSmartImageCache, smartMediaAsset, type SmartMediaAsset, type SmartMediaVariant } from "../js/get_img";
import { CachedImage, CachedVideo } from "./CachedMedia";
import {
  connectEventMediaRoom,
  MEDIA_ROOM_UPDATE_EVENT,
  type MediaNotification,
} from "../album/react/mediaRealtime";

export type CacheMediaPlayerProgress = {
  status: "started" | "progress" | "done" | "error";
  percent?: number;
  value?: string;
};

type CacheMediaPlayerProps = {
  id?: string;
  statusId?: string;
  fileId?: number | string | null;
  fileType?: string | null;
  alt?: string;
  style?: CSSProperties;
  containerStyle?: CSSProperties;
  fallbackSrc?: string;
  mediaNotification?: MediaNotification | null;
  eventCode?: string | null;
  variant?: SmartMediaVariant;
  listenProgress?: boolean;
  reloadKey?: string | number;
  videoProgress?: CacheMediaPlayerProgress | null;
  retryAttempts?: number;
  retryDelayMs?: number;
  deferLoad?: boolean;
  videoAutoPlay?: boolean;
  videoMuted?: boolean;
  videoLoop?: boolean;
  videoControls?: boolean;
  imageLoading?: "lazy" | "eager";
  onMediaClick?: MouseEventHandler<HTMLImageElement | HTMLVideoElement>;
  onMediaLoad?: (element: HTMLImageElement | HTMLVideoElement) => void;
  onVideoEnded?: () => void;
  onAssetChange?: (asset: SmartMediaAsset | null) => void;
};

const FALLBACK_IMAGE_URL = `${API_BASE}/static/img/placeholder.png`;

export function CacheMediaPlayer({
  id,
  statusId,
  fileId,
  fileType,
  alt,
  style,
  containerStyle,
  fallbackSrc = FALLBACK_IMAGE_URL,
  mediaNotification,
  eventCode,
  variant = "auto",
  listenProgress = false,
  reloadKey,
  videoProgress,
  retryAttempts = 1,
  retryDelayMs = 1500,
  deferLoad = false,
  videoAutoPlay = true,
  videoMuted = true,
  videoLoop = true,
  videoControls = false,
  imageLoading = "lazy",
  onMediaClick,
  onMediaLoad,
  onVideoEnded,
  onAssetChange,
}: CacheMediaPlayerProps) {
  const [asset, setAsset] = useState<SmartMediaAsset | null>(null);
  const [internalVideoProgress, setInternalVideoProgress] = useState<CacheMediaPlayerProgress | null>(null);
  const resolvedVideoProgress = videoProgress ?? internalVideoProgress;
  const lastLoadRef = useRef<{
    fileId?: number | string | null;
    reloadKey?: string | number;
  } | null>(null);
  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    if (asset?.kind === "image") {
      onMediaLoad?.(event.currentTarget);
    }
  };
  const handleVideoLoad = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (asset?.kind === "video") {
      onMediaLoad?.(event.currentTarget);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const previousLoad = lastLoadRef.current;
    const shouldRefreshCurrentFile =
      previousLoad?.fileId != null
      && fileId != null
      && String(previousLoad.fileId) === String(fileId)
      && previousLoad.reloadKey !== reloadKey;
    lastLoadRef.current = {
      fileId,
      reloadKey,
    };

    async function loadAsset() {
      if (deferLoad) {
        setAsset(null);
        return;
      }

      if (fileId == null) {
        setAsset(null);
        onAssetChange?.(null);
        return;
      }

      if (shouldRefreshCurrentFile) {
        clearSmartImageCache(fileId);
      }

      for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
        try {
          const nextAsset = await smartMediaAsset(fileId, fileType, variant, {
            signal: controller?.signal,
          });
          if (!cancelled) {
            const normalized = nextAsset.kind === "unsupported" ? null : nextAsset;
            setAsset(normalized);
            onAssetChange?.(normalized);
          }
          if (nextAsset.kind !== "unsupported") {
            return;
          }
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }
          // continue retry flow below
        }

        if (!isVideoType(fileType) || attempt === retryAttempts - 1) {
          break;
        }
        try {
          await abortableDelay(retryDelayMs, controller?.signal);
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }
        }
      }

      if (!cancelled) {
        setAsset(null);
        onAssetChange?.(null);
      }
    }

    void loadAsset();

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [deferLoad, fileId, fileType, reloadKey, onAssetChange, retryAttempts, retryDelayMs, variant]);

  useEffect(() => {
    if (deferLoad || fileId == null || !resolvedVideoProgress || resolvedVideoProgress.status !== "done") {
      return;
    }

    let cancelled = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const reloadReadyAsset = async () => {
      clearSmartImageCache(fileId);
      try {
        const nextAsset = await smartMediaAsset(fileId, fileType, variant, {
          signal: controller?.signal,
        });
        if (!cancelled && nextAsset.kind !== "unsupported") {
          setAsset(nextAsset);
          onAssetChange?.(nextAsset);
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        // keep current rendered asset
      }
    };
    void reloadReadyAsset();
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [deferLoad, fileId, fileType, onAssetChange, resolvedVideoProgress, variant]);

  useEffect(() => {
    if (!fileId || !mediaNotification) {
      return;
    }

    const targetId = mediaNotification.file_id ?? mediaNotification.video_id;
    if (String(targetId) !== String(fileId)) {
      return;
    }

    if (mediaNotification.event === "video_processing_started") {
      setInternalVideoProgress({ status: "started", percent: 0 });
      return;
    }

    if (mediaNotification.event === "video_progress") {
      setInternalVideoProgress({
        status: "progress",
        percent: mediaNotification.percent,
      });
      return;
    }

    if (mediaNotification.event === "video_done") {
      setInternalVideoProgress({ status: "done", percent: 100 });
      clearSmartImageCache(fileId);
      window.setTimeout(() => {
        setInternalVideoProgress(null);
      }, 1800);
      return;
    }

    if (mediaNotification.event === "video_error") {
      setInternalVideoProgress({
        status: "error",
        value: mediaNotification.value || "转码失败",
      });
    }
  }, [fileId, mediaNotification]);

  useEffect(() => {
    if (!listenProgress || mediaNotification || !eventCode || !fileId) {
      return;
    }

    let active = true;
    let socketRef: { disconnect: () => void; off: (event: string, listener?: (...args: unknown[]) => void) => void } | null = null;

    const handleNotification = (payload: unknown) => {
      if (!active || !payload || typeof payload !== "object") {
        return;
      }

      const message = payload as MediaNotification;
      const targetId = message.file_id ?? message.video_id;
      if (String(targetId) !== String(fileId)) {
        return;
      }

      if (message.event === "video_processing_started") {
        setInternalVideoProgress({ status: "started", percent: 0 });
      } else if (message.event === "video_progress") {
        setInternalVideoProgress({ status: "progress", percent: message.percent });
      } else if (message.event === "video_done") {
        setInternalVideoProgress({ status: "done", percent: 100 });
        clearSmartImageCache(fileId);
        window.setTimeout(() => setInternalVideoProgress(null), 1800);
      } else if (message.event === "video_error") {
        setInternalVideoProgress({ status: "error", value: message.value || "转码失败" });
      }
    };

    void connectEventMediaRoom(eventCode)
      .then((socket) => {
        if (!active) {
          socket.disconnect();
          return;
        }
        socketRef = socket;
        socket.on(MEDIA_ROOM_UPDATE_EVENT, handleNotification);
      })
      .catch((error) => {
        console.warn("[cache-media-player] socket unavailable", error);
      });

    return () => {
      active = false;
      if (socketRef) {
        socketRef.off(MEDIA_ROOM_UPDATE_EVENT, handleNotification);
        socketRef.disconnect();
      }
    };
  }, [eventCode, fileId, listenProgress, mediaNotification]);

  if (deferLoad) {
    return <div id={id} style={{ ...rootStyle, ...containerStyle }} />;
  }

  return (
    <div id={id} style={{ ...rootStyle, ...containerStyle }}>
      {asset?.kind === "video" ? (
        <CachedVideo
          src={asset.url}
          style={style}
          autoPlay={videoAutoPlay}
          muted={videoMuted}
          loop={videoLoop}
          controls={videoControls}
          playsInline
          preload="metadata"
          onClick={onMediaClick as MouseEventHandler<HTMLVideoElement> | undefined}
          onLoadedMetadata={handleVideoLoad}
          onCanPlay={handleVideoLoad}
          onEnded={onVideoEnded}
        />
      ) : (
        <CachedImage
          src={asset?.url || fallbackSrc}
          alt={alt || ""}
          style={style}
          loading={imageLoading}
          decoding="async"
          onClick={onMediaClick as MouseEventHandler<HTMLImageElement> | undefined}
          onLoad={handleImageLoad}
        />
      )}
      {resolvedVideoProgress ? <div id={statusId} style={videoStatusStyle(resolvedVideoProgress)}>{formatVideoStatus(resolvedVideoProgress)}</div> : null}
    </div>
  );
}

function isVideoType(fileType?: string | null) {
  return ["mp4", "mov", "m4v", "avi", "mkv", "webm", "flv", "mts", "m2ts", "3gp", "wmv"].includes(
    String(fileType || "").trim().toLowerCase(),
  );
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  if (!signal) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    function handleAbort() {
      window.clearTimeout(timer);
      reject(createAbortError());
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function createAbortError() {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Aborted", "AbortError");
  }
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
};

function formatVideoStatus(status: CacheMediaPlayerProgress) {
  if (status.status === "error") {
    return status.value || "转码失败";
  }
  if (status.status === "done") {
    return "视频已就绪";
  }
  if (typeof status.percent === "number") {
    return `视频处理中 ${Math.round(status.percent)}%`;
  }
  return "视频处理中";
}

function videoStatusStyle(status: CacheMediaPlayerProgress): CSSProperties {
  return {
    position: "absolute",
    left: "12px",
    right: "12px",
    bottom: "12px",
    zIndex: 2,
    padding: "8px 10px",
    borderRadius: "999px",
    background:
      status.status === "error"
        ? "rgba(138, 28, 28, 0.88)"
        : status.status === "done"
          ? "rgba(20, 94, 52, 0.88)"
          : "rgba(15, 23, 42, 0.78)",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 700,
    textAlign: "center",
    backdropFilter: "blur(10px)",
    pointerEvents: "none",
  };
}
