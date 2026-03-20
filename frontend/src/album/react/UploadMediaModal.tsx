import { CSSProperties, useEffect, useMemo, useState } from "react";

import { uploadEventMedia } from "../../event/shared/api";

type UploadQueueItem = {
  id: string;
  file: File;
  previewUrl: string | null;
  status: "queued" | "uploading" | "success" | "error";
  error?: string | null;
};

type UploadMediaModalProps = {
  eventId: number;
  eventName?: string;
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
};

const ACCEPTED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "heic",
  "heif",
  "bmp",
  "tif",
  "tiff",
  "webp",
  "svg",
  "raw",
  "mp4",
  "mov",
  "m4v",
  "avi",
  "mkv",
  "webm",
  "flv",
  "mts",
  "m2ts",
  "3gp",
  "wmv",
]);

export function UploadMediaModal({
  eventId,
  eventName,
  onClose,
  onUploaded,
}: UploadMediaModalProps) {
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      queue.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, [queue]);

  const stats = useMemo(() => {
    const successCount = queue.filter((item) => item.status === "success").length;
    const failedCount = queue.filter((item) => item.status === "error").length;
    return { successCount, failedCount };
  }, [queue]);

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length) {
      return;
    }

    const nextItems: UploadQueueItem[] = [];
    const ignored: string[] = [];

    Array.from(fileList).forEach((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        ignored.push(file.name);
        return;
      }

      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      nextItems.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        previewUrl,
        status: "queued",
        error: null,
      });
    });

    setQueue((prev) => {
      const existingIds = new Set(prev.map((item) => item.id));
      return [
        ...prev,
        ...nextItems.filter((item) => {
          if (existingIds.has(item.id)) {
            if (item.previewUrl) {
              URL.revokeObjectURL(item.previewUrl);
            }
            return false;
          }
          return true;
        }),
      ];
    });

    if (ignored.length) {
      setToast(`已忽略 ${ignored.length} 个不支持的文件`);
    }
  }

  function removeItem(itemId: string) {
    setQueue((prev) => {
      const target = prev.find((item) => item.id === itemId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== itemId);
    });
  }

  async function handleUpload() {
    if (!queue.length) {
      setToast("请先选择文件");
      return;
    }

    setUploading(true);
    let uploadedAny = false;

    for (const item of queue) {
      setQueue((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, status: "uploading", error: null } : row)),
      );

      try {
        await uploadEventMedia(eventId, item.file);
        uploadedAny = true;
        setQueue((prev) =>
          prev.map((row) => (row.id === item.id ? { ...row, status: "success", error: null } : row)),
        );
      } catch (error) {
        setQueue((prev) =>
          prev.map((row) =>
            row.id === item.id
              ? {
                  ...row,
                  status: "error",
                  error: error instanceof Error ? error.message : "上传失败",
                }
              : row,
          ),
        );
      }
    }

    setUploading(false);

    if (uploadedAny) {
      await onUploaded();
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Media Upload</div>
            <h2 style={titleStyle}>上传文件</h2>
            <p style={copyStyle}>{eventName || `活动 #${eventId}`}</p>
          </div>
          <button type="button" style={closeButtonStyle} onClick={onClose}>
            关闭
          </button>
        </div>

        <div style={bodyStyle}>
          <label style={dropzoneStyle}>
            <input
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(event) => {
                addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <div style={dropTitleStyle}>选择图片或视频</div>
            <div style={dropCopyStyle}>支持多次追加选择，上传成功后会自动刷新照片墙。</div>
          </label>

          {toast ? <div style={toastStyle}>{toast}</div> : null}

          <div style={queueHeaderStyle}>
            <span>{queue.length} 个待处理文件</span>
            <span>
              成功 {stats.successCount} / 失败 {stats.failedCount}
            </span>
          </div>

          <div style={queueStyle}>
            {!queue.length ? <div style={placeholderStyle}>当前还没有选择文件</div> : null}
            {queue.map((item) => (
              <div key={item.id} style={queueItemStyle(item.status)}>
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={item.file.name} style={previewImageStyle} />
                ) : (
                  <div style={videoTileStyle}>VIDEO</div>
                )}
                <div style={fileMetaStyle}>
                  <div style={fileNameStyle}>{item.file.name}</div>
                  <div style={fileSubStyle}>
                    {(item.file.size / 1024 / 1024).toFixed(2)} MB
                    {item.error ? ` · ${item.error}` : ""}
                  </div>
                </div>
                <div style={statusStyle(item.status)}>
                  {item.status === "queued" ? "待上传" : null}
                  {item.status === "uploading" ? "上传中…" : null}
                  {item.status === "success" ? "完成" : null}
                  {item.status === "error" ? "失败" : null}
                </div>
                <button
                  type="button"
                  style={removeButtonStyle}
                  onClick={() => removeItem(item.id)}
                  disabled={uploading && item.status === "uploading"}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={footerStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>
            取消
          </button>
          <button type="button" style={primaryButtonStyle} disabled={uploading || !queue.length} onClick={() => void handleUpload()}>
            {uploading ? "上传中…" : "开始上传"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1200,
  background: "rgba(7, 12, 20, 0.6)",
  display: "grid",
  placeItems: "center",
  padding: "24px",
};

const modalStyle: CSSProperties = {
  width: "min(920px, 100%)",
  maxHeight: "90vh",
  overflow: "hidden",
  borderRadius: "var(--x-radius-lg)",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 24px 64px var(--x-color-shadow-strong)",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
};

const headerStyle: CSSProperties = {
  padding: "20px 22px",
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "start",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const titleStyle: CSSProperties = {
  margin: "8px 0 4px",
  fontSize: "28px",
  color: "var(--x-color-ink)",
};

const copyStyle: CSSProperties = {
  margin: 0,
  color: "var(--x-color-ink-muted)",
};

const bodyStyle: CSSProperties = {
  padding: "20px 22px",
  overflow: "auto",
  display: "grid",
  gap: "16px",
};

const dropzoneStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "20px",
  borderRadius: "var(--x-radius-md)",
  border: "1px dashed var(--x-color-accent-border)",
  background: "var(--x-color-accent-tint)",
  cursor: "pointer",
};

const dropTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 700,
  color: "var(--x-color-accent-strong)",
};

const dropCopyStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.6,
};

const toastStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--x-radius-sm)",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-warning)",
};

const queueHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  flexWrap: "wrap",
};

const queueStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

function queueItemStyle(status: UploadQueueItem["status"]): CSSProperties {
  const background =
    status === "error"
      ? "var(--x-color-danger-soft)"
      : status === "success"
        ? "var(--x-color-success-soft)"
        : "var(--x-color-panel)";
  const border =
    status === "error"
      ? "1px solid var(--x-color-danger-border)"
      : status === "success"
        ? "1px solid var(--x-color-accent-border)"
        : "1px solid var(--x-color-line-soft)";
  return {
    display: "grid",
    gridTemplateColumns: "72px minmax(0, 1fr) auto auto",
    gap: "14px",
    alignItems: "center",
    padding: "12px",
    borderRadius: "var(--x-radius-md)",
    background,
    border,
  };
}

const previewImageStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  objectFit: "cover",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
};

const videoTileStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  borderRadius: "12px",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.08em",
};

const fileMetaStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "4px",
};

const fileNameStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const fileSubStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

function statusStyle(status: UploadQueueItem["status"]): CSSProperties {
  const color =
    status === "success"
      ? "var(--x-color-success)"
      : status === "error"
        ? "var(--x-color-danger)"
        : status === "uploading"
          ? "var(--x-color-accent-strong)"
          : "var(--x-color-ink-muted)";
  return {
    fontSize: "13px",
    fontWeight: 700,
    color,
    whiteSpace: "nowrap",
  };
}

const removeButtonStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};

const placeholderStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
};

const footerStyle: CSSProperties = {
  padding: "18px 22px",
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  borderTop: "1px solid var(--x-color-line-soft)",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

const closeButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  padding: "10px 14px",
};
