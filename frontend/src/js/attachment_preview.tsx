import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import heic2any from "heic2any";

import { CachedImage, CachedVideo } from "../components/CachedMedia";
import { apiFetch } from "./apiFetch";

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
  return `/media_file/${attachment.file_path}`;
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
  const response = await apiFetch(getFileUrl(attachment), { credentials: "include" });

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
      objectUrl: "",
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

  const statusCopy = useMemo(() => {
    if (preview.mode === "loading") {
      return "附件载入中";
    }
    if (preview.mode === "error") {
      return "预览失败";
    }
    if (preview.mode === "unsupported") {
      return "暂不支持在线预览";
    }
    return "在线预览";
  }, [preview.mode]);

  return (
    <div className="attachment-preview" style={overlayStyle} onClick={onClose}>
      <style>{`@keyframes xinya-preview-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div className="attachment-preview__shell" style={shellStyle} onClick={(event) => event.stopPropagation()}>
        <div className="attachment-preview__panel" style={panelStyle}>
          <header className="attachment-preview__header" style={headerStyle}>
            <div className="attachment-preview__header-copy" style={headerCopyStyle}>
              <div className="attachment-preview__badge" style={badgeStyle}>
                {preview.extLabel}
              </div>
              <div className="attachment-preview__title-wrap" style={titleWrapStyle}>
                <div className="attachment-preview__title" style={titleStyle}>
                  {fileName}
                </div>
                <div className="attachment-preview__subtitle" style={subtitleStyle}>
                  {statusCopy} · {preview.mimeLabel}
                </div>
              </div>
            </div>
            <div className="attachment-preview__actions" style={actionRowStyle}>
              {canToggleFit ? (
                <button
                  className="attachment-preview__button"
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setFitMode((current) => (current === "contain" ? "cover" : "contain"))}
                >
                  {fitMode === "contain" ? "铺满" : "适应"}
                </button>
              ) : null}
              <a
                className="attachment-preview__button attachment-preview__button--link"
                href={preview.objectUrl || fileUrl}
                target="_blank"
                rel="noreferrer"
                style={secondaryButtonStyle}
              >
                新窗口打开
              </a>
              <a
                className="attachment-preview__button attachment-preview__button--download"
                href={preview.objectUrl || fileUrl}
                download={fileName}
                style={secondaryButtonStyle}
              >
                下载
              </a>
              <button className="attachment-preview__button attachment-preview__button--close" type="button" style={primaryButtonStyle} onClick={onClose}>
                关闭
              </button>
            </div>
          </header>

          <div className="attachment-preview__body" style={bodyStyle}>
            <div className="attachment-preview__viewer" style={viewerStyle}>
              <PreviewSurface preview={preview} fileName={fileName} fitMode={fitMode} />
            </div>

            <aside className="attachment-preview__sidebar" style={sidebarStyle}>
              <div className="attachment-preview__meta-card" style={metaCardStyle}>
                <div className="attachment-preview__meta-label" style={metaLabelStyle}>
                  文件信息
                </div>
                <div className="attachment-preview__meta-list" style={metaListStyle}>
                  <MetaRow label="名称" value={fileName} />
                  <MetaRow label="类型" value={preview.mimeLabel} />
                  <MetaRow label="大小" value={preview.sizeLabel} />
                  <MetaRow label="路径" value={attachment.file_path} />
                </div>
              </div>

              <div className="attachment-preview__meta-card" style={metaCardStyle}>
                <div className="attachment-preview__meta-label" style={metaLabelStyle}>
                  兼容说明
                </div>
                <div style={hintTextStyle}>
                  HEIC 会先转换成 JPEG 预览。
                  <br />
                  PDF 使用内嵌文档查看。
                  <br />
                  MP4/视频使用原生播放器。
                </div>
              </div>
            </aside>
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
}: {
  preview: PreviewState;
  fileName: string;
  fitMode: "contain" | "cover";
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
        <div style={stateTextStyle}>可以用右上角“新窗口打开”或“下载”继续处理。</div>
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
            ...imageStyle,
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
            ...videoStyle,
            objectFit: fitMode,
          }}
        />
      </div>
    );
  }

  if (preview.mode === "audio") {
    return (
      <div className="attachment-preview__audio-wrap" style={audioWrapStyle}>
        <div style={stateTitleStyle}>{fileName}</div>
        <audio className="attachment-preview__audio" src={preview.objectUrl} controls style={audioStyle} />
      </div>
    );
  }

  if (preview.mode === "text") {
    return (
      <pre className="attachment-preview__text" style={textStyle}>
        {preview.textContent}
      </pre>
    );
  }

  if (preview.mode === "pdf") {
    return <iframe className="attachment-preview__frame" src={preview.objectUrl} title={fileName} style={frameStyle} />;
  }

  return null;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="attachment-preview__meta-row" style={metaRowStyle}>
      <div style={metaKeyStyle}>{label}</div>
      <div style={metaValueStyle}>{value}</div>
    </div>
  );
}

export async function openPreviewModal(attachment: AttachmentRecord) {
  document.querySelectorAll("[data-xinya-preview-root='true']").forEach((node) => node.remove());

  const host = document.createElement("div");
  host.dataset.xinyaPreviewRoot = "true";
  document.body.appendChild(host);
  const root = createRoot(host);

  const close = () => {
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };

  root.render(<AttachmentPreviewModal attachment={attachment} onClose={close} />);
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  background:
    "radial-gradient(circle at top left, rgba(235, 200, 135, 0.18), transparent 28%), rgba(13, 16, 22, 0.84)",
  backdropFilter: "blur(10px)",
  display: "grid",
  padding: "24px",
  boxSizing: "border-box",
  overflow: "hidden",
};

const shellStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  maxHeight: "100%",
  minHeight: 0,
};

const panelStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  maxHeight: "calc(100vh - 48px)",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  borderRadius: "24px",
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "linear-gradient(180deg, rgba(22, 26, 34, 0.98), rgba(13, 16, 22, 0.98))",
  boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "14px",
  flexWrap: "wrap",
  padding: "18px 22px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const headerCopyStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "center",
  minWidth: 0,
};

const badgeStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minWidth: "58px",
  height: "40px",
  padding: "0 12px",
  borderRadius: "12px",
  background: "linear-gradient(135deg, #c2902b, #f5d48d)",
  color: "#2f2306",
  fontWeight: 900,
  fontSize: "12px",
  letterSpacing: "0.08em",
};

const titleWrapStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  minWidth: 0,
};

const titleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: "#f6f7fb",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const subtitleStyle: CSSProperties = {
  fontSize: "12px",
  color: "rgba(255,255,255,0.68)",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
};

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

const bodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 300px",
  minHeight: 0,
  maxHeight: "100%",
  overflow: "hidden",
};

const viewerStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  maxHeight: "100%",
  padding: "20px",
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)), radial-gradient(circle at center, rgba(255,255,255,0.04), transparent 64%)",
};

const mediaStageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
};

const sidebarStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: "14px",
  padding: "20px 20px 20px 0",
  minHeight: 0,
  overflow: "auto",
};

const metaCardStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "16px",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
};

const metaLabelStyle: CSSProperties = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "rgba(255,255,255,0.5)",
};

const metaListStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const metaRowStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const metaKeyStyle: CSSProperties = {
  fontSize: "11px",
  color: "rgba(255,255,255,0.48)",
};

const metaValueStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: "#f6f7fb",
  wordBreak: "break-word",
};

const hintTextStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.75,
  color: "rgba(255,255,255,0.72)",
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

const imageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  maxWidth: "100%",
  maxHeight: "100%",
  borderRadius: "18px",
  background: "#0b0d11",
};

const videoStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  maxWidth: "100%",
  maxHeight: "100%",
  borderRadius: "18px",
  background: "#000",
};

const frameStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  border: "none",
  borderRadius: "18px",
  background: "#fff",
};

const textStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  margin: 0,
  overflow: "auto",
  borderRadius: "18px",
  padding: "18px",
  boxSizing: "border-box",
  background: "#0f1218",
  color: "#f5f7fb",
  fontSize: "13px",
  lineHeight: 1.7,
};

const audioWrapStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
  justifyItems: "center",
  width: "100%",
};

const audioStyle: CSSProperties = {
  width: "min(100%, 540px)",
};
