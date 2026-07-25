import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import { CacheMediaPlayer } from "../../components/CacheMediaPlayer";
import type { AlbumFile, EventDetailRecord } from "../../event/shared/types";
import { API_BASE } from "../../js/apiBase";
import { apiFetch } from "../../js/apiFetch";
import { downloadBlobOrShare } from "../../js/browserActions";
import { showConfirmDialog } from "../../js/dialogs";
import type { SmartMediaAsset } from "../../js/get_img";
import { show_alert } from "../../js/show_alert";
import { isMobileNativeRuntime } from "../../mobile/native/capacitor";
import { PhotoGridBatchActions } from "./PhotoGridBatchActions";
import type { MediaNotification } from "./mediaRealtime";

const LOAD_BATCH_SIZE = 24;
const PREVIEW_ARG_NAMES = ["img_id", "image_id", "img", "image", "imageId", "file_id"] as const;
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mod", "m4v", "avi", "mkv", "webm", "flv", "mts", "m2ts", "3gp", "wmv"]);
const ROTATABLE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "heic"]);
type PhotoTileSize = "xlarge" | "large" | "medium" | "small";

type VideoProgressState = {
  status: "started" | "progress" | "done" | "error";
  percent?: number;
  value?: string;
};

export function PhotoGrid({
  detail,
  isMobile = false,
  mediaNotification = null,
  canEditEvent = false,
  hideHeader = false,
  paged = false,
  onPickPhoto,
  selectedPhotoId = null,
}: {
  detail: EventDetailRecord;
  isMobile?: boolean;
  mediaNotification?: MediaNotification | null;
  canEditEvent?: boolean;
  hideHeader?: boolean;
  paged?: boolean;
  onPickPhoto?: (fileId: number) => void;
  selectedPhotoId?: number | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [visibleCount, setVisibleCount] = useState(LOAD_BATCH_SIZE);
  const [activePreviewId, setActivePreviewId] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [previewBumps, setPreviewBumps] = useState<Record<number, number>>({});
  const [videoProgress, setVideoProgress] = useState<Record<number, VideoProgressState>>({});
  const [tileSize, setTileSize] = useState<PhotoTileSize>(() => getPhotoTileSize());
  const [settledMediaIds, setSettledMediaIds] = useState<number[]>([]);
  const [activeLoadId, setActiveLoadId] = useState<number | null>(null);
  const [queuePaused, setQueuePaused] = useState(() =>
    typeof document !== "undefined" ? document.visibilityState !== "visible" : false,
  );
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreTimerRef = useRef<number | null>(null);
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
  const [page, setPage] = useState(0);
  const pageSize = isMobile ? 20 : 40;
  const pageCount = Math.max(1, Math.ceil(files.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleFiles = useMemo(
    () =>
      paged
        ? files.slice(safePage * pageSize, safePage * pageSize + pageSize)
        : files.slice(0, visibleCount),
    [files, paged, safePage, pageSize, visibleCount],
  );
  const hasMore = !paged && visibleCount < files.length;
  const previewIdFromArgs = useMemo(() => readPreviewIdFromArgs(location.search), [location.search]);
  const activePreviewIndex = activePreviewId ? files.findIndex((file) => file.id === activePreviewId) : -1;
  const activePreviewFile = activePreviewIndex >= 0 ? files[activePreviewIndex] : null;
  const previousPreviewFile = activePreviewIndex > 0 ? files[activePreviewIndex - 1] : null;
  const nextPreviewFile = activePreviewIndex >= 0 && activePreviewIndex < files.length - 1 ? files[activePreviewIndex + 1] : null;

  useEffect(() => {
    setVisibleCount(LOAD_BATCH_SIZE);
    setSelectedIds([]);
    setRemovedIds([]);
    setSelectionMode(false);
    setPreviewBumps({});
    setVideoProgress({});
    setSettledMediaIds([]);
    setActiveLoadId(null);
  }, [detail.id]);

  useEffect(() => {
    if (!previewIdFromArgs) {
      setActivePreviewId(null);
      return;
    }

    const nextPreviewIndex = files.findIndex((file) => file.id === previewIdFromArgs);
    if (nextPreviewIndex < 0) {
      setActivePreviewId(null);
      return;
    }

    setActivePreviewId(previewIdFromArgs);
    setVisibleCount((prev) => Math.max(prev, Math.min(files.length, nextPreviewIndex + 1)));
  }, [files, previewIdFromArgs]);

  useEffect(() => {
    setVisibleCount((prev) => {
      if (!files.length) {
        return LOAD_BATCH_SIZE;
      }
      return Math.min(Math.max(LOAD_BATCH_SIZE, prev), files.length);
    });
  }, [files.length]);

  useEffect(() => {
    return () => {
      if (loadMoreTimerRef.current != null) {
        window.clearTimeout(loadMoreTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleResize = () => setTileSize(getPhotoTileSize());
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const hidden = document.visibilityState !== "visible";
      setQueuePaused(hidden);
      if (hidden) {
        setActiveLoadId(null);
      }
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (queuePaused) {
      return;
    }

    setActiveLoadId((current) => {
      if (current && visibleFiles.some((file) => file.id === current) && !settledMediaIds.includes(current)) {
        return current;
      }
      return visibleFiles.find((file) => !settledMediaIds.includes(file.id))?.id ?? null;
    });
  }, [queuePaused, settledMediaIds, visibleFiles]);

  const handleMediaSettled = useCallback((fileId: number) => {
    setSettledMediaIds((prev) => (prev.includes(fileId) ? prev : [...prev, fileId]));
    setActiveLoadId((current) => (current === fileId ? null : current));
  }, []);

  const loadMore = useCallback(
    (mode: "auto" | "manual") => {
      if (!hasMore || loadingMore || loadMoreTimerRef.current != null) {
        return;
      }

      setLoadingMore(true);
      loadMoreTimerRef.current = window.setTimeout(
        () => {
          setVisibleCount((prev) => Math.min(prev + LOAD_BATCH_SIZE, files.length));
          setLoadingMore(false);
          loadMoreTimerRef.current = null;
        },
        mode === "auto" ? 120 : 0,
      );
    },
    [files.length, hasMore, loadingMore],
  );

  // 仅在用户滚动、且底部触发点接近视口底部时加载下一批；
  // 不在挂载时自动加载（避免一进来就把所有图片一次性拉完）。
  useEffect(() => {
    if (paged || !hasMore || typeof window === "undefined") {
      return undefined;
    }

    let frame = 0;
    const check = () => {
      frame = 0;
      const trigger = loadMoreTriggerRef.current;
      if (!trigger || loadingMore || loadMoreTimerRef.current != null) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      // 触发点滚动进入视口底部附近才加载
      if (rect.top <= viewportHeight + 160) {
        loadMore("auto");
      }
    };
    const onScroll = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(check);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [hasMore, loadMore, loadingMore]);

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

  function startSelectionMode(fileId: number) {
    setSelectionMode(true);
    setSelectedIds((prev) => (prev.includes(fileId) ? prev : [...prev, fileId]));
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds([]);
  }

  const updatePreviewRouteArg = useCallback(
    (fileId: number | null, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(location.search);
      PREVIEW_ARG_NAMES.forEach((name) => params.delete(name));
      if (fileId) {
        params.set("img_id", String(fileId));
      }

      const nextSearch = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : "",
        },
        { replace: options?.replace ?? false },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const openPreview = useCallback(
    (fileId: number) => {
      updatePreviewRouteArg(fileId);
    },
    [updatePreviewRouteArg],
  );

  const closePreview = useCallback(() => {
    updatePreviewRouteArg(null, { replace: true });
  }, [updatePreviewRouteArg]);

  const goToPreviewFile = useCallback(
    (fileId: number) => {
      updatePreviewRouteArg(fileId, { replace: true });
    },
    [updatePreviewRouteArg],
  );

  async function handleDownloadSelected(downloadType: "original" | "jpeg") {
    if (!selectedIds.length) {
      return;
    }

    if (isMobile && !isMobileNativeRuntime()) {
      submitAlbumDownloadForm(selectedIds, downloadType);
      show_alert("success", "ZIP 已开始下载。");
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

      const filename = `event-${detail.id}-${downloadType}.zip`;
      const blob = await response.blob();
      const result = await downloadBlobOrShare(blob, filename, {
        isMobile,
        title: filename,
        text: `活动 ${detail.event_name || detail.id} 相册下载`,
        mimeType: "application/zip",
      });
      if (isMobile && result === "downloaded") {
        show_alert("success", "ZIP 已开始下载。");
      }
    } catch (error) {
      show_alert("error", error instanceof Error ? error.message : "下载失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRotatePreview(fileId: number, angle: number) {
    if (!canEditEvent) {
      return;
    }

    try {
      const response = await apiFetch(`/media/rotate_file/${fileId}/${angle}`, {
        method: "POST",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "旋转失败");
      }
      setPreviewBumps((prev) => ({ ...prev, [fileId]: (prev[fileId] || 0) + 1 }));
    } catch (error) {
      show_alert("error", error instanceof Error ? error.message : "旋转失败");
    }
  }

  async function handleDeleteSelected() {
    if (!canEditEvent) {
      return;
    }
    if (!selectedIds.length) {
      return;
    }
    if (!(await showConfirmDialog({ message: `确认移除这 ${selectedIds.length} 张图片？`, tone: "danger" }))) {
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
      show_alert("error", error instanceof Error ? error.message : "移除失败");
    } finally {
      setBusy(false);
    }
  }

  const processedVisibleCount = visibleFiles.filter((file) => settledMediaIds.includes(file.id)).length;
  const pendingVisibleCount = Math.max(0, visibleFiles.length - processedVisibleCount);
  const showLoadingStatus = visibleFiles.length > 0 && (pendingVisibleCount > 0 || loadingMore);

  return (
    <section id="event-detail-photo-grid" style={panelStyle}>
      <style>{photoGridAnimationStyle}</style>
      {!hideHeader ? (
        <div id="event-detail-photo-grid-header" style={headerStyle(isMobile)}>
          <div id="event-detail-photo-grid-title-block">
            <div id="event-detail-photo-grid-eyebrow" style={eyebrowStyle}>Album Files</div>
            <h2 style={titleStyle}>活动照片</h2>
          </div>
          <div id="event-detail-photo-grid-meta" style={metaStyle}>
            <span>{files.length} 张</span>
            <span>已显示 {visibleFiles.length} 张</span>
          </div>
        </div>
      ) : null}

      <PhotoGridBatchActions
        isMobile={isMobile}
        selectionMode={selectionMode}
        selectedCount={selectedIds.length}
        busy={busy}
        onExit={exitSelectionMode}
        onDownloadJpeg={() => void handleDownloadSelected("jpeg")}
        canDelete={canEditEvent}
        onDelete={() => void handleDeleteSelected()}
      />

      {!files.length ? <PhotoGridEmptyState /> : null}

      {visibleFiles.length ? (
        <>
          <div id="event-detail-photo-grid-items" style={gridStyle(tileSize, paged)}>
            {visibleFiles.map((file, index) => (
              <PhotoCard
                key={file.id}
                file={file}
                index={index}
                tileSize={tileSize}
                paged={paged}
                isPoster={selectedPhotoId != null && selectedPhotoId === file.id}
                selectionMode={selectionMode}
                selected={selectedIds.includes(file.id)}
                previewVersion={previewBumps[file.id] || 0}
                videoProgress={videoProgress[file.id]}
                shouldLoad={settledMediaIds.includes(file.id) || activeLoadId === file.id}
                onToggleSelect={toggleSelect}
                onStartSelection={startSelectionMode}
                onOpenPreview={onPickPhoto || openPreview}
                onMediaSettled={handleMediaSettled}
              />
            ))}
          </div>
        </>
      ) : null}

      {showLoadingStatus ? (
        <PhotoGridLoadingStatus
          processedCount={processedVisibleCount}
          totalCount={visibleFiles.length}
          loadingMore={loadingMore}
          queuePaused={queuePaused}
        />
      ) : null}

      {paged ? (
        pageCount > 1 ? (
          <div id="event-detail-photo-grid-pager" style={photoPagerStyle}>
            <button
              type="button"
              style={photoPagerBtnStyle(safePage === 0)}
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ◀ 上一页
            </button>
            <span style={photoPagerLabelStyle}>{safePage + 1} / {pageCount}</span>
            <button
              type="button"
              style={photoPagerBtnStyle(safePage >= pageCount - 1)}
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              下一页 ▶
            </button>
          </div>
        ) : null
      ) : (
        <>
          <div id="event-detail-photo-grid-load-trigger" ref={loadMoreTriggerRef} style={loadTriggerStyle} />

          {hasMore && !loadingMore ? (
            <div id="event-detail-photo-grid-load-more" style={loadMoreWrapStyle}>
              <button id="event-detail-photo-grid-load-more-button" type="button" style={loadMoreButtonStyle} onClick={() => loadMore("manual")}>
                <i className="fa-solid fa-chevron-down" aria-hidden="true" style={loadMoreIconStyle} />
                <span>查看更多</span>
              </button>
            </div>
          ) : null}
        </>
      )}

      {activePreviewFile ? (
        <PhotoPreviewModal
          file={activePreviewFile}
          previousFile={previousPreviewFile}
          nextFile={nextPreviewFile}
          isMobile={isMobile}
          canEditEvent={canEditEvent}
          previewVersion={previewBumps[activePreviewFile.id] || 0}
          videoProgress={videoProgress[activePreviewFile.id]}
          onClose={closePreview}
          onNavigate={goToPreviewFile}
          onRotate={(angle) => void handleRotatePreview(activePreviewFile.id, angle)}
        />
      ) : null}
    </section>
  );
}

function PhotoGridEmptyState() {
  return (
    <div id="event-detail-photo-grid-empty" style={emptyStateStyle}>
      <div id="event-detail-photo-grid-empty-icon" style={emptyStateIconStyle}>
        <i className="fa-regular fa-images" aria-hidden="true" />
      </div>
      <div id="event-detail-photo-grid-empty-copy" style={emptyStateCopyStyle}>
        <div id="event-detail-photo-grid-empty-title" style={emptyStateTitleStyle}>还没有照片</div>
        <div id="event-detail-photo-grid-empty-text" style={emptyStateTextStyle}>上传后会在这里显示</div>
      </div>
    </div>
  );
}

function PhotoGridLoadingStatus({
  processedCount,
  totalCount,
  loadingMore,
  queuePaused,
}: {
  processedCount: number;
  totalCount: number;
  loadingMore: boolean;
  queuePaused: boolean;
}) {
  const statusText = queuePaused ? "加载已暂停" : loadingMore ? "正在准备更多照片" : "正在载入照片";
  return (
    <div id="event-detail-photo-grid-loading" style={loadingStatusStyle}>
      <div id="event-detail-photo-grid-loading-mark" style={loadingMarkStyle}>
        <span id="event-detail-photo-grid-loading-orbit" style={loadingOrbitStyle} />
        <span id="event-detail-photo-grid-loading-core" style={loadingCoreStyle} />
      </div>
      <div id="event-detail-photo-grid-loading-copy" style={loadingCopyStyle}>
        <div id="event-detail-photo-grid-loading-title" style={loadingTitleStyle}>{statusText}</div>
        <div id="event-detail-photo-grid-loading-meta" style={loadingMetaStyle}>
          {processedCount} / {totalCount}
        </div>
      </div>
    </div>
  );
}

function submitAlbumDownloadForm(fileIds: number[], downloadType: "original" | "jpeg") {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${API_BASE.replace(/\/+$/, "")}/media/download_files`;
  form.target = "_blank";
  form.style.display = "none";

  const fileIdsInput = document.createElement("input");
  fileIdsInput.type = "hidden";
  fileIdsInput.name = "file_ids";
  fileIdsInput.value = JSON.stringify(fileIds);
  form.appendChild(fileIdsInput);

  const typeInput = document.createElement("input");
  typeInput.type = "hidden";
  typeInput.name = "download_type";
  typeInput.value = downloadType;
  form.appendChild(typeInput);

  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => form.remove(), 1000);
}

function PhotoCard({
  file,
  index,
  tileSize,
  paged = false,
  isPoster = false,
  selectionMode,
  selected,
  previewVersion,
  videoProgress,
  shouldLoad,
  onToggleSelect,
  onStartSelection,
  onOpenPreview,
  onMediaSettled,
}: {
  file: AlbumFile;
  index: number;
  tileSize: PhotoTileSize;
  paged?: boolean;
  isPoster?: boolean;
  selectionMode: boolean;
  selected: boolean;
  previewVersion: number;
  videoProgress?: VideoProgressState;
  shouldLoad: boolean;
  onToggleSelect: (fileId: number) => void;
  onStartSelection: (fileId: number) => void;
  onOpenPreview: (fileId: number) => void;
  onMediaSettled: (fileId: number) => void;
}) {
  const [aspectRatio, setAspectRatio] = useState(() => fallbackTileRatio(file, index));
  const [mediaReady, setMediaReady] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const handleAssetChange = useCallback((asset: SmartMediaAsset | null) => {
    if (!asset) {
      if (shouldLoad) {
        setMediaReady(false);
        onMediaSettled(file.id);
      }
      return;
    }
  }, [file.id, onMediaSettled, shouldLoad]);

  const handleMediaLoad = useCallback((element: HTMLImageElement | HTMLVideoElement) => {
    if (element instanceof HTMLImageElement && element.naturalWidth && element.naturalHeight) {
      setAspectRatio(clampTileRatio(element.naturalWidth / element.naturalHeight));
    } else if (element instanceof HTMLVideoElement && element.videoWidth && element.videoHeight) {
      setAspectRatio(clampTileRatio(element.videoWidth / element.videoHeight));
    }
    setMediaReady(true);
    onMediaSettled(file.id);
  }, [file.id, onMediaSettled]);

  useEffect(() => {
    return () => clearLongPressTimer(longPressTimerRef);
  }, []);

  useEffect(() => {
    setMediaReady(false);
  }, [file.id, previewVersion]);

  useEffect(() => {
    if (!shouldLoad) {
      setMediaReady(false);
    }
  }, [shouldLoad]);

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (selectionMode) {
      onToggleSelect(file.id);
      return;
    }
    onStartSelection(file.id);
  }

  function handleTouchStart(_event: ReactTouchEvent<HTMLDivElement>) {
    if (selectionMode) {
      return;
    }
    longPressTriggeredRef.current = false;
    clearLongPressTimer(longPressTimerRef);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      onStartSelection(file.id);
      longPressTimerRef.current = null;
    }, 520);
  }

  function handleTouchEnd() {
    clearLongPressTimer(longPressTimerRef);
  }

  function handleCardAction() {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    if (selectionMode) {
      onToggleSelect(file.id);
      return;
    }
    onOpenPreview(file.id);
  }

  return (
    <div
      id={`event-detail-photo-${file.id}-card`}
      className="event-detail-photo-card"
      role="button"
      tabIndex={0}
      aria-label={`打开照片 ${file.id}`}
      style={cardStyle(index, selected, tileSize, aspectRatio, mediaReady, paged)}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onTouchEnd={handleTouchEnd}
      onClick={handleCardAction}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        event.preventDefault();
        handleCardAction();
      }}
    >
      {isPoster ? (
        <>
          <div style={posterRingStyle} />
          <div style={posterTagStyle}>海报</div>
        </>
      ) : null}
      {selectionMode ? (
        <div id={`event-detail-photo-${file.id}-selection`} style={selectionBadgeStyle(selected)}>
          <i
            className={selected ? "fa-solid fa-check" : "fa-solid fa-plus"}
            aria-hidden="true"
            style={selectionBadgeIconStyle(selected)}
          />
        </div>
      ) : null}
      {selectionMode ? (
        <button
          id={`event-detail-photo-${file.id}-zoom`}
          className="event-detail-photo-selection-zoom"
          type="button"
          aria-label="放大预览"
          style={selectionZoomButtonStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenPreview(file.id);
          }}
        >
          <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true" style={selectionZoomIconStyle} />
        </button>
      ) : null}
      <CacheMediaPlayer
        id={`event-detail-photo-${file.id}-media`}
        statusId={`event-detail-photo-${file.id}-media-status`}
        fileId={file.id}
        fileType={file.file_type}
        alt={file.user_display_name || `photo-${file.id}`}
        containerStyle={mediaContainerStyle(selected)}
        style={imageStyle}
        reloadKey={previewVersion}
        videoProgress={videoProgress || null}
        deferLoad={!shouldLoad}
        imageLoading="eager"
        onAssetChange={handleAssetChange}
        onMediaLoad={handleMediaLoad}
      />
    </div>
  );
}

function clearLongPressTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current != null) {
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function PhotoPreviewModal({
  file,
  previousFile,
  nextFile,
  isMobile,
  canEditEvent,
  previewVersion,
  videoProgress,
  onClose,
  onNavigate,
  onRotate,
}: {
  file: AlbumFile;
  previousFile: AlbumFile | null;
  nextFile: AlbumFile | null;
  isMobile: boolean;
  canEditEvent: boolean;
  previewVersion: number;
  videoProgress?: VideoProgressState;
  onClose: () => void;
  onNavigate: (fileId: number) => void;
  onRotate: (angle: number) => void;
}) {
  const isVideo = isVideoFile(file.file_type);
  const canRotate = canEditEvent && canRotateFile(file.file_type) && !isVideo;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && previousFile) {
        onNavigate(previousFile.id);
        return;
      }
      if (event.key === "ArrowRight" && nextFile) {
        onNavigate(nextFile.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextFile, onClose, onNavigate, previousFile]);

  return createPortal(
    <>
      <style>{previewAnimationStyle}</style>
      <div id="event-detail-photo-preview-overlay" style={previewOverlayStyle(isMobile)} onClick={onClose}>
        <div id="event-detail-photo-preview-shell" style={previewShellStyle(isMobile)} onClick={onClose}>
          <div id="event-detail-photo-preview-body" style={previewBodyStyle}>
            <div id="event-detail-photo-preview-stage" style={previewStageStyle(isMobile)}>
              <div id="event-detail-photo-preview-media-wrap" style={previewMediaWrapStyle}>
                <CacheMediaPlayer
                  id="event-detail-photo-preview-media"
                  statusId="event-detail-photo-preview-media-status"
                  fileId={file.id}
                  fileType={file.file_type}
                  alt={file.file_name || file.user_display_name || `photo-${file.id}`}
                  variant="base"
                  containerStyle={previewMediaContainerStyle}
                  style={isVideo ? previewVideoStyle(isMobile) : previewImageStyle(isMobile)}
                  reloadKey={previewVersion}
                  videoProgress={videoProgress || null}
                  videoAutoPlay={false}
                  videoMuted={false}
                  videoLoop={false}
                  videoControls
                  onMediaClick={(event) => event.stopPropagation()}
                />
              </div>
            </div>
          </div>
          <div
            id="event-detail-photo-preview-actions"
            style={previewActionRowStyle(isMobile)}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              id="event-detail-photo-preview-prev"
              type="button"
              aria-label="上一张"
              title="上一张"
              style={previewIconButtonStyle(!previousFile)}
              disabled={!previousFile}
              onClick={() => previousFile && onNavigate(previousFile.id)}
            >
              <i className="fa-solid fa-chevron-left" aria-hidden="true" style={previewIconStyle} />
            </button>
            <button
              id="event-detail-photo-preview-next"
              type="button"
              aria-label="下一张"
              title="下一张"
              style={previewIconButtonStyle(!nextFile)}
              disabled={!nextFile}
              onClick={() => nextFile && onNavigate(nextFile.id)}
            >
              <i className="fa-solid fa-chevron-right" aria-hidden="true" style={previewIconStyle} />
            </button>
            {canRotate ? (
              <>
                <button
                  id="event-detail-photo-preview-rotate-left"
                  type="button"
                  aria-label="左转"
                  title="左转"
                  style={previewIconButtonStyle(false)}
                  onClick={() => onRotate(-90)}
                >
                  <i className="fa-solid fa-rotate-left" aria-hidden="true" style={previewIconStyle} />
                </button>
                <button
                  id="event-detail-photo-preview-rotate-right"
                  type="button"
                  aria-label="右转"
                  title="右转"
                  style={previewIconButtonStyle(false)}
                  onClick={() => onRotate(90)}
                >
                  <i className="fa-solid fa-rotate-right" aria-hidden="true" style={previewIconStyle} />
                </button>
              </>
            ) : null}
            <button
              id="event-detail-photo-preview-close"
              type="button"
              aria-label="关闭"
              title="关闭"
              style={previewCloseButtonStyle}
              onClick={onClose}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" style={previewIconStyle} />
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

function readPreviewIdFromArgs(search: string) {
  const params = new URLSearchParams(search);
  for (const name of PREVIEW_ARG_NAMES) {
    const rawValue = params.get(name);
    if (!rawValue) {
      continue;
    }
    const parsed = Number(rawValue);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function isVideoFile(fileType?: string) {
  return VIDEO_EXTENSIONS.has(String(fileType || "").trim().toLowerCase());
}

function canRotateFile(fileType?: string) {
  return ROTATABLE_EXTENSIONS.has(String(fileType || "").trim().toLowerCase());
}

function getPhotoTileSize(): PhotoTileSize {
  if (typeof window === "undefined") {
    return "large";
  }
  if (window.innerWidth < 600) {
    return "small";
  }
  if (window.innerWidth < 1200) {
    return "medium";
  }
  if (window.innerWidth >= 1600) {
    return "xlarge";
  }
  return "large";
}

function fallbackTileRatio(file: AlbumFile, index: number) {
  const ratios = [1.32, 0.78, 1.08, 1.58, 0.9, 1.22, 0.72, 1.44, 1.12, 1.76];
  const key = Number.isFinite(file.id) ? file.id : index;
  return ratios[Math.abs(key + index) % ratios.length] || 1;
}

function clampTileRatio(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(2.1, Math.max(0.62, value));
}

const panelStyle: CSSProperties = {
  boxSizing: "border-box",
  padding: 0,
  borderRadius: 0,
  background: "transparent",
  border: "none",
  boxShadow: "none",
  backdropFilter: "none",
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

function gridStyle(tileSize: PhotoTileSize, paged = false): CSSProperties {
  if (paged) {
    // 分页模式：固定 ~100x100 小方块网格
    return {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, 100px)",
      gap: "6px",
      justifyContent: "start",
      background: "transparent",
    };
  }
  return {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "stretch",
    alignContent: "flex-start",
    gap: 0,
    background: "transparent",
    minHeight: tileSize === "small" ? "160px" : "220px",
  };
}

const cardStyle = (
  index: number,
  selected: boolean,
  tileSize: PhotoTileSize,
  aspectRatio: number,
  mediaReady: boolean,
  paged = false,
): CSSProperties => {
  if (paged) {
    return {
      padding: 0,
      border: "none",
      borderRadius: "6px",
      overflow: "hidden",
      background: "var(--x-color-canvas-alt)",
      cursor: "pointer",
      opacity: mediaReady ? 1 : 0,
      animation: mediaReady ? `album-photo-soft-in 320ms ease ${Math.min(index * 16, 160)}ms backwards` : undefined,
      position: "relative",
      outline: "none",
      width: "100px",
      height: "100px",
      display: "block",
      lineHeight: 0,
      isolation: "isolate",
    };
  }
  const normalizedRatio = clampTileRatio(aspectRatio);
  const rowHeight = tileSize === "small" ? 128 : tileSize === "medium" ? 190 : tileSize === "large" ? 260 : 340;
  const basis = Math.round(rowHeight * normalizedRatio);
  const minWidth = tileSize === "small" ? "31%" : tileSize === "medium" ? "150px" : tileSize === "large" ? "190px" : "260px";
  const maxWidth = tileSize === "small" ? "100%" : tileSize === "medium" ? "460px" : tileSize === "large" ? "640px" : "820px";

  return {
    padding: 0,
    border: "none",
    borderRadius: 0,
    overflow: "hidden",
    background: "transparent",
    textAlign: "left",
    cursor: "pointer",
    boxShadow: "none",
    opacity: mediaReady ? 1 : 0,
    animation: mediaReady ? `album-photo-soft-in 360ms cubic-bezier(0.2, 0.8, 0.2, 1) ${Math.min(index * 24, 180)}ms backwards` : undefined,
    position: "relative",
    outline: "none",
    minWidth,
    maxWidth,
    flex: `${normalizedRatio} 1 ${basis}px`,
    height: `${rowHeight}px`,
    display: "block",
    lineHeight: 0,
    isolation: "isolate",
    ...(mediaReady ? {} : hiddenCardStyle),
  };
};

const hiddenCardStyle: CSSProperties = {
  width: 0,
  height: 0,
  minWidth: 0,
  maxWidth: 0,
  flex: "0 0 0",
  overflow: "hidden",
  pointerEvents: "none",
};

const photoGridAnimationStyle = `
.event-detail-photo-card {
  transition: transform 200ms ease, box-shadow 200ms ease;
}
.event-detail-photo-card:hover {
  transform: scale(1.2);
  z-index: 5;
  box-shadow: 0 18px 40px var(--x-color-shadow);
}

@keyframes album-photo-soft-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
    filter: blur(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

@keyframes album-photo-loader-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes album-photo-loader-pulse {
  0%, 100% {
    opacity: 0.48;
    transform: scale(0.74);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes album-photo-status-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

#event-detail-photo-grid-load-more-button:hover {
  transform: translateY(-2px);
  border-color: rgba(56,189,248,0.44) !important;
  background: rgba(255,255,255,0.78) !important;
  color: rgba(3,105,161,0.98) !important;
}

#event-detail-photo-grid-load-more-button:focus-visible {
  outline: 2px solid rgba(56,189,248,0.7);
  outline-offset: 3px;
}

.event-detail-photo-selection-zoom:hover {
  transform: translateY(-2px) scale(1.06);
  background: rgba(255,255,255,0.78) !important;
  box-shadow: 0 14px 30px rgba(14,116,144,0.22) !important;
}

.event-detail-photo-selection-zoom:focus-visible {
  outline: 2px solid rgba(14,165,233,0.72);
  outline-offset: 3px;
}
`;

function mediaContainerStyle(selected: boolean): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    transform: selected ? "scale(0.86)" : "scale(1)",
    transformOrigin: "center",
    transition: "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
    background: selected ? "rgba(232,247,255,0.72)" : "transparent",
    boxShadow: selected ? "0 16px 34px rgba(14,116,144,0.18)" : "none",
  };
}

const imageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
  background: "#eef9ff",
};

const previewAnimationStyle = `
@keyframes event-detail-photo-preview-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes event-detail-photo-preview-shell-in {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.965);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes event-detail-photo-preview-media-in {
  from {
    opacity: 0;
    transform: scale(0.985);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

#event-detail-photo-preview-actions button:not(:disabled):hover {
  transform: scale(1.1);
  background: var(--x-color-accent) !important;
  border-color: var(--x-color-accent) !important;
  color: #ffffff !important;
}

#event-detail-photo-preview-close:not(:disabled):hover {
  background: var(--x-color-danger) !important;
  border-color: var(--x-color-danger) !important;
}

#event-detail-photo-preview-actions button:focus-visible {
  outline: 2px solid rgba(255,255,255,0.7);
  outline-offset: 3px;
}
`;

function previewOverlayStyle(isMobile: boolean): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex: 3000,
    display: "grid",
    placeItems: "center",
    padding: isMobile ? 0 : "24px",
    background: "rgba(18, 22, 26, 0.9)",
    backdropFilter: "blur(6px)",
    animation: "event-detail-photo-preview-overlay-in 180ms ease-out both",
  };
}

function previewShellStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "100vw" : "min(1180px, 96vw)",
    height: isMobile ? "100dvh" : "min(860px, 92vh)",
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr) auto",
    overflow: "hidden",
    borderRadius: 0,
    border: "none",
    background: "transparent",
    boxShadow: "none",
    transformOrigin: "50% 52%",
    animation: "event-detail-photo-preview-shell-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
  };
}

function previewActionRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: isMobile ? "18px" : "22px",
    padding: isMobile ? "10px 18px max(18px, env(safe-area-inset-bottom))" : "12px 18px 18px",
    background: "transparent",
  };
}

function previewIconButtonStyle(disabled: boolean): CSSProperties {
  return {
    width: "46px",
    height: "46px",
    padding: 0,
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(255,255,255,0.12)",
    color: "#ffffff",
    display: "grid",
    placeItems: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.35 : 1,
    boxShadow: "none",
    backdropFilter: "blur(6px)",
    transition: "transform 170ms ease, background 170ms ease, border-color 170ms ease, opacity 170ms ease",
  };
}

const previewCloseButtonStyle: CSSProperties = {
  ...previewIconButtonStyle(false),
};

const previewIconStyle: CSSProperties = {
  fontSize: "20px",
  lineHeight: 1,
  pointerEvents: "none",
};

const previewBodyStyle: CSSProperties = {
  minHeight: 0,
  display: "grid",
  background: "transparent",
};

function previewStageStyle(isMobile: boolean): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minHeight: 0,
    display: "grid",
    placeItems: "center",
    padding: isMobile ? "10px" : "16px",
    animation: "event-detail-photo-preview-media-in 260ms ease-out 80ms both",
  };
}

const previewMediaWrapStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  display: "grid",
  placeItems: "center",
  background: "transparent",
  border: "none",
  boxShadow: "none",
};

const previewMediaContainerStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
};

function previewImageStyle(isMobile: boolean): CSSProperties {
  return {
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    maxHeight: isMobile ? "calc(100dvh - 86px)" : "calc(92vh - 94px)",
    objectFit: "contain",
    display: "block",
    background: "transparent",
    borderRadius: isMobile ? 0 : "var(--x-radius-md)",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
  };
}

function previewVideoStyle(isMobile: boolean): CSSProperties {
  return {
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    maxHeight: isMobile ? "calc(100dvh - 86px)" : "calc(92vh - 94px)",
    objectFit: "contain",
    display: "block",
    background: "#000",
    borderRadius: isMobile ? 0 : "var(--x-radius-md)",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
  };
}

function selectionBadgeStyle(selected: boolean): CSSProperties {
  return {
    position: "absolute",
    top: "10px",
    right: "10px",
    zIndex: 1,
    width: "30px",
    height: "30px",
    borderRadius: "999px",
    display: "grid",
    placeItems: "center",
    background: selected ? "rgba(14,165,233,0.92)" : "rgba(232,247,255,0.68)",
    border: selected ? "1px solid rgba(153,246,228,0.66)" : "1px solid rgba(125,211,252,0.38)",
    color: selected ? "rgba(255,255,255,0.96)" : "rgba(31,78,121,0.84)",
    boxShadow: selected ? "0 10px 24px rgba(14,165,233,0.26)" : "0 10px 24px rgba(14,116,144,0.16)",
    backdropFilter: "blur(12px)",
  };
}

const selectionZoomButtonStyle: CSSProperties = {
  position: "absolute",
  left: "10px",
  bottom: "10px",
  zIndex: 3,
  width: "34px",
  height: "34px",
  padding: 0,
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255,255,255,0.72)",
  background: "rgba(232,247,255,0.68)",
  color: "rgba(12,74,110,0.94)",
  boxShadow: "0 10px 24px rgba(14,116,144,0.16)",
  backdropFilter: "blur(12px)",
  cursor: "zoom-in",
  lineHeight: 1,
  transition: "transform 140ms ease, background 140ms ease, box-shadow 140ms ease",
};

const selectionZoomIconStyle: CSSProperties = {
  fontSize: "14px",
  lineHeight: 1,
  pointerEvents: "none",
};

function selectionBadgeIconStyle(selected: boolean): CSSProperties {
  return {
    fontSize: selected ? "15px" : "13px",
    lineHeight: 1,
    pointerEvents: "none",
  };
}

const emptyStateStyle: CSSProperties = {
  minHeight: "220px",
  boxSizing: "border-box",
  padding: "32px 22px",
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: "14px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(232,247,255,0.8))",
  border: "1px solid rgba(56,189,248,0.12)",
  color: "rgba(31,78,121,0.86)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 18px 38px rgba(14,116,144,0.12)",
  animation: "album-photo-status-in 220ms ease both",
};

const emptyStateIconStyle: CSSProperties = {
  width: "54px",
  height: "54px",
  display: "grid",
  placeItems: "center",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.72)",
  border: "1px solid rgba(56,189,248,0.2)",
  color: "rgba(14,165,233,0.9)",
  fontSize: "23px",
  boxShadow: "0 12px 28px rgba(14,116,144,0.14)",
};

const emptyStateCopyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  textAlign: "center",
};

const emptyStateTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "rgba(12,74,110,0.96)",
};

const emptyStateTextStyle: CSSProperties = {
  fontSize: "13px",
  color: "rgba(70,120,158,0.82)",
};

const loadingStatusStyle: CSSProperties = {
  justifySelf: "center",
  minWidth: "min(320px, calc(100vw - 36px))",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  padding: "12px 16px",
  background: "rgba(232,247,255,0.72)",
  border: "1px solid rgba(56,189,248,0.18)",
  color: "rgba(31,78,121,0.92)",
  boxShadow: "0 18px 38px rgba(14,116,144,0.14), inset 0 1px 0 rgba(255,255,255,0.06)",
  backdropFilter: "blur(14px)",
  animation: "album-photo-status-in 180ms ease both",
};

const loadingMarkStyle: CSSProperties = {
  position: "relative",
  width: "28px",
  height: "28px",
  flex: "0 0 auto",
};

const loadingOrbitStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "999px",
  border: "2px solid rgba(56,189,248,0.16)",
  borderTopColor: "rgba(14,165,233,0.95)",
  animation: "album-photo-loader-spin 760ms linear infinite",
};

const loadingCoreStyle: CSSProperties = {
  position: "absolute",
  inset: "9px",
  borderRadius: "999px",
  background: "rgba(14,165,233,0.92)",
  boxShadow: "0 0 18px rgba(56,189,248,0.7)",
  animation: "album-photo-loader-pulse 900ms ease-in-out infinite",
};

const loadingCopyStyle: CSSProperties = {
  display: "grid",
  gap: "3px",
};

const loadingTitleStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "rgba(12,74,110,0.96)",
};

const loadingMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "rgba(70,120,158,0.86)",
};

const loadMoreIconStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1,
  pointerEvents: "none",
};

const loadTriggerStyle: CSSProperties = {
  height: "1px",
};

const loadMoreWrapStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  padding: "16px",
};

const photoPagerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "14px",
  padding: "18px 16px",
};

function photoPagerBtnStyle(disabled: boolean): CSSProperties {
  return {
    padding: "9px 18px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-line)",
    background: disabled ? "transparent" : "var(--x-color-panel)",
    color: disabled ? "var(--x-color-ink-muted)" : "var(--x-color-accent-strong)",
    fontSize: "13px",
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
}

const photoPagerLabelStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  minWidth: "56px",
  textAlign: "center",
};

const posterRingStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 4,
  borderRadius: "6px",
  boxShadow: "inset 0 0 0 3px var(--x-color-accent)",
  pointerEvents: "none",
};

const posterTagStyle: CSSProperties = {
  position: "absolute",
  top: "4px",
  left: "4px",
  zIndex: 5,
  padding: "2px 7px",
  borderRadius: "999px",
  background: "var(--x-color-accent)",
  color: "#ffffff",
  fontSize: "11px",
  fontWeight: 600,
  lineHeight: 1.4,
  pointerEvents: "none",
};

const loadMoreButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "9px",
  padding: "12px 18px",
  borderRadius: 0,
  border: "1px solid rgba(56,189,248,0.2)",
  background: "rgba(255,255,255,0.7)",
  color: "rgba(31,78,121,0.92)",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 14px 30px rgba(14,116,144,0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
  backdropFilter: "blur(14px)",
  transition: "transform 160ms ease, border-color 160ms ease, background 160ms ease, color 160ms ease",
};
