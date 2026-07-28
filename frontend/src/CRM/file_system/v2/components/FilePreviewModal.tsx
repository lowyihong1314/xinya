import { useEffect, useState } from "react";

import { useFsActions, useFsState } from "../context";
import { fetchFileBlob } from "../api";
import { iconButtonStyle, previewBodyStyle, previewHeaderStyle, previewOverlayStyle, previewTextStyle } from "../styles";
import { errorMessage, previewKind } from "../utils";

export function FilePreviewModal() {
  const { previewItem } = useFsState();
  const actions = useFsActions();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const kind = previewItem ? previewKind(previewItem.name) : null;

  useEffect(() => {
    if (!previewItem || previewItem.type === "dir" || previewItem.file_id < 0) return;
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    setError(null);
    setObjectUrl(null);
    setTextContent(null);

    void (async () => {
      try {
        let blob = await fetchFileBlob(previewItem.file_id);
        if (cancelled) return;
        const itemKind = previewKind(previewItem.name);
        if (itemKind === "heic") {
          const heic2any = (await import("heic2any")).default;
          const converted = await heic2any({ blob, toType: "image/jpeg", quality: 0.9 });
          blob = Array.isArray(converted) ? converted[0] : converted;
        }
        if (cancelled) return;
        if (itemKind === "text") {
          setTextContent(await blob.text());
        } else {
          url = URL.createObjectURL(blob);
          setObjectUrl(url);
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewItem]);

  useEffect(() => {
    if (!previewItem) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") actions.setPreviewItem(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewItem, actions]);

  if (!previewItem) return null;

  return (
    <div style={previewOverlayStyle} onClick={() => actions.setPreviewItem(null)}>
      <div style={previewHeaderStyle} onClick={(event) => event.stopPropagation()}>
        <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
          {previewItem.name}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={{ ...iconButtonStyle(), background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,0.3)" }}
            title="下载"
            onClick={() => actions.downloadItem(previewItem)}
          >
            <i className="fa-solid fa-download" />
          </button>
          <button
            type="button"
            style={{ ...iconButtonStyle(), background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,0.3)" }}
            title="关闭"
            onClick={() => actions.setPreviewItem(null)}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      </div>
      <div style={previewBodyStyle} onClick={(event) => event.stopPropagation()}>
        {loading ? (
          <span style={{ color: "#fff", fontSize: 14 }}>
            <i className="fa-solid fa-circle-notch fa-spin" style={{ marginRight: 8 }} />
            加载中…
          </span>
        ) : error ? (
          <span style={{ color: "#fca5a5", fontSize: 14 }}>{error}</span>
        ) : textContent !== null ? (
          <pre style={previewTextStyle}>{textContent}</pre>
        ) : objectUrl ? (
          kind === "image" || kind === "heic" ? (
            <img src={objectUrl} alt={previewItem.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          ) : kind === "video" ? (
            <video src={objectUrl} controls autoPlay style={{ maxWidth: "100%", maxHeight: "100%" }} />
          ) : kind === "audio" ? (
            <audio src={objectUrl} controls autoPlay style={{ width: "min(480px, 100%)" }} />
          ) : kind === "pdf" ? (
            <iframe src={objectUrl} title={previewItem.name} style={{ width: "100%", height: "100%", border: "none", borderRadius: 8, background: "#fff" }} />
          ) : null
        ) : null}
      </div>
    </div>
  );
}
