import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { useUserState } from "../../app/UserState";
import { CachedImage } from "../../components/CachedMedia";
import { uploadEventMedia } from "../../event/shared/api";
import { API_BASE, IS_APK } from "../../js/apiBase";
import {
  NativeAlbumUploadPluginBridge,
  type NativeAlbumUploadStatus,
} from "../../mobile/native/albumUploadPlugin";
import { isMobileNativeRuntime } from "../../mobile/native/capacitor";
import { ContinuousCapturePanel } from "./ContinuousCapturePanel";

type UploadQueueItem = {
  id: string;
  file: File;
  previewUrl: string | null;
  status: "queued" | "uploading" | "success" | "error";
  progress: number;
  error?: string | null;
};

type UploadMediaModalProps = {
  eventId: number;
  eventName?: string;
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
  embedded?: boolean;
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
  "mod",
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
  embedded = false,
}: UploadMediaModalProps) {
  const { isMobile } = useUserState();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nativeStatus, setNativeStatus] = useState<NativeAlbumUploadStatus | null>(null);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [uploadPage, setUploadPage] = useState(0);
  const queueRef = useRef<UploadQueueItem[]>([]);
  const nativeRefreshedJobsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    return () => {
      queueRef.current.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const stats = useMemo(() => {
    const successCount = queue.filter((item) => item.status === "success").length;
    const failedCount = queue.filter((item) => item.status === "error").length;
    return { successCount, failedCount };
  }, [queue]);
  const useNativeAlbumUpload = IS_APK && isMobileNativeRuntime();
  const nativeUploadActive = isNativeUploadActive(nativeStatus);
  const nativeProgress = getNativeUploadProgress(nativeStatus);

  // 电脑版队列分页
  const UPLOAD_PAGE_SIZE = 12;
  const queuePageCount = Math.max(1, Math.ceil(queue.length / UPLOAD_PAGE_SIZE));
  const safeUploadPage = Math.min(uploadPage, queuePageCount - 1);
  const pagedQueue = queue.slice(safeUploadPage * UPLOAD_PAGE_SIZE, safeUploadPage * UPLOAD_PAGE_SIZE + UPLOAD_PAGE_SIZE);

  useEffect(() => {
    if (!useNativeAlbumUpload) {
      return;
    }

    let canceled = false;
    void NativeAlbumUploadPluginBridge.getStatus()
      .then((status) => {
        if (canceled || !status.status || status.status === "idle") {
          return;
        }
        setNativeStatus(status);
        void refreshAfterNativeUpload(status);
      })
      .catch(() => undefined);

    return () => {
      canceled = true;
    };
  }, [onUploaded, useNativeAlbumUpload]);

  useEffect(() => {
    if (!useNativeAlbumUpload || !nativeStatus?.jobId || !isNativeUploadActive(nativeStatus)) {
      return;
    }

    let canceled = false;
    const jobId = nativeStatus.jobId;
    const refresh = async () => {
      try {
        const status = await NativeAlbumUploadPluginBridge.getStatus({ jobId });
        if (canceled) {
          return;
        }
        setNativeStatus(status);
        await refreshAfterNativeUpload(status);
      } catch {
        // Keep the last visible status; the service writes durable progress locally.
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1200);

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [nativeStatus?.jobId, nativeStatus?.status, onUploaded, useNativeAlbumUpload]);

  function patchQueueItem(itemId: string, updater: (item: UploadQueueItem) => UploadQueueItem) {
    setQueue((prev) => prev.map((item) => (item.id === itemId ? updater(item) : item)));
  }

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
        progress: 0,
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
    const pendingItems = queue.filter((item) => item.status !== "success");

    if (!pendingItems.length) {
      setToast("没有需要上传的文件");
      return;
    }

    setUploading(true);
    setToast(null);
    let uploadedAny = false;
    let successCount = 0;
    let failedCount = 0;

    for (const item of pendingItems) {
      patchQueueItem(item.id, (row) => ({
        ...row,
        status: "uploading",
        progress: 0,
        error: null,
      }));

      try {
        await uploadEventMedia(eventId, item.file, {
          onProgress: (percent) => {
            patchQueueItem(item.id, (row) => ({
              ...row,
              status: "uploading",
              progress: percent,
              error: null,
            }));
          },
        });
        uploadedAny = true;
        successCount += 1;
        patchQueueItem(item.id, (row) => ({
          ...row,
          status: "success",
          progress: 100,
          error: null,
        }));
      } catch (error) {
        failedCount += 1;
        patchQueueItem(item.id, (row) => ({
          ...row,
          status: "error",
          error: error instanceof Error ? error.message : "上传失败",
        }));
      }
    }

    setUploading(false);

    if (successCount && !failedCount) {
      setToast(`已完成 ${successCount} 个文件上传`);
    } else if (successCount && failedCount) {
      setToast(`成功 ${successCount} 个，失败 ${failedCount} 个`);
    } else if (failedCount) {
      setToast(`有 ${failedCount} 个文件上传失败`);
    }

    if (uploadedAny) {
      await onUploaded();
    }
  }

  async function refreshAfterNativeUpload(status: NativeAlbumUploadStatus) {
    const jobId = status.jobId;
    if (!jobId || !isNativeUploadTerminal(status) || nativeRefreshedJobsRef.current.has(jobId)) {
      return;
    }

    nativeRefreshedJobsRef.current.add(jobId);
    if ((status.completed ?? 0) > 0) {
      await onUploaded();
    }
  }

  async function handleNativePickAndUpload() {
    setNativeBusy(true);
    setToast(null);
    try {
      const status = await NativeAlbumUploadPluginBridge.pickAndUpload({
        eventId,
        baseUrl: API_BASE,
      });
      setNativeStatus(status);
      if (status.total && status.total > 0) {
        setToast(`已交给后台上传：${status.total} 个文件`);
      } else {
        setToast("没有选择文件");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "后台上传启动失败");
    } finally {
      setNativeBusy(false);
    }
  }

  async function handleNativeCameraCapture() {
    if (!NativeAlbumUploadPluginBridge.openNativeCameraCapture) {
      setCaptureOpen(true);
      return;
    }

    setNativeBusy(true);
    setToast(null);
    try {
      const status = await NativeAlbumUploadPluginBridge.openNativeCameraCapture({
        eventId,
        baseUrl: API_BASE,
        eventName,
      });
      setNativeStatus(status);
      await refreshAfterNativeUpload(status);
      if (status.total && status.total > 0) {
        setToast("拍摄文件已交给后台上传");
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "原生相机打开失败");
      setCaptureOpen(true);
    } finally {
      setNativeBusy(false);
    }
  }

  async function handleNativeCancel() {
    if (!nativeStatus?.jobId) {
      return;
    }

    setNativeBusy(true);
    try {
      const status = await NativeAlbumUploadPluginBridge.cancel({ jobId: nativeStatus.jobId });
      setNativeStatus(status);
      setToast("已取消后台上传");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "取消后台上传失败");
    } finally {
      setNativeBusy(false);
    }
  }

  if (captureOpen) {
    return (
      <div style={captureFullscreenStyle}>
        <ContinuousCapturePanel
          eventId={eventId}
          eventName={eventName}
          isMobile={isMobile}
          onExit={() => setCaptureOpen(false)}
          onUploaded={onUploaded}
        />
      </div>
    );
  }

  const headerEl = (
    <div style={headerStyle(isMobile)}>
      <div>
        <div style={eyebrowStyle}>上传照片</div>
        <h2 style={titleStyle(isMobile)}>上传文件</h2>
        <p style={copyStyle}>{eventName || `活动 #${eventId}`}</p>
      </div>
      {embedded ? null : (
        <button type="button" style={closeButtonStyle(isMobile)} onClick={onClose}>
          关闭
        </button>
      )}
    </div>
  );

  const pickerEl = (
    <>
              {useNativeAlbumUpload ? (
                <div style={nativeActionGridStyle(isMobile)}>
                  <button
                    type="button"
                    style={dropzoneButtonStyle(isMobile, nativeBusy || nativeUploadActive)}
                    onClick={() => void handleNativePickAndUpload()}
                    disabled={nativeBusy || nativeUploadActive}
                  >
                    <div style={dropTitleStyle(isMobile)}>选择图片或视频</div>
                    <div style={dropCopyStyle}>App 会交给系统后台上传，关闭窗口或切到后台后仍会继续。</div>
                  </button>
                  <button
                    type="button"
                    style={captureButtonStyle(isMobile, nativeBusy || nativeUploadActive)}
                    onClick={() => void handleNativeCameraCapture()}
                    disabled={nativeBusy || nativeUploadActive}
                  >
                    {nativeBusy ? "打开中…" : "拍摄"}
                  </button>
                </div>
              ) : (
                <div style={nativeActionGridStyle(isMobile)}>
                  <label style={dropzoneStyle(isMobile)}>
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      style={{ display: "none" }}
                      onChange={(event) => {
                        addFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                    <div style={dropTitleStyle(isMobile)}>选择图片或视频</div>
                    <div style={dropCopyStyle}>支持多次追加选择，上传成功后会自动刷新照片墙。</div>
                  </label>
                  {isMobile ? (
                    <button
                      type="button"
                      style={captureButtonStyle(isMobile, uploading)}
                      onClick={() => setCaptureOpen(true)}
                      disabled={uploading}
                    >
                      拍摄
                    </button>
                  ) : null}
                </div>
              )}
    </>
  );

  const bodyExtrasEl = (
    <>
              {toast ? <div style={toastStyle}>{toast}</div> : null}

              {useNativeAlbumUpload ? (
                <div style={nativePanelStyle}>
                  <div style={nativeHeaderStyle(isMobile)}>
                    <div>
                      <div style={nativeTitleStyle}>后台上传</div>
                      <div style={fileSubStyle}>
                        {nativeStatus?.status && nativeStatus.status !== "idle"
                          ? nativeStatusLabel(nativeStatus)
                          : "当前没有后台上传任务"}
                      </div>
                    </div>
                    <div style={statusStyle(nativeProgressStatus(nativeStatus))}>{nativeStatusLabel(nativeStatus)}</div>
                  </div>
                  <div style={nativeMetaGridStyle(isMobile)}>
                    <div style={nativeMetaItemStyle}>
                      <span style={nativeMetaLabelStyle}>总数</span>
                      <strong>{nativeStatus?.total ?? 0}</strong>
                    </div>
                    <div style={nativeMetaItemStyle}>
                      <span style={nativeMetaLabelStyle}>完成</span>
                      <strong>{nativeStatus?.completed ?? 0}</strong>
                    </div>
                    <div style={nativeMetaItemStyle}>
                      <span style={nativeMetaLabelStyle}>失败</span>
                      <strong>{nativeStatus?.failed ?? 0}</strong>
                    </div>
                  </div>
                  {nativeStatus?.currentFile ? (
                    <div style={fileSubStyle}>当前：{nativeStatus.currentFile}</div>
                  ) : null}
                  {nativeStatus?.error ? <div style={nativeErrorStyle}>{nativeStatus.error}</div> : null}
                  <div style={progressRowStyle}>
                    <div style={progressTrackStyle}>
                      <div style={progressFillStyle(nativeProgress, nativeProgressStatus(nativeStatus))} />
                    </div>
                    <div style={progressTextStyle(nativeProgressStatus(nativeStatus))}>{nativeProgress}%</div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={queueHeaderStyle}>
                    <span>{queue.length} 个待处理文件</span>
                    <span>
                      成功 {stats.successCount} / 失败 {stats.failedCount}
                    </span>
                  </div>

                  <div style={queueStyle}>
                    {!queue.length ? <div style={placeholderStyle}>当前还没有选择文件</div> : null}
                    {queue.map((item) => (
                      <div key={item.id} style={queueItemStyle(item.status, isMobile)}>
                        {item.previewUrl ? (
                          <CachedImage src={item.previewUrl} alt={item.file.name} style={previewImageStyle(isMobile)} />
                        ) : (
                          <div style={videoTileStyle(isMobile)}>VIDEO</div>
                        )}
                        <div style={fileMetaStyle}>
                          <div style={fileHeaderRowStyle(isMobile)}>
                            <div style={fileNameStyle(isMobile)}>{item.file.name}</div>
                            <div style={statusStyle(item.status)}>{statusLabel(item.status)}</div>
                          </div>
                          <div style={fileSubStyle}>
                            {(item.file.size / 1024 / 1024).toFixed(2)} MB
                            {item.error ? ` · ${item.error}` : ""}
                          </div>
                          <div style={progressRowStyle}>
                            <div style={progressTrackStyle}>
                              <div style={progressFillStyle(item.progress, item.status)} />
                            </div>
                            <div style={progressTextStyle(item.status)}>{item.progress}%</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          style={removeButtonStyle(isMobile)}
                          onClick={() => removeItem(item.id)}
                          disabled={uploading && item.status === "uploading"}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
    </>
  );

  const footerEl = (
    <div style={footerStyle(isMobile)}>
      {useNativeAlbumUpload ? (
        <>
          <button type="button" style={secondaryButtonStyle(isMobile)} onClick={onClose}>
            {nativeUploadActive ? "关闭并后台等待" : "关闭"}
          </button>
          {nativeUploadActive ? (
            <button
              type="button"
              style={dangerFooterButtonStyle(isMobile)}
              onClick={() => void handleNativeCancel()}
              disabled={nativeBusy}
            >
              取消后台上传
            </button>
          ) : null}
          <button
            type="button"
            style={primaryButtonStyle(isMobile)}
            disabled={nativeBusy || nativeUploadActive}
            onClick={() => void handleNativePickAndUpload()}
          >
            {nativeBusy ? "打开中…" : "选择并后台上传"}
          </button>
        </>
      ) : (
        <>
          <button type="button" style={secondaryButtonStyle(isMobile)} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            style={primaryButtonStyle(isMobile)}
            disabled={uploading || !queue.some((item) => item.status !== "success")}
            onClick={() => void handleUpload()}
          >
            {uploading ? "上传中…" : "开始上传"}
          </button>
        </>
      )}
    </div>
  );

  const content = isMobile ? (
    // 手机极简：竖向堆叠
    <>
      {headerEl}
      <div style={bodyStyle(true)}>
        {pickerEl}
        {bodyExtrasEl}
      </div>
      {footerEl}
    </>
  ) : (
    // 电脑完整：整块固定高度；待处理文件 card 网格铺满 + 分页；底部统一操作栏
    <>
      {headerEl}
      <div style={deskQueueScrollStyle}>
        {toast ? <div style={toastStyle}>{toast}</div> : null}
        <div style={queueHeaderStyle}>
          <span>{queue.length} 个待处理文件</span>
          <span>成功 {stats.successCount} / 失败 {stats.failedCount}</span>
        </div>
        {!queue.length ? (
          <div style={placeholderStyle}>当前还没有选择文件，点下方「选择图片或视频」</div>
        ) : (
          <div style={deskQueueGridStyle}>
            {pagedQueue.map((item) => (
              <div key={item.id} style={deskQueueCardStyle(item.status)}>
                <div style={deskCardMediaStyle}>
                  {item.previewUrl ? (
                    <CachedImage src={item.previewUrl} alt={item.file.name} style={deskCardImgStyle} />
                  ) : (
                    <span style={deskCardVideoStyle}>VIDEO</span>
                  )}
                </div>
                <div style={deskCardBodyStyle}>
                  <div style={deskCardNameStyle}>{item.file.name}</div>
                  <div style={fileSubStyle}>
                    {(item.file.size / 1024 / 1024).toFixed(2)} MB{item.error ? ` · ${item.error}` : ""}
                  </div>
                  <div style={progressRowStyle}>
                    <div style={progressTrackStyle}>
                      <div style={progressFillStyle(item.progress, item.status)} />
                    </div>
                    <div style={progressTextStyle(item.status)}>{item.progress}%</div>
                  </div>
                  <div style={deskCardFootRowStyle}>
                    <span style={statusStyle(item.status)}>{statusLabel(item.status)}</span>
                    <button
                      type="button"
                      style={deskCardRemoveStyle}
                      onClick={() => removeItem(item.id)}
                      disabled={uploading && item.status === "uploading"}
                    >
                      移除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={deskBottomStyle}>
        {queuePageCount > 1 ? (
          <div style={deskPagerStyle}>
            <button
              type="button"
              style={deskPagerBtnStyle(safeUploadPage === 0)}
              disabled={safeUploadPage === 0}
              onClick={() => setUploadPage((p) => Math.max(0, p - 1))}
            >
              ◀ 上一页
            </button>
            <span style={deskPagerLabelStyle}>{safeUploadPage + 1} / {queuePageCount}</span>
            <button
              type="button"
              style={deskPagerBtnStyle(safeUploadPage >= queuePageCount - 1)}
              disabled={safeUploadPage >= queuePageCount - 1}
              onClick={() => setUploadPage((p) => Math.min(queuePageCount - 1, p + 1))}
            >
              下一页 ▶
            </button>
          </div>
        ) : null}
        <div style={deskFooterStyle}>
          <label style={deskFooterPickerStyle}>
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              style={{ display: "none" }}
              onChange={(event) => {
                addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <i className="fa-solid fa-plus" aria-hidden="true" />
            选择图片或视频
          </label>
          <div style={{ flex: 1 }} />
          <button type="button" style={secondaryButtonStyle(false)} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            style={primaryButtonStyle(false)}
            disabled={uploading || !queue.some((item) => item.status !== "success")}
            onClick={() => void handleUpload()}
          >
            {uploading ? "上传中…" : "开始上传"}
          </button>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return <div style={modalStyle(isMobile, true)}>{content}</div>;
  }

  return (
    <div style={overlayStyle(isMobile)} onClick={onClose}>
      <div style={modalStyle(isMobile, false)} onClick={(event) => event.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}

function statusLabel(status: UploadQueueItem["status"]) {
  if (status === "success") return "完成";
  if (status === "error") return "失败";
  if (status === "uploading") return "上传中";
  return "待上传";
}

function isNativeUploadActive(status: NativeAlbumUploadStatus | null | undefined) {
  return status?.status === "queued" || status?.status === "running";
}

function isNativeUploadTerminal(status: NativeAlbumUploadStatus | null | undefined) {
  return (
    status?.status === "success" ||
    status?.status === "partial" ||
    status?.status === "error" ||
    status?.status === "canceled"
  );
}

function getNativeUploadProgress(status: NativeAlbumUploadStatus | null | undefined) {
  const total = Math.max(0, status?.total ?? 0);
  if (!total) {
    return 0;
  }
  const completed = Math.max(0, Math.min(total, status?.completed ?? 0));
  const currentProgress = isNativeUploadTerminal(status)
    ? 100
    : Math.max(0, Math.min(100, status?.currentProgress ?? 0));
  return Math.max(0, Math.min(100, Math.round(((completed * 100) + currentProgress) / total)));
}

function nativeProgressStatus(status: NativeAlbumUploadStatus | null | undefined): UploadQueueItem["status"] {
  if (status?.status === "success") {
    return "success";
  }
  if (status?.status === "partial" || status?.status === "error" || status?.status === "canceled") {
    return "error";
  }
  if (status?.status === "queued" || status?.status === "running") {
    return "uploading";
  }
  return "queued";
}

function nativeStatusLabel(status: NativeAlbumUploadStatus | null | undefined) {
  if (status?.status === "success") return "完成";
  if (status?.status === "partial") return "部分完成";
  if (status?.status === "error") return "失败";
  if (status?.status === "canceled") return "已取消";
  if (status?.status === "running") return "上传中";
  if (status?.status === "queued") return "等待中";
  return "空闲";
}

function overlayStyle(isMobile: boolean): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex: 5000,
    background: "rgba(15,23,42,0.32)",
    display: "grid",
    placeItems: "center",
    padding: isMobile ? "10px" : "24px",
    backdropFilter: "blur(8px)",
  };
}

const captureFullscreenStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 5100,
  background: "var(--x-color-canvas)",
  overflow: "hidden",
};

function modalStyle(isMobile: boolean, embedded: boolean): CSSProperties {
  if (embedded) {
    if (!isMobile) {
      // 电脑：整块固定高度、无圆角；行 = 头 / 队列(滚动) / 底部操作
      return {
        width: "100%",
        height: "760px",
        borderRadius: 0,
        background: "var(--x-color-panel)",
        border: "1px solid var(--x-color-line)",
        color: "var(--x-color-ink)",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        overflow: "hidden",
      };
    }
    return {
      width: "100%",
      borderRadius: "var(--x-radius-lg)",
      background: "var(--x-color-panel)",
      border: "1px solid var(--x-color-line)",
      boxShadow: "0 16px 40px var(--x-color-shadow-soft)",
      color: "var(--x-color-ink)",
      display: "grid",
      gridTemplateRows: "auto auto auto",
    };
  }
  return {
    width: "min(920px, 100%)",
    maxHeight: isMobile ? "94vh" : "90vh",
    overflow: "hidden",
    borderRadius: "var(--x-radius-lg)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    boxShadow: "0 16px 40px var(--x-color-shadow-soft)",
    color: "var(--x-color-ink)",
    backdropFilter: "blur(8px) saturate(140%)",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
  };
}

function headerStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "16px" : "20px 22px",
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "start",
    flexDirection: isMobile ? "column" : "row",
    borderBottom: "1px solid var(--x-color-line)",
  };
}

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  color: "var(--x-color-accent)",
};

function titleStyle(isMobile: boolean): CSSProperties {
  return {
    margin: "8px 0 4px",
    fontSize: isMobile ? "22px" : "28px",
    fontFamily: "var(--x-font-serif)",
    fontWeight: 500,
    color: "var(--x-color-ink)",
  };
}

const copyStyle: CSSProperties = {
  margin: 0,
  color: "var(--x-color-ink-muted)",
};

function bodyStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "16px" : "20px 22px",
    overflow: "auto",
    display: "grid",
    gap: "16px",
  };
}

// 电脑完整版：两列（左选择区 / 右队列）
const desktopBodyStyle: CSSProperties = {
  padding: "22px 24px",
  display: "grid",
  gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)",
  gap: "20px",
  alignItems: "start",
};

const desktopPickerColStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  alignContent: "start",
  minWidth: 0,
};

const desktopQueueColStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  alignContent: "start",
  minWidth: 0,
};

// —— 电脑版：队列滚动区 + card 网格 + 分页 + 底部操作 ——
const deskQueueScrollStyle: CSSProperties = {
  overflowY: "auto",
  padding: "18px 22px",
  display: "grid",
  gap: "14px",
  alignContent: "start",
};

const deskQueueGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, 184px)",
  gap: "14px",
  justifyContent: "start",
};

function deskQueueCardStyle(status: UploadQueueItem["status"]): CSSProperties {
  const border =
    status === "success"
      ? "var(--x-color-success)"
      : status === "error"
        ? "var(--x-color-danger-border)"
        : "var(--x-color-line)";
  return {
    width: "184px",
    display: "grid",
    gridTemplateRows: "auto auto",
    borderRadius: "var(--x-radius-md)",
    border: `1px solid ${border}`,
    background: "var(--x-color-panel)",
    boxShadow: "0 8px 20px var(--x-color-shadow-soft)",
    overflow: "hidden",
  };
}

const deskCardMediaStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "4 / 3",
  display: "grid",
  placeItems: "center",
  background: "var(--x-color-canvas-alt)",
  overflow: "hidden",
};

const deskCardImgStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "center 25%",
  display: "block",
};

const deskCardVideoStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "var(--x-color-ink-muted)",
};

const deskCardBodyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "10px 12px 12px",
};

const deskCardNameStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--x-color-ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const deskCardFootRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  marginTop: "2px",
};

const deskCardRemoveStyle: CSSProperties = {
  padding: "5px 12px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  cursor: "pointer",
};

const deskBottomStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "12px 22px 16px",
  borderTop: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
};

const deskPagerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "14px",
};

function deskPagerBtnStyle(disabled: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-line)",
    background: disabled ? "transparent" : "var(--x-color-panel)",
    color: disabled ? "var(--x-color-ink-muted)" : "var(--x-color-accent-strong)",
    fontSize: "13px",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
}

const deskPagerLabelStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  minWidth: "56px",
  textAlign: "center",
};

const deskFooterStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const deskFooterPickerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 18px",
  borderRadius: "var(--x-radius-md)",
  border: "1px dashed var(--x-color-accent-border)",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

function dropzoneStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridColumn: isMobile ? "1 / -1" : undefined,
    gap: "8px",
    padding: isMobile ? "16px" : "20px",
    borderRadius: "var(--x-radius-md)",
    border: "1px dashed var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    cursor: "pointer",
  };
}

function dropzoneButtonStyle(isMobile: boolean, disabled: boolean): CSSProperties {
  return {
    ...dropzoneStyle(isMobile),
    width: "100%",
    appearance: "none",
    font: "inherit",
    textAlign: "left",
    opacity: disabled ? 0.68 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function nativeActionGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
    gap: "10px",
    alignItems: "stretch",
  };
}

