import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { CacheMediaPlayer } from "../../components/CacheMediaPlayer";
import type { AlbumFile, EventDetailRecord } from "../../event/shared/types";
import { apiFetch } from "../../js/apiFetch";
import { PhotoGridBatchActions } from "./PhotoGridBatchActions";
import type { MediaNotification } from "./mediaRealtime";

const PAGE_SIZE = 24;

type VideoProgressState = {
  status: "started" | "progress" | "done" | "error";
  percent?: number;
  value?: string;
};

export function PhotoGrid({
  detail,
  isMobile = false,
  mediaNotification = null,
}: {
  detail: EventDetailRecord;
  isMobile?: boolean;
  mediaNotification?: MediaNotification | null;
}) {
  const [page, setPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewBumps, setPreviewBumps] = useState<Record<number, number>>({});
  const [videoProgress, setVideoProgress] = useState<Record<number, VideoProgressState>>({});
  const files = useMemo(
    () =>
      [...(detail.album_files || [])]
        .filter((file) => !removedIds.includes(file.id))
        .sort(
        (left, right) =>
          new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime(),
      ),
    [detail.album_files, removedIds],
  );
  const totalPages = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const currentFiles = useMemo(() => {
    const startIndex = (page - 1) * PAGE_SIZE;
    return files.slice(startIndex, startIndex + PAGE_SIZE);
  }, [files, page]);
  const currentPageIds = currentFiles.map((file) => file.id);
  const currentPageAllSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.includes(id));
  const allSelected = files.length > 0 && files.every((file) => selectedIds.includes(file.id));

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
    setRemovedIds([]);
    setSelectionMode(false);
    setPreviewBumps({});
    setVideoProgress({});
  }, [detail.id]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!mediaNotification) {
      return;
    }

    const targetId = mediaNotification.file_id ?? mediaNotification.video_id;
    if (!targetId) {
      return;
    }

    if (mediaNotification.event === "delete_album_file") {
      setRemovedIds((prev) => [...new Set([...prev, targetId])]);
      setSelectedIds((prev) => prev.filter((id) => id !== targetId));
      setVideoProgress((prev) => {
        if (!(targetId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      return;
    }

    if (mediaNotification.event === "rotate_album_file") {
      setPreviewBumps((prev) => ({ ...prev, [targetId]: (prev[targetId] || 0) + 1 }));
      return;
    }

    if (mediaNotification.event === "video_processing_started") {
      setVideoProgress((prev) => ({
        ...prev,
        [targetId]: { status: "started", percent: 0 },
      }));
      return;
    }

    if (mediaNotification.event === "video_progress") {
      setVideoProgress((prev) => ({
        ...prev,
        [targetId]: {
          status: "progress",
          percent: mediaNotification.percent,
        },
      }));
      return;
    }

    if (mediaNotification.event === "video_done") {
      setVideoProgress((prev) => ({
        ...prev,
        [targetId]: { status: "done", percent: 100 },
      }));
      setPreviewBumps((prev) => ({ ...prev, [targetId]: (prev[targetId] || 0) + 1 }));
      window.setTimeout(() => {
        setVideoProgress((prev) => {
          if (!(targetId in prev) || prev[targetId]?.status !== "done") {
            return prev;
          }
          const next = { ...prev };
          delete next[targetId];
          return next;
        });
      }, 1500);
      return;
    }

    if (mediaNotification.event === "video_error") {
      setVideoProgress((prev) => ({
        ...prev,
        [targetId]: {
          status: "error",
          value: mediaNotification.value || "转码失败",
        },
      }));
    }
  }, [mediaNotification]);

  function toggleSelect(fileId: number) {
    setSelectedIds((prev) => (prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]));
  }

  function toggleSelectCurrentPage() {
    setSelectedIds((prev) => {
      if (currentPageAllSelected) {
        return prev.filter((id) => !currentPageIds.includes(id));
      }
      return [...new Set([...prev, ...currentPageIds])];
    });
  }

  function toggleSelectAllPages() {
    setSelectedIds(allSelected ? [] : files.map((file) => file.id));
  }

  async function handleDownloadSelected(downloadType: "original" | "jpeg") {
    if (!selectedIds.length) {
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file_ids", JSON.stringify(selectedIds));
      formData.append("download_type", downloadType);
      const response = await apiFetch("/media/download_files", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || "下载失败");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `event-${detail.id}-${downloadType}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "下载失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSelected() {
    if (!selectedIds.length) {
      return;
    }
    if (!window.confirm(`确认移除这 ${selectedIds.length} 张图片？`)) {
      return;
    }

    setBusy(true);
    try {
      const response = await apiFetch("/media/delete_files", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: selectedIds }),
      });
      const payload = (await response.json().catch(() => ({}))) as { status?: string; message?: string };
      if (!response.ok || payload.status !== "success") {
        throw new Error(payload.message || "移除失败");
      }
      setRemovedIds((prev) => [...new Set([...prev, ...selectedIds])]);
      setSelectedIds([]);
      setSelectionMode(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "移除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={panelStyle}>
      <div style={headerStyle(isMobile)}>
        <div>
          <div style={eyebrowStyle}>Album Files</div>
          <h2 style={titleStyle}>活动照片</h2>
        </div>
        <div style={metaStyle}>
          <span>{files.length} 张</span>
          <span>
            第 {page} / {totalPages} 页
          </span>
        </div>
      </div>

      <PhotoGridBatchActions
        isMobile={isMobile}
        selectionMode={selectionMode}
        selectedCount={selectedIds.length}
        pageSelected={currentPageAllSelected}
        allSelected={allSelected}
        busy={busy}
        onToggleMode={() => {
          setSelectionMode((prev) => !prev);
          setSelectedIds([]);
        }}
        onTogglePage={toggleSelectCurrentPage}
        onToggleAll={toggleSelectAllPages}
        onClear={() => setSelectedIds([])}
        onDownloadOriginal={() => void handleDownloadSelected("original")}
        onDownloadJpeg={() => void handleDownloadSelected("jpeg")}
        onDelete={() => void handleDeleteSelected()}
      />

      {files.length > PAGE_SIZE ? (
        <div style={paginationStyle}>
          <button
            type="button"
            style={paginationButtonStyle}
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            上一页
          </button>
          <button
            type="button"
            style={paginationButtonStyle}
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
          >
            下一页
          </button>
        </div>
      ) : null}

      {!files.length ? <div style={placeholderStyle}>当前活动还没有照片</div> : null}

      {currentFiles.length ? (
        <>
          <div style={gridStyle(isMobile)}>
            {currentFiles.map((file, index) => (
              <PhotoCard
                key={file.id}
                file={file}
                index={index}
                isMobile={isMobile}
                selectionMode={selectionMode}
                selected={selectedIds.includes(file.id)}
                previewVersion={previewBumps[file.id] || 0}
                videoProgress={videoProgress[file.id]}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function PhotoCard({
  file,
  index,
  isMobile,
  selectionMode,
  selected,
  previewVersion,
  videoProgress,
  onToggleSelect,
}: {
  file: AlbumFile;
  index: number;
  isMobile: boolean;
  selectionMode: boolean;
  selected: boolean;
  previewVersion: number;
  videoProgress?: VideoProgressState;
  onToggleSelect: (fileId: number) => void;
}) {
  return (
    <button
      type="button"
      style={cardStyle(index, selected, isMobile)}
      onClick={() => {
        if (selectionMode) {
          onToggleSelect(file.id);
          return;
        }
        window.location.hash = `#/image/${file.id}`;
      }}
    >
      {selectionMode ? (
        <div style={selectionBadgeStyle(selected)}>
          <input
            type="checkbox"
            checked={selected}
            readOnly
            style={selectionCheckboxStyle}
          />
        </div>
      ) : null}
      <CacheMediaPlayer
        fileId={file.id}
        fileType={file.file_type}
        alt={file.user_display_name || `photo-${file.id}`}
        style={imageStyle(isMobile)}
        reloadKey={previewVersion}
        videoProgress={videoProgress || null}
      />
      <div style={cardBodyStyle}>
        <div style={cardTitleStyle}>{file.user_display_name || "未知"}</div>
        <div style={cardMetaStyle}>{formatDate(file.created_at)}</div>
      </div>
    </button>
  );
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

