import { useState, type CSSProperties } from "react";

import { openOverlay } from "../../../../app/OverlayProvider";
import type { MusicUploadDraft } from "../../logic/workspaceTypes";
import { musicAudioUploadAccept } from "./audioUpload";

type MusicUploadDialogProps = {
  onResolve: (value: MusicUploadDraft | null) => void;
};

function filenameToTitle(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

function MusicUploadDialog({ onResolve }: MusicUploadDialogProps) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [error, setError] = useState("");

  function handleFileChange(nextFile: File | null) {
    setFile(nextFile);
    setError("");
    if (nextFile && !titleTouched && !title.trim()) {
      setTitle(filenameToTitle(nextFile.name));
    }
  }

  function handleConfirm() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("请输入歌曲名称");
      return;
    }
    if (!file) {
      setError("请选择音频文件");
      return;
    }
    onResolve({ title: trimmedTitle, file });
  }

  return (
    <div style={overlayStyle} onClick={() => onResolve(null)}>
      <div style={panelStyle} onClick={(event) => event.stopPropagation()}>
        <div style={accentBarStyle} />
        <div style={headerStyle}>
          <div style={eyebrowStyle}>Music Upload</div>
          <h3 style={titleStyle}>添加歌曲</h3>
          <p style={messageStyle}>输入歌曲名称，并选择要上传的音频文件。</p>
        </div>

        <div style={formStyle}>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>歌曲名称</span>
            <input
              value={title}
              onChange={(event) => {
                setTitleTouched(true);
                setTitle(event.target.value);
                setError("");
              }}
              placeholder="请输入歌曲名称"
              style={inputStyle}
              autoFocus
            />
          </label>

          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>音频文件</span>
            <input
              type="file"
              accept={musicAudioUploadAccept}
              onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
              style={fileInputStyle}
            />
            {file ? <span style={fileNameStyle}>{file.name}</span> : null}
          </label>

          {error ? <div style={errorStyle}>{error}</div> : null}
        </div>

        <div style={actionsStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={() => onResolve(null)}>
            取消
          </button>
          <button type="button" style={primaryButtonStyle} onClick={handleConfirm}>
            上传
          </button>
        </div>
      </div>
    </div>
  );
}

export function showMusicUploadDialog() {
  return new Promise<MusicUploadDraft | null>((resolve) => {
    openOverlay((close) => (
      <MusicUploadDialog
        onResolve={(value) => {
          close();
          resolve(value);
        }}
      />
    ));
  });
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  display: "grid",
  placeItems: "center",
  padding: "20px",
  background: "rgba(15, 23, 42, 0.52)",
  backdropFilter: "blur(8px)",
};

const panelStyle: CSSProperties = {
  width: "min(520px, 100%)",
  display: "grid",
  gap: "16px",
  padding: "22px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))",
  border: "1px solid rgba(15,118,110,0.18)",
  boxShadow: "0 28px 64px rgba(15,23,42,0.2)",
  boxSizing: "border-box",
};

const accentBarStyle: CSSProperties = {
  width: "72px",
  height: "6px",
  borderRadius: "999px",
  background: "linear-gradient(135deg, #0f766e, #1d4ed8)",
};

const headerStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "rgba(71,85,105,0.84)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "24px",
  lineHeight: 1.1,
  color: "var(--x-color-ink, #0f172a)",
};

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted, #475569)",
};

const formStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "14px",
  borderRadius: "18px",
  border: "1px solid rgba(148,163,184,0.12)",
  background: "rgba(15,118,110,0.08)",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--x-color-ink, #0f172a)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "44px",
  borderRadius: "14px",
  border: "1px solid rgba(148,163,184,0.26)",
  padding: "0 14px",
  boxSizing: "border-box",
  fontSize: "14px",
  background: "rgba(255,255,255,0.96)",
  color: "var(--x-color-ink, #0f172a)",
};

const fileInputStyle: CSSProperties = {
  ...inputStyle,
  padding: "10px 14px",
};

const fileNameStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted, #475569)",
  overflowWrap: "anywhere",
};

const errorStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#b91c1c",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  flexWrap: "wrap",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(148,163,184,0.26)",
  borderRadius: "999px",
  padding: "10px 16px",
  background: "rgba(255,255,255,0.9)",
  color: "var(--x-color-ink, #0f172a)",
  fontWeight: 700,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "999px",
  padding: "10px 16px",
  background: "linear-gradient(135deg, #0f766e, #1d4ed8)",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};