function captureButtonStyle(isMobile: boolean, disabled: boolean): CSSProperties {
  return {
    padding: isMobile ? "12px" : "0 18px",
    minHeight: isMobile ? "48px" : undefined,
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink)",
    font: "inherit",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.68 : 1,
  };
}

function dropTitleStyle(isMobile: boolean): CSSProperties {
  return {
    fontSize: isMobile ? "16px" : "18px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
  };
}

const dropCopyStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.6,
};

const toastStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-warning-border)",
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

function queueItemStyle(status: UploadQueueItem["status"], isMobile: boolean): CSSProperties {
  const background =
    status === "error"
      ? "var(--x-color-danger-soft)"
      : status === "success"
        ? "var(--x-color-success-soft)"
        : "var(--x-color-panel-alt)";
  const border =
    status === "error"
      ? "1px solid var(--x-color-danger-border)"
      : status === "success"
        ? "1px solid var(--x-color-success-border)"
        : "1px solid var(--x-color-line)";
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "56px minmax(0, 1fr)" : "72px minmax(0, 1fr) auto",
    gap: isMobile ? "10px" : "14px",
    alignItems: isMobile ? "start" : "center",
    padding: isMobile ? "10px" : "12px",
    borderRadius: "var(--x-radius-md)",
    background,
    border,
  };
}

function previewImageStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "56px" : "72px",
    height: isMobile ? "56px" : "72px",
    objectFit: "cover",
    borderRadius: "var(--x-radius-md)",
    background: "var(--x-color-canvas-alt)",
  };
}

function videoTileStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "56px" : "72px",
    height: isMobile ? "56px" : "72px",
    borderRadius: "var(--x-radius-md)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    display: "grid",
    placeItems: "center",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.08em",
  };
}

const fileMetaStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "6px",
};

function fileHeaderRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "flex-start" : "center",
    gap: "8px",
    flexDirection: isMobile ? "column" : "row",
  };
}

function fileNameStyle(isMobile: boolean): CSSProperties {
  return {
    fontSize: isMobile ? "14px" : "15px",
    fontWeight: 700,
    color: "var(--x-color-ink)",
    whiteSpace: isMobile ? "normal" : "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    wordBreak: "break-word",
  };
}

const fileSubStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  wordBreak: "break-word",
};

function statusStyle(status: UploadQueueItem["status"]): CSSProperties {
  const color =
    status === "success"
      ? "rgba(5,150,105,0.92)"
      : status === "error"
        ? "rgba(190,18,60,0.86)"
        : status === "uploading"
          ? "var(--x-color-accent)"
          : "var(--x-color-ink-muted)";
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    color,
    background:
      status === "success"
        ? "rgba(2, 122, 72, 0.1)"
        : status === "error"
          ? "rgba(180, 35, 24, 0.1)"
          : status === "uploading"
            ? "rgba(15, 118, 110, 0.12)"
            : "rgba(148, 163, 184, 0.14)",
    whiteSpace: "nowrap",
  };
}

const progressRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "10px",
  alignItems: "center",
};

const progressTrackStyle: CSSProperties = {
  position: "relative",
  height: "8px",
  borderRadius: "999px",
  overflow: "hidden",
  background: "var(--x-color-accent-soft)",
  boxShadow: "inset 0 1px 2px var(--x-color-shadow-soft)",
};

function progressFillStyle(progress: number, status: UploadQueueItem["status"]): CSSProperties {
  return {
    width: `${Math.max(0, Math.min(progress, 100))}%`,
    height: "100%",
    borderRadius: "999px",
    background:
      status === "success"
        ? "linear-gradient(90deg, rgba(16,185,129,0.9), var(--x-color-success))"
        : status === "error"
          ? "linear-gradient(90deg, rgba(244,63,94,0.76), var(--x-color-danger))"
          : "linear-gradient(90deg, var(--x-color-accent), var(--x-color-accent))",
    transition: "width 180ms ease",
  };
}

function progressTextStyle(status: UploadQueueItem["status"]): CSSProperties {
  return {
    fontSize: "12px",
    fontWeight: 700,
    minWidth: "42px",
    textAlign: "right",
    color:
      status === "success"
        ? "rgba(5,150,105,0.92)"
        : status === "error"
          ? "rgba(190,18,60,0.86)"
          : status === "uploading"
            ? "var(--x-color-accent)"
            : "var(--x-color-ink-muted)",
  };
}