const panelStyle: CSSProperties = {
  padding: "20px",
  borderRadius: "var(--x-radius-lg)",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "18px",
};

function headerStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: isMobile ? "flex-start" : "center",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
  };
}

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const titleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "24px",
  color: "var(--x-color-ink)",
};

const metaStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

function gridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(240px, 1fr))",
    gap: isMobile ? "12px" : "18px",
  };
}

const cardStyle = (index: number, selected: boolean, isMobile: boolean): CSSProperties => ({
  border: "1px solid var(--x-color-line-soft)",
  borderRadius: "var(--x-radius-md)",
  overflow: "hidden",
  background: "var(--x-color-panel)",
  textAlign: "left",
  cursor: "pointer",
  boxShadow: selected ? "0 0 0 3px var(--x-color-accent-tint-strong), 0 10px 24px var(--x-color-shadow-soft)" : "0 10px 24px var(--x-color-shadow-soft)",
  transform: selected ? "translateY(-2px)" : "translateY(0)",
  opacity: 1,
  animation: `album-photo-fade 280ms ease ${Math.min(index * 40, 240)}ms both`,
  position: "relative",
  minWidth: 0,
});

function imageStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    height: isMobile ? "150px" : "240px",
    objectFit: "cover",
    display: "block",
    background: "var(--x-color-panel-alt)",
  };
}

const cardBodyStyle: CSSProperties = {
  padding: "12px 14px",
  display: "grid",
  gap: "6px",
};

const cardTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

const cardMetaStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

function selectionBadgeStyle(selected: boolean): CSSProperties {
  return {
    position: "absolute",
    top: "12px",
    right: "12px",
    zIndex: 1,
    width: "28px",
    height: "28px",
    borderRadius: "999px",
    display: "grid",
    placeItems: "center",
    background: selected ? "var(--x-color-accent)" : "rgba(255,255,255,0.88)",
    boxShadow: "0 8px 18px rgba(0,0,0,0.16)",
  };
}

const selectionCheckboxStyle: CSSProperties = {
  width: "16px",
  height: "16px",
  margin: 0,
  pointerEvents: "none",
};

const paginationStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: "10px",
};

const paginationButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "var(--x-radius-sm)",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const placeholderStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
};
