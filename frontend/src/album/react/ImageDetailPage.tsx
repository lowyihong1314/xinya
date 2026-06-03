import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { hasUserPermission } from "../../app/permissions";
import { CacheMediaPlayer } from "../../components/CacheMediaPlayer";
import { API_BASE } from "../../js/apiBase";
import { apiFetch } from "../../js/apiFetch";
import { downloadUrlOrShare, shareUrlOrCopy } from "../../js/browserActions";
import { useEnsureDesignTokens } from "../../theme/designTokens";

type FileRecord = {
  id: number;
  event_id?: number | null;
  prev_id?: number | null;
  next_id?: number | null;
  file_type?: string;
  file_name?: string;
  user_display_name?: string;
  created_at?: string;
};

type EventRecord = {
  id: number;
  event_name?: string;
};

type FilePayload = {
  status?: string;
  message?: string;
  data?: {
    file?: FileRecord;
    event?: EventRecord | null;
  };
};

type MediaInfoPayload = {
  status?: string;
  ready?: boolean;
  path?: string;
};

type ImageSource = {
  kind: "image";
  originalUrl?: string;
  fileId: number;
  fileType?: string;
  alt: string;
};

type VideoSource = {
  kind: "video";
  originalUrl?: string;
  fileId: number;
  fileType?: string;
  alt: string;
};

type UnsupportedSource = {
  kind: "unsupported";
  originalUrl: string;
  reason: string;
};

type MediaSource = ImageSource | VideoSource | UnsupportedSource;

type ImageDetailState = {
  file: FileRecord | null;
  event: EventRecord | null;
  mediaSource: MediaSource | null;
  loading: boolean;
  error: string | null;
};

type ViewerProps = {
  isMobile: boolean;
  file: FileRecord | null;
  mediaSource: MediaSource | null;
  loading: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
};

const INITIAL_STATE: ImageDetailState = {
  file: null,
  event: null,
  mediaSource: null,
  loading: true,
  error: null,
};

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mod", "m4v", "avi", "mkv", "webm", "flv", "mts", "m2ts", "3gp", "wmv"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp", "tif", "tiff", "webp"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
const ROTATABLE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "heic"]);

export function ImageDetailPageRoute() {
  const { isMobile, user } = useUserState();
  return <ImageDetailPage isMobile={isMobile} user={user} />;
}

