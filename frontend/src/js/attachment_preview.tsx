import { useEffect, useState, type CSSProperties } from "react";
import heic2any from "heic2any";

import { openOverlay } from "../app/OverlayProvider";
import { CachedImage, CachedVideo } from "../components/CachedMedia";
import { API_BASE } from "./apiBase";
import { downloadUrlOrShare } from "./browserActions";

type AttachmentRecord = {
  file_name?: string;
  file_path: string;
  mime_type?: string;
};

type PreviewMode = "image" | "video" | "pdf" | "audio" | "text" | "unsupported" | "error" | "loading";

type PreviewState = {
  mode: PreviewMode;
  objectUrl: string;
  textContent: string;
  errorMessage: string;
  sizeLabel: string;
  mimeLabel: string;
  extLabel: string;
};

const MEDIA_FILE_PREFIX = "/media_file/";
const MEDIA_API_FILE_PREFIX = "/media/file/";

function getExt(name = "", mime = "") {
  const normalizedName = name.toLowerCase();
  const normalizedMime = mime.toLowerCase();
  const ext = normalizedName.includes(".") ? normalizedName.split(".").pop() || "" : "";
  return ext || (normalizedMime.includes("/") ? normalizedMime.split("/").pop() || "" : "");
}

function isImage(ext: string, mime: string) {
  return ["png", "jpg", "jpeg", "webp", "bmp", "svg"].includes(ext) || mime.toLowerCase().startsWith("image/");
}

function isHeic(ext: string, mime: string) {
  const normalizedMime = mime.toLowerCase();
  return ["heic", "heif"].includes(ext) || normalizedMime.includes("heic") || normalizedMime.includes("heif");
}

function isPdf(ext: string, mime: string) {
  return ext === "pdf" || mime.toLowerCase().includes("pdf");
}

function isVideo(ext: string, mime: string) {
  const normalizedMime = mime.toLowerCase();
  return ["mp4", "webm", "ogg", "mov", "m4v"].includes(ext) || normalizedMime.startsWith("video/");
}

function isAudio(ext: string, mime: string) {
  const normalizedMime = mime.toLowerCase();
  return ["mp3", "wav", "m4a", "aac", "ogg"].includes(ext) || normalizedMime.startsWith("audio/");
}

function isText(ext: string, mime: string) {
  const normalizedMime = mime.toLowerCase();
  return ["txt", "json", "csv", "md", "log"].includes(ext) || normalizedMime.startsWith("text/");
}

function getFileUrl(attachment: AttachmentRecord) {
  const rawPath = String(attachment.file_path || "").trim();
  if (!rawPath) {
    return MEDIA_FILE_PREFIX;
  }

  if (/^https?:\/\//i.test(rawPath)) {
    return rawPath;
  }

  const normalizedPath = rawPath.replace(/\\/g, "/");
  if (normalizedPath.startsWith(MEDIA_FILE_PREFIX)) {
    return normalizedPath;
  }
  if (normalizedPath.startsWith("media_file/")) {
    return `/${normalizedPath}`;
  }

  return `/media_file/${normalizedPath.replace(/^\/+/, "")}`;
}

function toMediaApiFileUrl(fileUrl: string) {
  if (/^https?:\/\//i.test(fileUrl)) {
    try {
      const parsed = new URL(fileUrl);
      if (parsed.pathname.startsWith(MEDIA_FILE_PREFIX)) {
        return `${MEDIA_API_FILE_PREFIX}${parsed.pathname.slice(MEDIA_FILE_PREFIX.length)}${parsed.search}`;
      }
    } catch {
      return fileUrl;
    }
    return fileUrl;
  }

  if (fileUrl.startsWith(MEDIA_FILE_PREFIX)) {
    return `${MEDIA_API_FILE_PREFIX}${fileUrl.slice(MEDIA_FILE_PREFIX.length)}`;
  }
  if (fileUrl.startsWith("media_file/")) {
    return `${MEDIA_API_FILE_PREFIX}${fileUrl.slice("media_file/".length)}`;
  }

  return fileUrl;
}

