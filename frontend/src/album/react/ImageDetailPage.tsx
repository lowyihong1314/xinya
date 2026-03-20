import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createRoot, type Root } from "react-dom/client";
import heic2any from "heic2any";

import { CacheMediaPlayer } from "../../components/CacheMediaPlayer";
import { ensureDesignTokens } from "../../theme/designTokens";
import { useUserState } from "../../app/UserState";

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

type SlideSource = {
  kind: "slide";
  slide: {
    type?: "video";
    src: string;
    alt?: string;
  };
  originalUrl: string;
  objectUrl?: string;
  fileId?: number;
  fileType?: string;
};

type UnsupportedSource = {
  kind: "unsupported";
  originalUrl: string;
  reason: string;
};

type MediaSource = SlideSource | UnsupportedSource;

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "avi", "mkv", "webm", "flv", "mts", "m2ts", "3gp", "wmv"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp", "tif", "tiff", "webp"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
const ROTATABLE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "heic"]);

export function ImageDetailPage() {
  ensureDesignTokens();

  const navigate = useNavigate();
  const { imageId } = useParams();
  const { isMobile } = useUserState();

  const [file, setFile] = useState<FileRecord | null>(null);
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    if (!imageId) {
      setError("缺少 image_id");
      setLoading(false);
      return;
    }
    void loadData(imageId);
  }, [imageId]);

  useEffect(() => {
    return () => {
      cleanupMediaSource(mediaSource);
    };
  }, [mediaSource]);

  useEffect(() => {
    if (!viewerOpen) {
      renderDetachedViewer(null);
      return;
    }

    renderDetachedViewer({
      file,
      mediaSource,
      loading,
      onClose: () => setViewerOpen(false),
      onPrev: file?.prev_id ? () => navigate(`/image/${file.prev_id}`) : undefined,
      onNext: file?.next_id ? () => navigate(`/image/${file.next_id}`) : undefined,
    });
  }, [viewerOpen, file, mediaSource, loading, navigate]);

  useEffect(() => () => renderDetachedViewer(null), []);

  async function loadData(id: string) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/api/get_file_data/${id}`, { credentials: "include" });
      const payload = (await response.json().catch(() => ({}))) as FilePayload;

      if (!response.ok || payload.status !== "success") {
        throw new Error(payload.message || "读取媒体失败");
      }

      const nextFile = payload.data?.file;
      if (!nextFile) {
        throw new Error("文件不存在");
      }

      setMediaSource((current) => {
        cleanupMediaSource(current);
        return null;
      });

      const nextSource = await resolveMediaSource(nextFile);
      setMediaSource(nextSource);
      setFile(nextFile);
      setEvent(payload.data?.event || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取媒体失败");
      setFile(null);
      setEvent(null);
      setMediaSource((current) => {
        cleanupMediaSource(current);
        return null;
      });
    } finally {
      setLoading(false);
    }
  }

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

  function openOriginal() {
    if (!mediaSource) {
      return;
    }
    window.open(mediaSource.originalUrl, "_blank", "noopener,noreferrer");
  }

  function toggleViewer() {
    if (mediaSource?.kind !== "slide") {
      return;
    }
    setViewerOpen((current) => !current);
  }

  async function rotateImage(angle: number) {
    if (!file || !canRotateFile(file.file_type)) {
      return;
    }

    setRotating(true);
    setError(null);
    try {
      const response = await fetch(`/media/rotate_file/${file.id}/${angle}`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "旋转失败");
      }
      await loadData(String(file.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "旋转失败");
    } finally {
      setRotating(false);
    }
  }

  if (loading) {
    return <div style={statusStyle(false)}>媒体加载中…</div>;
  }

  if (error || !file) {
    return <div style={statusStyle(true)}>{error || "媒体不存在"}</div>;
  }

  const isVideo = isVideoFile(file.file_type);
  const canRotate = canRotateFile(file.file_type);
  const supportsViewer = mediaSource?.kind === "slide";
  const viewStatus = isVideo
    ? `视频模式，点击${viewerOpen ? "关闭" : "打开"}全屏查看，支持播放与原文件打开`
    : supportsViewer
      ? `图片查看模式，点击${viewerOpen ? "关闭" : "打开"}全屏查看`
      : "当前文件建议打开原文件查看";

  return (
    <div style={pageStyle}>
      <div style={pageGlowStyle} />
      <div style={shellStyle}>
        <header style={toolbarStyle(isMobile)}>
          <div style={toolbarGroupStyle(isMobile)}>
            <button type="button" style={ghostButtonStyle} onClick={goBack}>
              返回活动
            </button>
            <button type="button" style={ghostButtonStyle} disabled={!file.prev_id} onClick={() => jumpToImage(file.prev_id)}>
              上一张
            </button>
            <button type="button" style={ghostButtonStyle} disabled={!file.next_id} onClick={() => jumpToImage(file.next_id)}>
              下一张
            </button>
          </div>
          <div style={toolbarGroupStyle(isMobile)}>
            {!isVideo ? (
              <>
                <button type="button" style={ghostButtonStyle} disabled={rotating || !canRotate} onClick={() => void rotateImage(-90)}>
                  左转
                </button>
                <button type="button" style={ghostButtonStyle} disabled={rotating || !canRotate} onClick={() => void rotateImage(90)}>
                  {rotating ? "旋转中…" : "右转"}
                </button>
              </>
            ) : null}
            <button type="button" style={primaryButtonStyle} onClick={openOriginal}>
              打开原图
            </button>
          </div>
        </header>

        <main style={contentStyle(isMobile)}>
          <section style={viewerPanelStyle}>
            <div style={viewerHeaderStyle}>
              <div style={eyebrowStyle}>Media Viewer</div>
              <h1 style={viewerTitleStyle}>{event?.event_name || file.file_name || `文件 #${file.id}`}</h1>
              <div style={viewerMetaStyle}>
                <span>ID {file.id}</span>
                <span>{String(file.file_type || "-").toUpperCase()}</span>
                <span>{formatDate(file.created_at)}</span>
              </div>
            </div>

            <div style={viewerFrameStyle(isMobile, supportsViewer)} onClick={toggleViewer}>
              {mediaSource?.kind === "slide" ? (
                <div style={previewStageStyle}>
                  {mediaSource.slide.type === "video" ? (
                    <div onClick={(event) => event.stopPropagation()}>
                      <CacheMediaPlayer
                        fileId={mediaSource.fileId}
                        fileType={mediaSource.fileType}
                        variant="base"
                        style={previewVideoStyle}
                        videoAutoPlay={false}
                        videoMuted={false}
                        videoLoop={false}
                        videoControls
                      />
                    </div>
                  ) : (
                    <img src={mediaSource.slide.src} alt={mediaSource.slide.alt || file.file_name || ""} style={previewImageStyle} />
                  )}
                </div>
              ) : (
                <div style={unsupportedStateStyle}>
                  <div style={unsupportedTitleStyle}>当前浏览器不支持直接预览此文件</div>
                  <div style={unsupportedBodyStyle}>{mediaSource?.reason || "请直接打开原文件查看。"}</div>
                </div>
              )}
            </div>
          </section>

          <aside style={infoPanelStyle}>
            <div style={infoCardStyle(isMobile)}>
              <div style={infoLabelStyle}>活动</div>
              <div style={infoValueStyle}>{event?.event_name || "-"}</div>
            </div>
            <div style={infoCardStyle(isMobile)}>
              <div style={infoLabelStyle}>文件名</div>
              <div style={infoValueStyle}>{file.file_name || "-"}</div>
            </div>
            <div style={infoCardStyle(isMobile)}>
              <div style={infoLabelStyle}>上传者</div>
              <div style={infoValueStyle}>{file.user_display_name || "-"}</div>
            </div>
            <div style={infoCardStyle(isMobile)}>
              <div style={infoLabelStyle}>拍摄/上传时间</div>
              <div style={infoValueStyle}>{formatDate(file.created_at)}</div>
            </div>
            <div style={infoCardStyle(isMobile)}>
              <div style={infoLabelStyle}>查看状态</div>
              <div style={infoValueStyle}>{viewStatus}</div>
            </div>
            <div style={infoCardStyle(isMobile)}>
              <div style={infoLabelStyle}>导航</div>
              <div style={navStackStyle}>
                <button
                  type="button"
                  style={secondaryActionStyle}
                  disabled={!file.prev_id}
                  onClick={() => jumpToImage(file.prev_id)}
                >
                  查看上一张
                </button>
                <button
                  type="button"
                  style={secondaryActionStyle}
                  disabled={!file.next_id}
                  onClick={() => jumpToImage(file.next_id)}
                >
                  查看下一张
                </button>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}