export function ImageDetailPage({ isMobile, user }: { isMobile: boolean; user?: unknown }) {
  useEnsureDesignTokens();

  const navigate = useNavigate();
  const { imageId } = useParams();
  const { file, event, mediaSource, loading, error, reloadCurrent } = useImageDetail(imageId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const canEditEvent = hasUserPermission(user, "event_edit");

  useEffect(() => {
    if (!loading && (error || !mediaSource || mediaSource.kind === "unsupported")) {
      setViewerOpen(false);
    }
  }, [error, loading, mediaSource]);

  useEffect(() => {
    setActionError(null);
    setActionNotice(null);
  }, [imageId]);

  const isVideo = mediaSource?.kind === "video" || isVideoFile(file?.file_type);
  const canRotate = canRotateFile(file?.file_type);
  const supportsViewer = mediaSource?.kind === "image" || mediaSource?.kind === "video";
  const openOriginalLabel = isVideo ? "打开原文件" : "打开原图";
  const viewerActionLabel = viewerOpen ? "关闭全屏" : isVideo ? "打开全屏" : "查看大图";
  const viewStatus = isVideo
    ? `视频模式，可直接播放，也可${viewerOpen ? "关闭" : "打开"}全屏播放器。`
    : supportsViewer
      ? `图片模式，可在当前页预览，也可${viewerOpen ? "关闭" : "打开"}全屏查看。`
      : "当前文件建议直接打开原文件查看。";

  function goBack() {
    if (event?.id) {
      navigate(`/event/${event.id}`);
      return;
    }
    navigate("/");
  }

  function jumpToImage(nextId?: number | null) {
    if (nextId) {
      navigate(`/image/${nextId}`);
    }
  }

  const canOpenOriginal = Boolean(mediaSource && mediaSource.kind !== "unsupported" && mediaSource.originalUrl);
  const canShareMedia = Boolean(file && (mediaSource?.kind === "image" || mediaSource?.kind === "video"));

  async function openOriginal() {
    if (!mediaSource || mediaSource.kind === "unsupported" || !mediaSource.originalUrl) {
      return;
    }
    if (isMobile && file) {
      setSharing(true);
      setActionError(null);
      setActionNotice(null);
      try {
        const filename = shareFileName(file);
        const result = await downloadUrlOrShare(mediaSource.originalUrl, filename, {
          isMobile,
          title: event?.event_name || filename,
          text: filename,
          fallbackUrl: mediaSource.originalUrl,
          mimeType: fileMimeType(file.file_type),
        });
        if (result === "downloaded") {
          setActionNotice("文件已开始下载。");
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "打开原文件失败");
      } finally {
        setSharing(false);
      }
      return;
    }
    window.open(mediaSource.originalUrl, "_blank", "noopener,noreferrer");
  }

  async function rotateImage(angle: number) {
    if (!canEditEvent || !file || !canRotate || rotating) {
      return;
    }

    setRotating(true);
    setActionError(null);

    try {
      const response = await apiFetch(`/media/rotate_file/${file.id}/${angle}`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "旋转失败");
      }
      reloadCurrent();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "旋转失败");
    } finally {
      setRotating(false);
    }
  }

  async function shareMedia() {
    if (!file || !canShareMedia || sharing) {
      return;
    }

    setSharing(true);
    setActionError(null);
    setActionNotice(null);

    const title = event?.event_name || file.file_name || `媒体 #${file.id}`;
    const text = file.file_name || title;
    const url = buildImageShareUrl(file.id);

    try {
      const result = await shareUrlOrCopy(url, title, text);
      if (result === "copied") {
        setActionNotice("系统分享不可用，已复制分享链接。");
      }
    } catch (err) {
      if (!isShareAbort(err)) {
        setActionError(err instanceof Error ? err.message : "分享失败");
      }
    } finally {
      setSharing(false);
    }
  }

  function handleViewerFrameKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!supportsViewer) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setViewerOpen(true);
    }
  }

  const viewer = viewerOpen ? (
    <ImageDetailViewer
      isMobile={isMobile}
      file={file}
      mediaSource={mediaSource}
      loading={loading}
      onClose={() => setViewerOpen(false)}
      onPrev={file?.prev_id ? () => jumpToImage(file.prev_id) : undefined}
      onNext={file?.next_id ? () => jumpToImage(file.next_id) : undefined}
    />
  ) : null;

  if (loading) {
    return (
      <>
        <StatusScreen message="媒体加载中…" />
        {viewer}
      </>
    );
  }

  if (error || !file) {
    return (
      <>
        <StatusScreen message={error || "媒体不存在"} isError />
        {viewer}
      </>
    );
  }

  return (
      <>
        <div style={pageStyle}>
          <div style={pageGlowStyle} />
          <div style={shellStyle(isMobile)}>
          <header style={toolbarStyle(isMobile)}>
            <div style={toolbarGroupStyle(isMobile)}>
              <button type="button" style={ghostButtonStyle(isMobile)} onClick={goBack}>
                返回活动
              </button>
              <button type="button" style={ghostButtonStyle(isMobile)} disabled={!file.prev_id} onClick={() => jumpToImage(file.prev_id)}>
                上一张
              </button>
              <button type="button" style={ghostButtonStyle(isMobile)} disabled={!file.next_id} onClick={() => jumpToImage(file.next_id)}>
                下一张
              </button>
            </div>
            <div style={toolbarGroupStyle(isMobile)}>
              {!isVideo && canEditEvent ? (
                <>
                  <button type="button" style={ghostButtonStyle(isMobile)} disabled={!canRotate || rotating || loading} onClick={() => void rotateImage(-90)}>
                    左转
                  </button>
                  <button type="button" style={ghostButtonStyle(isMobile)} disabled={!canRotate || rotating || loading} onClick={() => void rotateImage(90)}>
                    {rotating ? "旋转中…" : "右转"}
                  </button>
                </>
              ) : null}
              {supportsViewer ? (
                <button type="button" style={ghostButtonStyle(isMobile)} onClick={() => setViewerOpen((current) => !current)}>
                  {viewerActionLabel}
                </button>
              ) : null}
              {canShareMedia ? (
                <button type="button" style={ghostButtonStyle(isMobile)} onClick={() => void shareMedia()} disabled={!canShareMedia || sharing}>
                  {sharing ? "分享中…" : "分享"}
                </button>
              ) : null}
              <button type="button" style={primaryButtonStyle(isMobile)} onClick={() => void openOriginal()} disabled={!canOpenOriginal || sharing}>
                {sharing && isMobile ? "处理中…" : openOriginalLabel}
              </button>
            </div>
          </header>

          {actionError ? <div style={inlineErrorStyle}>{actionError}</div> : null}
          {actionNotice ? <div style={inlineNoticeStyle}>{actionNotice}</div> : null}

          <main style={contentStyle(isMobile)}>
            <section style={viewerPanelStyle(isMobile)}>
              <div style={viewerHeaderStyle}>
                <div style={eyebrowStyle}>Media Viewer</div>
                <h1 style={viewerTitleStyle(isMobile)}>{event?.event_name || file.file_name || `文件 #${file.id}`}</h1>
                <div style={viewerMetaStyle(isMobile)}>
                  <span>ID {file.id}</span>
                  <span>{String(file.file_type || "-").toUpperCase()}</span>
                  <span>{formatDate(file.created_at)}</span>
                </div>
              </div>

              <div
                style={viewerFrameStyle(isMobile, supportsViewer)}
                onClick={supportsViewer ? () => setViewerOpen(true) : undefined}
                onKeyDown={handleViewerFrameKeyDown}
                role={supportsViewer ? "button" : undefined}
                tabIndex={supportsViewer ? 0 : undefined}
                aria-label={supportsViewer ? "打开全屏媒体查看器" : undefined}
              >
                <InlineMediaPreview isMobile={isMobile} file={file} mediaSource={mediaSource} />
              </div>
            </section>

            <aside style={infoPanelStyle(isMobile)}>
              <InfoCard isMobile={isMobile} label="活动">{event?.event_name || "-"}</InfoCard>
              <InfoCard isMobile={isMobile} label="文件名">{file.file_name || "-"}</InfoCard>
              <InfoCard isMobile={isMobile} label="上传者">{file.user_display_name || "-"}</InfoCard>
              <InfoCard isMobile={isMobile} label="拍摄/上传时间">{formatDate(file.created_at)}</InfoCard>
              <InfoCard isMobile={isMobile} label="查看状态">{viewStatus}</InfoCard>
              <InfoCard isMobile={isMobile} label="导航" fullWidth>
                <div style={navStackStyle}>
                  <button
                    type="button"
                    style={secondaryActionStyle(isMobile)}
                    disabled={!file.prev_id}
                    onClick={() => jumpToImage(file.prev_id)}
                  >
                    查看上一张
                  </button>
                  <button
                    type="button"
                    style={secondaryActionStyle(isMobile)}
                    disabled={!file.next_id}
                    onClick={() => jumpToImage(file.next_id)}
                  >
                    查看下一张
                  </button>
                </div>
              </InfoCard>
            </aside>
          </main>
        </div>
      </div>
      {viewer}
    </>
  );
}

