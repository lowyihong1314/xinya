import { useEffect, useRef, useState, type CSSProperties } from "react";

import { openOverlay } from "../../app/OverlayProvider";
import { downloadUrlOrShare } from "../../js/browserActions";

type BrochureRecord = {
  file_name?: string;
  file_path: string;
  mime_type?: string;
};

function getExt(name = "", mime = "") {
  const normalizedName = name.toLowerCase();
  const normalizedMime = mime.toLowerCase();
  const ext = normalizedName.includes(".") ? normalizedName.split(".").pop() || "" : "";
  return ext || (normalizedMime.includes("/") ? normalizedMime.split("/").pop() || "" : "");
}

function isPdf(ext: string, mime = "") {
  return ext === "pdf" || mime.toLowerCase().includes("pdf");
}

function buildPublicFileUrl(filePath: string) {
  return new URL(`/media_file/${filePath}`, window.location.origin).toString();
}

function buildOfficeEmbedUrl(fileUrl: string) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
}

function BrochurePreviewModal({
  brochure,
  onClose,
}: {
  brochure: BrochureRecord;
  onClose: () => void;
}) {
  const fileName = brochure.file_name || brochure.file_path || "简章";
  const ext = getExt(fileName, brochure.mime_type || "");
  const isOfficeEmbed = !isPdf(ext, brochure.mime_type || "");
  const fileUrl = buildPublicFileUrl(brochure.file_path);
  const iframeUrl = isOfficeEmbed ? buildOfficeEmbedUrl(fileUrl) : fileUrl;
  const frameWrapRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === frameWrapRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!frameWrapRef.current) {
      return;
    }

    if (document.fullscreenElement === frameWrapRef.current) {
      await document.exitFullscreen();
      return;
    }

    await frameWrapRef.current.requestFullscreen();
  };

  async function handleDownload() {
    if (downloading) {
      return;
    }
    setDownloading(true);
    try {
      await downloadUrlOrShare(fileUrl, fileName, {
        isMobile: window.innerWidth <= 900,
        title: fileName,
        text: fileName,
        fallbackUrl: fileUrl,
        mimeType: brochure.mime_type || undefined,
      });
    } catch (error) {
      console.warn("brochure download failed:", error);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={shellStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div style={headerCopyStyle}>
            <div style={badgeStyle}>{isOfficeEmbed ? "Office Online" : "PDF"}</div>
            <div style={titleStyle}>{fileName}</div>
          </div>
          <div style={actionRowStyle}>
            {isOfficeEmbed ? (
              <button type="button" style={secondaryButtonStyle} onClick={() => void toggleFullscreen()}>
                {isFullscreen ? "退出全屏" : "全屏"}
              </button>
            ) : null}
            <a href={fileUrl} target="_blank" rel="noreferrer" style={linkButtonStyle}>
              新标签打开
            </a>
            <button type="button" disabled={downloading} style={secondaryButtonStyle} onClick={() => void handleDownload()}>
              {downloading ? "处理中…" : "下载"}
            </button>
            <button type="button" style={primaryButtonStyle} onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div ref={frameWrapRef} style={frameWrapStyle}>
          <iframe src={iframeUrl} title={fileName} style={frameStyle} allow="fullscreen" allowFullScreen />
        </div>
      </div>
    </div>
  );
}

export async function openBrochurePreviewModal(brochure: BrochureRecord) {
  openOverlay(
    (close) => <BrochurePreviewModal brochure={brochure} onClose={close} />,
    { key: "xinya-brochure-preview" },
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  background: "rgba(8, 14, 24, 0.72)",
  backdropFilter: "blur(10px)",
  display: "grid",
  padding: "24px",
  boxSizing: "border-box",
};

const shellStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel-strong))",
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "24px",
  boxShadow: "0 24px 60px var(--x-color-shadow-strong)",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
  padding: "18px 20px",
  borderBottom: "1px solid var(--x-color-line-soft)",
  flexWrap: "wrap",
};

const headerCopyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const badgeStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
};

const titleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  alignItems: "center",
};

const linkButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  textDecoration: "none",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "transparent",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const frameWrapStyle: CSSProperties = {
  minHeight: 0,
  background: "#f8fafc",
};

const frameStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  border: "none",
  display: "block",
  minHeight: "calc(100vh - 160px)",
};