async function resolveMediaSource(file: FileRecord): Promise<MediaSource> {
  const response = await fetch(`/media/get_event_image/${file.id}/base`, { credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as MediaInfoPayload;

  if (!response.ok || payload.status !== "success" || !payload.ready || !payload.path) {
    throw new Error("媒体文件尚未准备好");
  }

  const fileType = String(file.file_type || "").toLowerCase();
  const mediaPath = `/media_file/${payload.path}`;

  if (isVideoFile(fileType)) {
    return {
      kind: "slide",
      originalUrl: mediaPath,
      fileId: file.id,
      fileType: file.file_type,
      slide: {
        type: "video",
        width: 1920,
        height: 1080,
        autoPlay: true,
        controls: true,
        playsInline: true,
        sources: [
          {
            src: mediaPath,
            type: `video/${fileType === "m4v" ? "mp4" : fileType || "mp4"}`,
          },
        ],
      },
    };
  }

  if (!HEIC_EXTENSIONS.has(fileType) && !IMAGE_EXTENSIONS.has(fileType)) {
    return {
      kind: "unsupported",
      originalUrl: mediaPath,
      reason: `${String(file.file_type || "").toUpperCase()} 暂不支持浏览器内预览，请直接打开原文件。`,
    };
  }

  const responseBlob = await fetch(mediaPath, { credentials: "include" });
  if (!responseBlob.ok) {
    throw new Error("图片读取失败");
  }

  let blob = await responseBlob.blob();
  if (HEIC_EXTENSIONS.has(fileType)) {
    let converted = await heic2any({
      blob,
      toType: "image/jpeg",
      quality: 0.92,
    });
    if (Array.isArray(converted)) {
      converted = converted[0];
    }
    blob = converted as Blob;
  }

  const objectUrl = URL.createObjectURL(blob);
  const { width, height } = await readImageDimensions(objectUrl);

  return {
    kind: "slide",
    originalUrl: mediaPath,
    objectUrl,
    slide: {
      src: objectUrl,
      alt: file.file_name || `file-${file.id}`,
      width,
      height,
    },
  };
}

function cleanupMediaSource(source: MediaSource | null) {
  if (!source || source.kind !== "slide" || !source.objectUrl) {
    return;
  }
  URL.revokeObjectURL(source.objectUrl);
}

type DetachedViewerState = {
  file: FileRecord | null;
  mediaSource: MediaSource | null;
  loading: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
};

let detachedViewerHost: HTMLDivElement | null = null;
let detachedViewerRoot: Root | null = null;

function renderDetachedViewer(state: DetachedViewerState | null) {
  if (!state) {
    detachedViewerRoot?.unmount();
    detachedViewerHost?.remove();
    detachedViewerRoot = null;
    detachedViewerHost = null;
    return;
  }

  if (!detachedViewerHost) {
    detachedViewerHost = document.createElement("div");
    detachedViewerHost.dataset.xinyaDetachedViewer = "true";
    document.body.appendChild(detachedViewerHost);
    detachedViewerRoot = createRoot(detachedViewerHost);
  }

  detachedViewerRoot?.render(<DetachedMediaViewer {...state} />);
}

function DetachedMediaViewer({ file, mediaSource, loading, onClose, onPrev, onNext }: DetachedViewerState) {
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

  return (
    <div style={detachedOverlayStyle} onClick={onClose}>
      <div style={detachedShellStyle} onClick={(event) => event.stopPropagation()}>
        <div style={detachedToolbarStyle}>
          <div style={detachedMetaStyle}>
            <div style={detachedTitleStyle}>{file?.file_name || `文件 #${file?.id || "-"}`}</div>
            <div style={detachedHintStyle}>点击空白处或按 Esc 关闭</div>
          </div>
          <div style={detachedActionRowStyle}>
            <button type="button" style={detachedButtonStyle} disabled={!onPrev || loading} onClick={onPrev}>
              上一张
            </button>
            <button type="button" style={detachedButtonStyle} disabled={!onNext || loading} onClick={onNext}>
              下一张
            </button>
            <button type="button" style={detachedPrimaryButtonStyle} onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div style={detachedBodyStyle}>
          {loading ? (
            <div style={detachedStatusStyle}>媒体加载中…</div>
          ) : mediaSource?.kind === "slide" ? (
            <div style={detachedMediaStageStyle}>
              {mediaSource.slide.type === "video" ? (
                <CacheMediaPlayer
                  fileId={mediaSource.fileId}
                  fileType={mediaSource.fileType}
                  variant="base"
                  style={detachedVideoStyle}
                  videoAutoPlay
                  videoMuted={false}
                  videoLoop={false}
                  videoControls
                />
              ) : (
                <img
                  src={mediaSource.slide.src}
                  alt={mediaSource.slide.alt || file?.file_name || ""}
                  style={detachedImageStyle}
                  onClick={(event) => event.stopPropagation()}
                />
              )}
            </div>
          ) : (
            <div style={detachedStatusStyle}>{mediaSource?.reason || "当前文件建议打开原文件查看"}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function readImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = src;
  });
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

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  background: "linear-gradient(180deg, #f3efe6 0%, #f7f3eb 44%, #ece5d8 100%)",
  position: "relative",
  overflow: "hidden",
};

const pageGlowStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(circle at 8% 12%, rgba(180, 114, 55, 0.18), transparent 26%), radial-gradient(circle at 88% 14%, rgba(32, 91, 120, 0.14), transparent 24%), radial-gradient(circle at 50% 100%, rgba(215, 166, 93, 0.14), transparent 28%)",
  pointerEvents: "none",
};

const shellStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  maxWidth: "1440px",
  margin: "0 auto",
  padding: "24px 16px 32px",
  display: "grid",
  gap: "18px",
};

function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    padding: "14px",
    borderRadius: "22px",
    background: "rgba(255,255,255,0.72)",
    border: "1px solid rgba(112, 82, 45, 0.12)",
    boxShadow: "0 18px 34px rgba(101, 77, 46, 0.12)",
    backdropFilter: "blur(16px)",
  };
}

function toolbarGroupStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    width: isMobile ? "100%" : undefined,
  };
}

function contentStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 320px",
    gap: "18px",
    alignItems: "start",
  };
}

const viewerPanelStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "30px",
  background: "rgba(255,255,255,0.78)",
  border: "1px solid rgba(112, 82, 45, 0.12)",
  boxShadow: "0 24px 50px rgba(71, 57, 39, 0.12)",
  display: "grid",
  gap: "16px",
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
  color: "#8f6644",
};

const viewerTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(24px, 4vw, 42px)",
  lineHeight: 1.02,
  color: "#1f2937",
};

const viewerMetaStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  color: "#6b7280",
  fontSize: "13px",
};

function viewerFrameStyle(isMobile: boolean, interactive: boolean): CSSProperties {
  return {
    minHeight: isMobile ? "min(54vh, 520px)" : "min(72vh, 760px)",
    borderRadius: isMobile ? "22px" : "28px",
    overflow: "hidden",
    background: "linear-gradient(145deg, #1e293b, #0f172a 58%, #111827)",
    padding: "clamp(12px, 2vw, 22px)",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
    cursor: interactive ? "pointer" : "default",
  };
}

const previewStageStyle: CSSProperties = {
  minHeight: "min(72vh, 716px)",
  display: "grid",
  placeItems: "center",
};

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

const infoPanelStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

function infoCardStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "14px" : "16px",
    borderRadius: "22px",
    background: "rgba(255,255,255,0.82)",
    border: "1px solid rgba(112, 82, 45, 0.12)",
    boxShadow: "0 16px 30px rgba(71, 57, 39, 0.08)",
    display: "grid",
    gap: "8px",
  };
}

const infoLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#9a7152",
};

const infoValueStyle: CSSProperties = {
  fontSize: "15px",
  lineHeight: 1.55,
  color: "#1f2937",
  wordBreak: "break-word",
};

const navStackStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const ghostButtonStyle: CSSProperties = {
  padding: "11px 15px",
  borderRadius: "999px",
  border: "1px solid rgba(112, 82, 45, 0.14)",
  background: "rgba(255,255,255,0.82)",
  color: "#1f2937",
  cursor: "pointer",
  fontWeight: 700,
};

const primaryButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  background: "linear-gradient(135deg, #a16207, #c08427)",
  color: "white",
  border: "none",
};

const secondaryActionStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "16px",
  border: "1px solid rgba(112, 82, 45, 0.12)",
  background: "#fffdf9",
  color: "#1f2937",
  cursor: "pointer",
  fontWeight: 700,
  textAlign: "left",
};

const detachedOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10050,
  background: "rgba(6, 10, 18, 0.86)",
  backdropFilter: "blur(10px)",
  padding: "18px",
  boxSizing: "border-box",
};

const detachedShellStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: "12px",
};

const detachedToolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
  padding: "14px 16px",
  borderRadius: "20px",
  background: "rgba(15, 23, 42, 0.72)",
  border: "1px solid rgba(255,255,255,0.08)",
};

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

const detachedActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const detachedButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "#f8fafc",
  cursor: "pointer",
  fontWeight: 700,
};

const detachedPrimaryButtonStyle: CSSProperties = {
  ...detachedButtonStyle,
  background: "linear-gradient(135deg, #a16207, #c08427)",
  border: "none",
};

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

const detachedMediaStageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  boxSizing: "border-box",
};

const detachedImageStyle: CSSProperties = {
  display: "block",
  maxWidth: "calc(100vw - 84px)",
  maxHeight: "calc(100vh - 156px)",
  width: "auto",
  height: "auto",
  objectFit: "contain",
  objectPosition: "center center",
};

const detachedVideoStyle: CSSProperties = {
  display: "block",
  maxWidth: "calc(100vw - 84px)",
  maxHeight: "calc(100vh - 156px)",
  width: "auto",
  height: "auto",
  objectFit: "contain",
  objectPosition: "center center",
  background: "#000",
  borderRadius: "18px",
};

function statusStyle(isError: boolean): CSSProperties {
  return {
    minHeight: "calc(100vh - 60px)",
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(180deg, #f3efe6 0%, #f7f3eb 44%, #ece5d8 100%)",
    color: isError ? "#b91c1c" : "#1f2937",
    padding: "24px",
  };
}