function useImageDetail(imageId?: string) {
  const [state, setState] = useState<ImageDetailState>(INITIAL_STATE);
  const [reloadTick, setReloadTick] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!imageId) {
      setState({
        ...INITIAL_STATE,
        loading: false,
        error: "缺少 image_id",
      });
      return;
    }

    let active = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    void (async () => {
      try {
        const detail = await fetchFileDetail(imageId);
        const nextMediaSource = buildMediaSource(detail.file);

        if (!active || requestId !== requestIdRef.current) {
          return;
        }

        setState({
          file: detail.file,
          event: detail.event,
          mediaSource: nextMediaSource,
          loading: false,
          error: null,
        });

        if (nextMediaSource.kind === "unsupported") {
          return;
        }

        void resolveOriginalUrl(detail.file.id)
          .then((originalUrl) => {
            if (!active || requestId !== requestIdRef.current || !originalUrl) {
              return;
            }

            setState((current) => {
              if (current.file?.id !== detail.file.id || !current.mediaSource || current.mediaSource.kind === "unsupported") {
                return current;
              }
              return {
                ...current,
                mediaSource: {
                  ...current.mediaSource,
                  originalUrl,
                },
              };
            });
          })
          .catch(() => {});
      } catch (err) {
        if (!active || requestId !== requestIdRef.current) {
          return;
        }

        setState({
          file: null,
          event: null,
          mediaSource: null,
          loading: false,
          error: err instanceof Error ? err.message : "读取媒体失败",
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [imageId, reloadTick]);

  return {
    ...state,
    reloadCurrent: () => setReloadTick((current) => current + 1),
  };
}

function InfoCard({
  isMobile,
  label,
  children,
  fullWidth = false,
}: {
  isMobile: boolean;
  label: string;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div style={infoCardStyle(isMobile, fullWidth)}>
      <div style={infoLabelStyle}>{label}</div>
      <div style={infoValueStyle}>{children}</div>
    </div>
  );
}

function StatusScreen({ message, isError = false }: { message: string; isError?: boolean }) {
  return <div style={statusStyle(isError)}>{message}</div>;
}

function InlineMediaPreview({
  isMobile,
  file,
  mediaSource,
}: {
  isMobile: boolean;
  file: FileRecord;
  mediaSource: MediaSource | null;
}) {
  if (!mediaSource) {
    return <div style={unsupportedStateStyle}>媒体尚未准备好</div>;
  }

  if (mediaSource.kind === "unsupported") {
    return (
      <div style={unsupportedStateStyle}>
        <div style={unsupportedTitleStyle}>当前浏览器不支持直接预览此文件</div>
        <div style={unsupportedBodyStyle}>{mediaSource.reason}</div>
      </div>
    );
  }

  if (mediaSource.kind === "video") {
    return (
      <div style={previewStageStyle(isMobile)} onClick={(event) => event.stopPropagation()}>
        <CacheMediaPlayer
          fileId={mediaSource.fileId}
          fileType={mediaSource.fileType}
          alt={mediaSource.alt}
          variant="base"
          style={previewVideoStyle}
          videoAutoPlay={false}
          videoMuted={false}
          videoLoop={false}
          videoControls
        />
      </div>
    );
  }

  return (
    <div style={previewStageStyle(isMobile)}>
      <CacheMediaPlayer
        fileId={mediaSource.fileId}
        fileType={mediaSource.fileType}
        alt={mediaSource.alt || file.file_name || ""}
        variant="base"
        style={previewImageStyle}
      />
    </div>
  );
}

function ImageDetailViewer({ isMobile, file, mediaSource, loading, onClose, onPrev, onNext }: ViewerProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && onPrev) {
        onPrev();
        return;
      }
      if (event.key === "ArrowRight" && onNext) {
        onNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onPrev, onNext]);

  return createPortal(
    <div style={detachedOverlayStyle(isMobile)} onClick={onClose}>
      <div style={detachedShellStyle} onClick={(event) => event.stopPropagation()}>
        <div style={detachedToolbarStyle(isMobile)}>
          <div style={detachedMetaStyle}>
            <div style={detachedTitleStyle}>{file?.file_name || `文件 #${file?.id || "-"}`}</div>
            <div style={detachedHintStyle}>点击空白处或按 Esc 关闭</div>
          </div>
          <div style={detachedActionRowStyle(isMobile)}>
            <button type="button" style={detachedButtonStyle(isMobile)} disabled={!onPrev || loading} onClick={onPrev}>
              上一张
            </button>
            <button type="button" style={detachedButtonStyle(isMobile)} disabled={!onNext || loading} onClick={onNext}>
              下一张
            </button>
            <button type="button" style={detachedPrimaryButtonStyle(isMobile)} onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div style={detachedBodyStyle}>
          {loading ? (
            <div style={detachedStatusStyle}>媒体加载中…</div>
          ) : mediaSource?.kind === "unsupported" ? (
            <div style={detachedStatusStyle}>{mediaSource.reason}</div>
          ) : mediaSource?.kind === "video" ? (
            <div style={detachedMediaStageStyle(isMobile)}>
              <CacheMediaPlayer
                fileId={mediaSource.fileId}
                fileType={mediaSource.fileType}
                alt={mediaSource.alt}
                variant="base"
                style={detachedVideoStyle(isMobile)}
                videoAutoPlay
                videoMuted={false}
                videoLoop={false}
                videoControls
              />
            </div>
          ) : mediaSource?.kind === "image" ? (
            <div style={detachedMediaStageStyle(isMobile)}>
              <CacheMediaPlayer
                fileId={mediaSource.fileId}
                fileType={mediaSource.fileType}
                alt={mediaSource.alt || file?.file_name || ""}
                variant="base"
                style={detachedImageStyle(isMobile)}
              />
            </div>
          ) : (
            <div style={detachedStatusStyle}>媒体不存在</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

async function fetchFileDetail(imageId: string) {
  const response = await apiFetch(`/api/api/get_file_data/${imageId}`, { credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as FilePayload;

  if (!response.ok || payload.status !== "success") {
    throw new Error(payload.message || "读取媒体失败");
  }

  const file = payload.data?.file;
  if (!file) {
    throw new Error("文件不存在");
  }

  return {
    file,
    event: payload.data?.event || null,
  };
}

function buildMediaSource(file: FileRecord): MediaSource {
  const fileType = String(file.file_type || "").toLowerCase();

  if (isVideoFile(fileType)) {
    return {
      kind: "video",
      fileId: file.id,
      fileType: file.file_type,
      alt: file.file_name || `file-${file.id}`,
    };
  }

  if (!HEIC_EXTENSIONS.has(fileType) && !IMAGE_EXTENSIONS.has(fileType)) {
    return {
      kind: "unsupported",
      originalUrl: undefined,
      reason: `${String(file.file_type || "").toUpperCase()} 暂不支持浏览器内预览，请直接打开原文件。`,
    };
  }

  return {
    kind: "image",
    fileId: file.id,
    fileType: file.file_type,
    alt: file.file_name || `file-${file.id}`,
  };
}

async function resolveOriginalUrl(fileId: number): Promise<string | undefined> {
  const response = await apiFetch(`/media/get_event_image/${fileId}/base`, { credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as MediaInfoPayload;
  if (!response.ok || payload.status !== "success" || !payload.ready || !payload.path) {
    return undefined;
  }
  return resolveMediaFileUrl(payload.path);
}

function resolveMediaFileUrl(path?: string) {
  const normalized = String(path || "").trim();
  if (!normalized) {
    return undefined;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("/media_file/")) {
    return `${API_BASE}${normalized}`;
  }
  return `${API_BASE}/media_file/${normalized.replace(/^\/+/, "")}`;
}

function buildImageShareUrl(fileId: number) {
  const base = API_BASE || window.location.origin;
  return new URL(`/image/${fileId}`, base).toString();
}

function isVideoFile(fileType?: string) {
  return VIDEO_EXTENSIONS.has(String(fileType || "").toLowerCase());
}

function canRotateFile(fileType?: string) {
  return ROTATABLE_EXTENSIONS.has(String(fileType || "").toLowerCase());
}

function formatDate(value?: string) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

async function buildShareFile(url: string, file: FileRecord): Promise<File | null> {
  try {
    const response = await apiFetch(url, { credentials: "include" });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const mimeType = blob.type || imageMimeType(file.file_type);
    if (!mimeType.startsWith("image/")) {
      return null;
    }
    return new File([blob], shareFileName(file), { type: mimeType });
  } catch {
    return null;
  }
}

function canNavigatorShareFiles(files: File[]) {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.canShare !== "function") {
    return true;
  }
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

function shareFileName(file: FileRecord) {
  const existing = String(file.file_name || "").trim();
  if (existing) {
    return existing;
  }
  const extension = String(file.file_type || "jpg").replace(/^\.+/, "") || "jpg";
  return `image-${file.id}.${extension}`;
}

function imageMimeType(fileType?: string) {
  const normalized = String(fileType || "").toLowerCase();
  if (normalized === "jpg") return "image/jpeg";
  if (normalized === "heic") return "image/heic";
  if (normalized === "heif") return "image/heif";
  return normalized ? `image/${normalized}` : "image/jpeg";
}

function fileMimeType(fileType?: string) {
  const normalized = String(fileType || "").toLowerCase();
  if (IMAGE_EXTENSIONS.has(normalized) || HEIC_EXTENSIONS.has(normalized)) {
    return imageMimeType(normalized);
  }
  if (normalized === "mp4") return "video/mp4";
  if (normalized === "mov") return "video/quicktime";
  if (normalized === "webm") return "video/webm";
  return "application/octet-stream";
}

function isShareAbort(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || /cancel/i.test(error.message);
}

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  background: "linear-gradient(180deg, var(--x-color-canvas) 0%, var(--x-color-panel-alt) 48%, var(--x-color-accent-soft) 100%)",
  position: "relative",
  overflow: "hidden",
};

const pageGlowStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(circle at 8% 12%, rgba(217, 119, 6, 0.12), transparent 26%), radial-gradient(circle at 88% 14%, rgba(29, 78, 216, 0.12), transparent 24%), radial-gradient(circle at 50% 100%, rgba(15, 118, 110, 0.14), transparent 28%)",
  pointerEvents: "none",
};

function shellStyle(isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    zIndex: 1,
    maxWidth: "1440px",
    margin: "0 auto",
    padding: isMobile ? "14px 10px 20px" : "24px 16px 32px",
    display: "grid",
    gap: isMobile ? "12px" : "18px",
  };
}

function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    padding: "14px",
    borderRadius: "22px",
    background: "var(--x-color-panel-glass)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 18px 34px var(--x-color-shadow-soft)",
    backdropFilter: "blur(16px)",
  };
}

function toolbarGroupStyle(isMobile: boolean): CSSProperties {
  return {
    display: isMobile ? "grid" : "flex",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : undefined,
    gap: "10px",
    flexWrap: "wrap",
    width: isMobile ? "100%" : undefined,
  };
}

function contentStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 320px",
    gap: isMobile ? "12px" : "18px",
    alignItems: "start",
  };
}

function viewerPanelStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "12px" : "18px",
    borderRadius: isMobile ? "22px" : "30px",
    background: "var(--x-color-panel-glass)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 24px 50px var(--x-color-shadow-soft)",
    display: "grid",
    gap: isMobile ? "12px" : "16px",
  };
}

const inlineErrorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "18px",
  background: "var(--x-color-danger-soft)",
  border: "1px solid var(--x-color-danger-border)",
  color: "var(--x-color-danger)",
  fontSize: "14px",
  fontWeight: 700,
};

const inlineNoticeStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "18px",
  background: "var(--x-color-accent-soft)",
  border: "1px solid var(--x-color-accent-border)",
  color: "var(--x-color-accent-strong)",
  fontSize: "14px",
  fontWeight: 700,
};

const viewerHeaderStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--x-color-warning)",
};

function viewerTitleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: 0,
    fontSize: isMobile ? "clamp(22px, 7vw, 30px)" : "clamp(24px, 4vw, 42px)",
    lineHeight: 1.02,
    color: "var(--x-color-ink)",
  };
}

function viewerMetaStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    gap: isMobile ? "6px" : "8px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
  };
}

function viewerFrameStyle(isMobile: boolean, interactive: boolean): CSSProperties {
  return {
    minHeight: isMobile ? "min(54vh, 520px)" : "min(72vh, 760px)",
    borderRadius: isMobile ? "22px" : "28px",
    overflow: "hidden",
    background: "linear-gradient(145deg, var(--x-color-nav-start), #0f172a 58%, #111827)",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
    cursor: interactive ? "zoom-in" : "default",
    border: "none",
    width: "100%",
    textAlign: "left",
  };
}