function removeButtonStyle(isMobile: boolean): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: "999px",
    border: "1px solid rgba(244,63,94,0.24)",
    background: "rgba(255,255,255,0.6)",
    color: "rgba(159,18,57,0.86)",
    fontWeight: 700,
    cursor: "pointer",
    gridColumn: isMobile ? "1 / -1" : undefined,
    width: isMobile ? "100%" : undefined,
  };
}

const placeholderStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "var(--x-radius-md)",
  background: "rgba(255,255,255,0.46)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "var(--x-color-ink-muted)",
  backdropFilter: "blur(12px)",
};

const nativePanelStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "14px",
  borderRadius: "var(--x-radius-md)",
  background: "rgba(255,255,255,0.48)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  backdropFilter: "blur(14px)",
};

function nativeHeaderStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "flex-start" : "center",
    gap: "12px",
    flexDirection: isMobile ? "column" : "row",
  };
}

const nativeTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

function nativeMetaGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : "repeat(3, 120px)",
    gap: "10px",
  };
}

const nativeMetaItemStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  minWidth: 0,
};

const nativeMetaLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const nativeErrorStyle: CSSProperties = {
  fontSize: "13px",
  color: "rgba(190,18,60,0.86)",
  wordBreak: "break-word",
};

function footerStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "16px" : "18px 22px",
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    flexDirection: isMobile ? "column-reverse" : "row",
    borderTop: "1px solid rgba(255,255,255,0.1)",
  };
}