function resolveFileFetchUrl(fileUrl: string) {
  const fetchUrl = toMediaApiFileUrl(fileUrl);
  if (fetchUrl.startsWith("/") && API_BASE) {
    return `${API_BASE}${fetchUrl}`;
  }
  return fetchUrl;
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "未知大小";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function loadPreview(attachment: AttachmentRecord) {
  const fileName = attachment.file_name || attachment.file_path || "附件预览";
  const mime = attachment.mime_type || "";
  const ext = getExt(fileName, mime);
  const fileUrl = getFileUrl(attachment);
  let response: Response;
  try {
    response = await fetch(resolveFileFetchUrl(fileUrl), { credentials: "omit" });
  } catch (error) {
    throw new Error(error instanceof Error ? `附件读取失败：${error.message}` : "附件读取失败");
  }

  if (!response.ok) {
    throw new Error(`附件读取失败 (${response.status})`);
  }

  const blob = await response.blob();
  const sizeLabel = formatBytes(blob.size);
  const mimeLabel = blob.type || mime || "未知类型";
  const extLabel = ext ? ext.toUpperCase() : "FILE";

  if (isHeic(ext, mimeLabel)) {
    const converted = await heic2any({ blob, toType: "image/jpeg", quality: 0.92 });
    const normalized = Array.isArray(converted) ? converted[0] : converted;
    return {
      mode: "image" as const,
      objectUrl: URL.createObjectURL(normalized as Blob),
      textContent: "",
      errorMessage: "",
      sizeLabel,
      mimeLabel,
      extLabel,
    };
  }

  if (isImage(ext, mimeLabel)) {
    return {
      mode: "image" as const,
      objectUrl: URL.createObjectURL(blob),
      textContent: "",
      errorMessage: "",
      sizeLabel,
      mimeLabel,
      extLabel,
    };
  }

  if (isVideo(ext, mimeLabel)) {
    return {
      mode: "video" as const,
      objectUrl: URL.createObjectURL(blob),
      textContent: "",
      errorMessage: "",
      sizeLabel,
      mimeLabel,
      extLabel,
    };
  }

  if (isAudio(ext, mimeLabel)) {
    return {
      mode: "audio" as const,
      objectUrl: URL.createObjectURL(blob),
      textContent: "",
      errorMessage: "",
      sizeLabel,
      mimeLabel,
      extLabel,
    };
  }

  if (isPdf(ext, mimeLabel)) {
    return {
      mode: "pdf" as const,
      objectUrl: URL.createObjectURL(blob),
      textContent: "",
      errorMessage: "",
      sizeLabel,
      mimeLabel,
      extLabel,
    };
  }

  if (isText(ext, mimeLabel)) {
    return {
      mode: "text" as const,
      objectUrl: URL.createObjectURL(blob),
      textContent: await blob.text(),
      errorMessage: "",
      sizeLabel,
      mimeLabel,
      extLabel,
    };
  }

  return {
    mode: "unsupported" as const,
    objectUrl: URL.createObjectURL(blob),
    textContent: "",
    errorMessage: "",
    sizeLabel,
    mimeLabel,
    extLabel,
  };
}

function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: AttachmentRecord;
  onClose: () => void;
}) {
  const isMobile = typeof window !== "undefined" ? window.innerWidth <= 768 : false;
  const fileName = attachment.file_name || attachment.file_path || "附件预览";
  const fileUrl = getFileUrl(attachment);
  const [preview, setPreview] = useState<PreviewState>({
    mode: "loading",
    objectUrl: "",
    textContent: "",
    errorMessage: "",
    sizeLabel: "读取中",
    mimeLabel: attachment.mime_type || "未知类型",
    extLabel: getExt(fileName, attachment.mime_type || "").toUpperCase() || "FILE",
  });
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    let currentObjectUrl = "";

    void (async () => {
      try {
        const nextPreview = await loadPreview(attachment);
        currentObjectUrl = nextPreview.objectUrl;
        if (active) {
          setPreview(nextPreview);
        }
      } catch (error) {
        if (active) {
          setPreview({
            mode: "error",
            objectUrl: "",
            textContent: "",
            errorMessage: error instanceof Error ? error.message : "预览失败",
            sizeLabel: "未知大小",
            mimeLabel: attachment.mime_type || "未知类型",
            extLabel: getExt(fileName, attachment.mime_type || "").toUpperCase() || "FILE",
          });
        }
      }
    })();

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeydown);

    return () => {
      active = false;
      window.removeEventListener("keydown", handleKeydown);
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
      }
    };
  }, [attachment, fileName, onClose]);

  const canToggleFit = preview.mode === "image" || preview.mode === "video";
  const canDownload = preview.mode !== "loading" && preview.mode !== "error";

  const statusCopy =
    preview.mode === "loading"
      ? "附件载入中"
      : preview.mode === "error"
        ? "预览失败"
        : preview.mode === "unsupported"
          ? "暂不支持在线预览"
          : "在线预览";

  async function handleDownload() {
    if (!canDownload || downloading) {
      return;
    }
    setDownloading(true);
    try {
      await downloadUrlOrShare(preview.objectUrl || fileUrl, fileName, {
        isMobile,
        title: fileName,
        text: fileName,
        fallbackUrl: fileUrl,
        mimeType: preview.mimeLabel,
      });
    } catch (error) {
      setPreview((current) => ({
        ...current,
        mode: "error",
        errorMessage: error instanceof Error ? error.message : "下载失败",
      }));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="attachment-preview" style={overlayStyle(isMobile)} onClick={onClose}>
      <style>{`@keyframes xinya-preview-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div className="attachment-preview__shell" style={shellStyle} onClick={(event) => event.stopPropagation()}>
        <div className="attachment-preview__panel" style={panelStyle(isMobile)}>
          <header className="attachment-preview__header" style={headerStyle(isMobile)}>
            <div className="attachment-preview__header-copy" style={headerCopyStyle(isMobile)}>
              <div className="attachment-preview__badge" style={badgeStyle(isMobile)}>
                {preview.extLabel}
              </div>
              <div className="attachment-preview__title-wrap" style={titleWrapStyle}>
                <div className="attachment-preview__title" style={titleStyle(isMobile)}>
                  {fileName}
                </div>
                <div className="attachment-preview__subtitle" style={subtitleStyle}>
                  {statusCopy} · {preview.mimeLabel}
                </div>
              </div>
            </div>
            <div className="attachment-preview__actions" style={actionRowStyle(isMobile)}>
              {canToggleFit ? (
                <button
                  className="attachment-preview__button"
                  type="button"
                  style={{ ...secondaryButtonStyle, ...actionButtonStyle(isMobile) }}
                  onClick={() => setFitMode((current) => (current === "contain" ? "cover" : "contain"))}
                >
                  {fitMode === "contain" ? "铺满" : "适应"}
                </button>
              ) : null}
              <button
                className="attachment-preview__button attachment-preview__button--download"
                type="button"
                disabled={!canDownload || downloading}
                style={{ ...secondaryButtonStyle, ...actionButtonStyle(isMobile) }}
                onClick={() => void handleDownload()}
              >
                {downloading ? "处理中…" : "下载"}
              </button>
              <button
                className="attachment-preview__button attachment-preview__button--close"
                type="button"
                style={{ ...primaryButtonStyle, ...actionButtonStyle(isMobile) }}
                onClick={onClose}
              >
                关闭
              </button>
            </div>
          </header>

          <div className="attachment-preview__body" style={bodyStyle(isMobile)}>
            <div className="attachment-preview__viewer" style={viewerStyle(isMobile)}>
              <PreviewSurface preview={preview} fileName={fileName} fitMode={fitMode} isMobile={isMobile} />
            </div>
            <div className="attachment-preview__info" style={infoGridStyle(isMobile)}>
              <InfoPill label="类型" value={preview.mimeLabel} />
              <InfoPill label="大小" value={preview.sizeLabel} />
              <InfoPill label="状态" value={statusCopy} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewSurface({
  preview,
  fileName,
  fitMode,
  isMobile,
}: {
  preview: PreviewState;
  fileName: string;
  fitMode: "contain" | "cover";
  isMobile: boolean;
}) {
  if (preview.mode === "loading") {
    return (
      <div className="attachment-preview__state attachment-preview__state--loading" style={stateStyle}>
        <div style={spinnerStyle} />
        <div>附件载入中…</div>
      </div>
    );
  }

  if (preview.mode === "error") {
    return (
      <div className="attachment-preview__state attachment-preview__state--error" style={stateStyle}>
        <div style={stateTitleStyle}>预览失败</div>
        <div style={stateTextStyle}>{preview.errorMessage || "可能是权限、文件损坏或格式异常。"}</div>
      </div>
    );
  }

  if (preview.mode === "unsupported") {
    return (
      <div className="attachment-preview__state attachment-preview__state--unsupported" style={stateStyle}>
        <div style={stateTitleStyle}>暂不支持在线预览这个格式</div>
        <div style={stateTextStyle}>可以直接下载后查看原文件。</div>
      </div>
    );
  }

  if (preview.mode === "image") {
    return (
      <div className="attachment-preview__image-stage" style={mediaStageStyle}>
        <CachedImage
          className="attachment-preview__image"
          src={preview.objectUrl}
          alt={fileName}
          style={{
            ...imageStyle(isMobile),
            objectFit: fitMode,
          }}
        />
      </div>
    );
  }

  if (preview.mode === "video") {
    return (
      <div className="attachment-preview__video-stage" style={mediaStageStyle}>
        <CachedVideo
          className="attachment-preview__video"
          src={preview.objectUrl}
          controls
          playsInline
          style={{
            ...videoStyle(isMobile),
            objectFit: fitMode,
          }}
        />
      </div>
    );
  }

  if (preview.mode === "audio") {
    return (
      <div className="attachment-preview__audio-wrap" style={audioWrapStyle(isMobile)}>
        <div style={stateTitleStyle}>{fileName}</div>
        <audio className="attachment-preview__audio" src={preview.objectUrl} controls style={audioStyle(isMobile)} />
      </div>
    );
  }

  if (preview.mode === "text") {
    return (
      <pre className="attachment-preview__text" style={textStyle(isMobile)}>
        {preview.textContent}
      </pre>
    );
  }

  if (preview.mode === "pdf") {
    return <iframe className="attachment-preview__frame" src={preview.objectUrl} title={fileName} style={frameStyle(isMobile)} />;
  }

  return null;
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="attachment-preview__meta-row" style={infoPillStyle}>
      <div style={infoLabelStyle}>{label}</div>
      <div style={infoValueStyle}>{value}</div>
    </div>
  );
}

export async function openPreviewModal(attachment: AttachmentRecord) {
  openOverlay(
    (close) => <AttachmentPreviewModal attachment={attachment} onClose={close} />,
    { key: "xinya-attachment-preview" },
  );
}

// 直接可用于 <img>/<iframe> src 的附件地址（媒体文件公开，无需鉴权）。
export function resolveAttachmentPreviewUrl(attachment: AttachmentRecord): string {
  return resolveFileFetchUrl(getFileUrl(attachment));
}

export function getAttachmentKind(attachment: AttachmentRecord): "image" | "pdf" | "other" {
  const fileName = attachment.file_name || attachment.file_path || "";
  const mime = attachment.mime_type || "";
  const ext = getExt(fileName, mime);
  if (isImage(ext, mime) || isHeic(ext, mime)) {
    return "image";
  }
  if (ext === "pdf" || mime.toLowerCase() === "application/pdf") {
    return "pdf";
  }
  return "other";
}

function overlayStyle(isMobile: boolean): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex: 10000,
    background:
      "radial-gradient(circle at top left, rgba(235, 200, 135, 0.18), transparent 28%), rgba(13, 16, 22, 0.84)",
    backdropFilter: "blur(10px)",
    display: "grid",
    padding: isMobile ? "10px" : "24px",
    boxSizing: "border-box",
    overflow: "hidden",
  };
}

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  height: "100%",
  maxHeight: "100%",
  minWidth: 0,
  minHeight: 0,
  boxSizing: "border-box",
};

function panelStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    maxWidth: "100%",
    height: "100%",
    maxHeight: isMobile ? "calc(100vh - 20px)" : "calc(100vh - 48px)",
    minWidth: 0,
    boxSizing: "border-box",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    borderRadius: isMobile ? "18px" : "24px",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "linear-gradient(180deg, rgba(22, 26, 34, 0.98), rgba(13, 16, 22, 0.98))",
    boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
  };
}

function headerStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "stretch" : "center",
    gap: isMobile ? "12px" : "14px",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    minWidth: 0,
    boxSizing: "border-box",
    padding: isMobile ? "14px" : "18px 22px",
    background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  };
}

function headerCopyStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    gap: isMobile ? "10px" : "12px",
    alignItems: isMobile ? "flex-start" : "center",
    width: isMobile ? "100%" : undefined,
    minWidth: 0,
    maxWidth: "100%",
  };
}

function badgeStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    minWidth: isMobile ? "52px" : "58px",
    height: isMobile ? "36px" : "40px",
    padding: "0 12px",
    borderRadius: "12px",
    background: "linear-gradient(135deg, #c2902b, #f5d48d)",
    color: "#2f2306",
    fontWeight: 900,
    fontSize: "12px",
    letterSpacing: "0.08em",
  };
}

const titleWrapStyle: CSSProperties = {
  display: "grid",
  flex: "1 1 0",
  gap: "4px",
  minWidth: 0,
  maxWidth: "100%",
};

function titleStyle(isMobile: boolean): CSSProperties {
  return {
    fontSize: isMobile ? "16px" : "18px",
    fontWeight: 800,
    color: "#f6f7fb",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: isMobile ? "normal" : "nowrap",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
  };
}

const subtitleStyle: CSSProperties = {
  minWidth: 0,
  fontSize: "12px",
  color: "rgba(255,255,255,0.68)",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};

function actionRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "8px",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(3, max-content)",
    alignItems: "center",
    width: isMobile ? "100%" : "auto",
    minWidth: 0,
    maxWidth: "100%",
  };
}

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "#f5f7fb",
  padding: "10px 14px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: 700,
  textDecoration: "none",
};

const primaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  border: "1px solid rgba(229, 182, 84, 0.28)",
  background: "linear-gradient(135deg, #e0a938, #8f6215)",
  color: "#fff8e8",
};

function actionButtonStyle(isMobile: boolean): CSSProperties {
  return isMobile ? { width: "100%", boxSizing: "border-box", textAlign: "center" } : {};
}

function bodyStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr) auto",
    minWidth: 0,
    minHeight: 0,
    maxHeight: "100%",
    overflow: "hidden",
  };
}

function viewerStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    minHeight: 0,
    maxHeight: "100%",
    boxSizing: "border-box",
    padding: isMobile ? "12px" : "20px",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)), radial-gradient(circle at center, rgba(255,255,255,0.04), transparent 64%)",
  };
}

const mediaStageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
};

function infoGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
    gap: "10px",
    padding: isMobile ? "0 12px 12px" : "0 20px 20px",
  };
}

const infoPillStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  padding: "12px 14px",
  borderRadius: "16px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
};

const infoLabelStyle: CSSProperties = {
  fontSize: "11px",
  color: "rgba(255,255,255,0.48)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const infoValueStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: "#f6f7fb",
  wordBreak: "break-word",
};

const stateStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  justifyItems: "center",
  textAlign: "center",
  color: "#eef2f8",
  padding: "24px",
};

const stateTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
};

const stateTextStyle: CSSProperties = {
  maxWidth: "520px",
  fontSize: "13px",
  lineHeight: 1.7,
  color: "rgba(255,255,255,0.72)",
};

const spinnerStyle: CSSProperties = {
  width: "38px",
  height: "38px",
  borderRadius: "50%",
  border: "3px solid rgba(255,255,255,0.16)",
  borderTopColor: "#e0a938",
  animation: "xinya-preview-spin 0.9s linear infinite",
};

function imageStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    maxWidth: "100%",
    maxHeight: "100%",
    borderRadius: isMobile ? "14px" : "18px",
    background: "#0b0d11",
  };
}

function videoStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    maxWidth: "100%",
    maxHeight: "100%",
    borderRadius: isMobile ? "14px" : "18px",
    background: "#000",
  };
}

function frameStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minHeight: 0,
    border: "none",
    borderRadius: isMobile ? "14px" : "18px",
    background: "#fff",
  };
}

function textStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minHeight: 0,
    margin: 0,
    overflow: "auto",
    borderRadius: isMobile ? "14px" : "18px",
    padding: isMobile ? "14px" : "18px",
    boxSizing: "border-box",
    background: "#0f1218",
    color: "#f5f7fb",
    fontSize: "13px",
    lineHeight: 1.7,
  };
}

function audioWrapStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "16px",
    justifyItems: "center",
    width: "100%",
    padding: isMobile ? "10px 0" : undefined,
  };
}

function audioStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "100%" : "min(100%, 540px)",
  };
}