function previewStageStyle(isMobile: boolean): CSSProperties {
  return {
    minHeight: isMobile ? "min(48vh, 420px)" : "min(72vh, 716px)",
    display: "grid",
    placeItems: "center",
    width: "100%",
    height: "100%",
    padding: isMobile ? "10px" : "clamp(12px, 2vw, 22px)",
    boxSizing: "border-box",
  };
}

const previewImageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  maxWidth: "100%",
  maxHeight: "min(68vh, 680px)",
  objectFit: "contain",
  objectPosition: "center center",
};

const previewVideoStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  maxWidth: "100%",
  maxHeight: "min(68vh, 680px)",
  objectFit: "contain",
  objectPosition: "center center",
  background: "#000",
  borderRadius: "18px",
};

const unsupportedStateStyle: CSSProperties = {
  minHeight: "min(72vh, 716px)",
  display: "grid",
  gap: "10px",
  placeItems: "center",
  textAlign: "center",
  color: "#e2e8f0",
  padding: "24px",
};

const unsupportedTitleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
};

const unsupportedBodyStyle: CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.6,
  maxWidth: "420px",
  color: "rgba(226, 232, 240, 0.82)",
};

function infoPanelStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: isMobile ? "10px" : "14px",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "1fr",
  };
}

function infoCardStyle(isMobile: boolean, fullWidth: boolean): CSSProperties {
  return {
    padding: isMobile ? "12px" : "16px",
    borderRadius: isMobile ? "18px" : "22px",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 16px 30px var(--x-color-shadow-soft)",
    display: "grid",
    gap: "8px",
    gridColumn: isMobile && fullWidth ? "1 / -1" : undefined,
  };
}

const infoLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-warning)",
};

const infoValueStyle: CSSProperties = {
  fontSize: "15px",
  lineHeight: 1.55,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

const navStackStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

function ghostButtonStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "10px 12px" : "11px 15px",
    borderRadius: isMobile ? "16px" : "999px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-strongest)",
    color: "var(--x-color-ink)",
    cursor: "pointer",
    fontWeight: 700,
    width: isMobile ? "100%" : undefined,
  };
}

function primaryButtonStyle(isMobile: boolean): CSSProperties {
  return {
    ...ghostButtonStyle(isMobile),
    background: "linear-gradient(135deg, var(--x-color-warning), var(--x-color-danger))",
    color: "white",
    border: "none",
  };
}

function secondaryActionStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "11px 12px" : "12px 14px",
    borderRadius: "16px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    cursor: "pointer",
    fontWeight: 700,
    textAlign: "left",
    width: isMobile ? "100%" : undefined,
  };
}

function detachedOverlayStyle(isMobile: boolean): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex: 10050,
    background: "rgba(6, 10, 18, 0.86)",
    backdropFilter: "blur(10px)",
    padding: isMobile ? "10px" : "18px",
    boxSizing: "border-box",
  };
}

const detachedShellStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: "12px",
};

function detachedToolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "stretch" : "center",
    flexDirection: isMobile ? "column" : "row",
    gap: "12px",
    flexWrap: "wrap",
    padding: isMobile ? "12px" : "14px 16px",
    borderRadius: "20px",
    background: "rgba(15, 23, 42, 0.72)",
    border: "1px solid rgba(255,255,255,0.08)",
  };
}

const detachedMetaStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const detachedTitleStyle: CSSProperties = {
  color: "#f8fafc",
  fontSize: "18px",
  fontWeight: 800,
  wordBreak: "break-word",
};

const detachedHintStyle: CSSProperties = {
  color: "rgba(226, 232, 240, 0.78)",
  fontSize: "13px",
};

function detachedActionRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : undefined,
    gap: "10px",
    flexWrap: "wrap",
    width: isMobile ? "100%" : undefined,
  };
}

function detachedButtonStyle(isMobile: boolean): CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: isMobile ? "16px" : "999px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "#f8fafc",
    cursor: "pointer",
    fontWeight: 700,
    width: isMobile ? "100%" : undefined,
  };
}

function detachedPrimaryButtonStyle(isMobile: boolean): CSSProperties {
  return {
    ...detachedButtonStyle(isMobile),
    background: "linear-gradient(135deg, var(--x-color-warning), var(--x-color-danger))",
    border: "none",
  };
}

const detachedBodyStyle: CSSProperties = {
  minHeight: 0,
  borderRadius: "24px",
  overflow: "hidden",
  background: "rgba(2, 6, 23, 0.92)",
  position: "relative",
  display: "grid",
};

const detachedStatusStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: "60vh",
  display: "grid",
  placeItems: "center",
  color: "#e2e8f0",
  fontSize: "15px",
};

function detachedMediaStageStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    padding: isMobile ? "12px" : "24px",
    boxSizing: "border-box",
  };
}

function detachedImageStyle(isMobile: boolean): CSSProperties {
  return {
    display: "block",
    maxWidth: isMobile ? "calc(100vw - 32px)" : "calc(100vw - 84px)",
    maxHeight: isMobile ? "calc(100vh - 132px)" : "calc(100vh - 156px)",
    width: "auto",
    height: "auto",
    objectFit: "contain",
    objectPosition: "center center",
  };
}

function detachedVideoStyle(isMobile: boolean): CSSProperties {
  return {
    display: "block",
    maxWidth: isMobile ? "calc(100vw - 32px)" : "calc(100vw - 84px)",
    maxHeight: isMobile ? "calc(100vh - 132px)" : "calc(100vh - 156px)",
    width: "auto",
    height: "auto",
    objectFit: "contain",
    objectPosition: "center center",
    background: "#000",
    borderRadius: isMobile ? "14px" : "18px",
  };
}

function statusStyle(isError: boolean): CSSProperties {
  return {
    minHeight: "calc(100vh - 60px)",
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(180deg, var(--x-color-canvas) 0%, var(--x-color-panel-alt) 48%, var(--x-color-accent-soft) 100%)",
    color: isError ? "var(--x-color-danger)" : "var(--x-color-ink)",
    padding: "24px",
  };
}