function secondaryButtonStyle(isMobile: boolean): CSSProperties {
  return {
    padding: "12px 18px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.6)",
    color: "var(--x-color-ink)",
    fontWeight: 700,
    cursor: "pointer",
    width: isMobile ? "100%" : undefined,
    boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
    backdropFilter: "blur(14px)",
  };
}

function primaryButtonStyle(isMobile: boolean): CSSProperties {
  return {
    padding: "12px 18px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-accent-border)",
    background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-accent-soft))",
    color: "var(--x-color-accent-strong)",
    fontWeight: 700,
    cursor: "pointer",
    width: isMobile ? "100%" : undefined,
    boxShadow: "0 14px 32px var(--x-color-accent-border)",
    backdropFilter: "blur(14px)",
  };
}

function dangerFooterButtonStyle(isMobile: boolean): CSSProperties {
  return {
    padding: "12px 18px",
    borderRadius: "999px",
    border: "1px solid rgba(244,63,94,0.24)",
    background: "rgba(255,255,255,0.6)",
    color: "rgba(159,18,57,0.86)",
    fontWeight: 700,
    cursor: "pointer",
    width: isMobile ? "100%" : undefined,
    boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
    backdropFilter: "blur(14px)",
  };
}

function closeButtonStyle(isMobile: boolean): CSSProperties {
  return {
    ...secondaryButtonStyle(isMobile),
    padding: "10px 14px",
    width: isMobile ? "100%" : undefined,
  };
}
