import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";

import { CacheMediaPlayer } from "../../components/CacheMediaPlayer";
import { useEventData } from "../../event/shared/EventDataContext";
import { fetchEventDetail } from "../../event/shared/api";
import type { EventDetailRecord } from "../../event/shared/types";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { PhotoGrid } from "./PhotoGrid";
import { EventCheckInPanel } from "./EventCheckInPanel";
import { EditEventModal } from "./EditEventModal";
import { EventFlowModal } from "./EventFlowModal";
import { UploadMediaModal } from "./UploadMediaModal";
import { useUserState } from "../../app/UserState";
import { API_BASE } from "../../js/apiBase";
import { downloadUrlOrShare, shareUrlOrCopy } from "../../js/browserActions";
import { smartImageURL } from "../../js/get_img";
import { show_alert } from "../../js/show_alert";
import { hasUserPermission } from "../../app/permissions";
import {
  connectEventMediaRoom,
  MEDIA_ROOM_UPDATE_EVENT,
  type MediaNotification,
} from "./mediaRealtime";
import { openBrochurePreviewModal } from "../../event/shared/brochurePreview";

const DEFAULT_DOCUMENT_TITLE = "地南佛学会";
const DEFAULT_DOCUMENT_ICON = "/favicon.ico";

export function EventDetailPage() {
  useEnsureDesignTokens();

  const { eventId } = useParams();
  const navigate = useNavigate();
  const { getEventById, refreshEvents } = useEventData();
  const { isMobile, isAuthenticated, openLogin, user } = useUserState();
  const [detail, setDetail] = useState<EventDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroHovered, setHeroHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showFlow, setShowFlow] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showContentInfo, setShowContentInfo] = useState(false);
  const [viewMode, setViewMode] = useState<"photos" | "checkin">("photos");
  const [mediaNotification, setMediaNotification] = useState<MediaNotification | null>(null);
  const [sharing, setSharing] = useState(false);
  const [isNarrowWidth, setIsNarrowWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 600 : false,
  );
  const detailRef = useRef<EventDetailRecord | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const canEditEvent = hasUserPermission(user, "event_edit");
  const canUseCheckIn = canEditEvent || isMobile;

  useEffect(() => {
    if (!canUseCheckIn && viewMode === "checkin") {
      setViewMode("photos");
    }
  }, [canUseCheckIn, viewMode]);

  useEffect(() => {
    const handleResize = () => {
      setIsNarrowWidth(window.innerWidth < 600);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previousBodyBackground = document.body.style.background;
    const previousHtmlBackground = document.documentElement.style.background;
    document.body.style.background = "#eef9ff";
    document.documentElement.style.background = "#eef9ff";

    return () => {
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousHtmlBackground;
    };
  }, []);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    if (!detail || typeof document === "undefined") {
      return;
    }

    let active = true;
    const title = detail.event_name || `活动 #${detail.id}`;
    const description = buildEventDocumentDescription(detail);
    const canonicalUrl = typeof window !== "undefined" ? `${window.location.origin}/event/${detail.id}` : "";

    document.title = title;
    setDocumentMeta("name", "description", description);
    setDocumentMeta("property", "og:type", "article");
    setDocumentMeta("property", "og:site_name", "UTBA");
    setDocumentMeta("property", "og:title", title);
    setDocumentMeta("property", "og:description", description);
    if (canonicalUrl) {
      setDocumentMeta("property", "og:url", canonicalUrl);
    }
    setDocumentMeta("name", "twitter:card", "summary_large_image");
    setDocumentMeta("name", "twitter:title", title);
    setDocumentMeta("name", "twitter:description", description);

    if (detail.event_image?.id) {
      void smartImageURL(detail.event_image.id, "cache")
        .then((imageUrl) => {
          if (!active || !isUsableDocumentImage(imageUrl)) {
            return;
          }
          const absoluteImageUrl = toAbsoluteDocumentUrl(imageUrl);
          setDocumentIcon(absoluteImageUrl);
          setDocumentMeta("property", "og:image", absoluteImageUrl);
          setDocumentMeta("property", "og:image:secure_url", absoluteImageUrl);
          setDocumentMeta("property", "og:image:alt", title);
          setDocumentMeta("name", "twitter:image", absoluteImageUrl);
        })
        .catch(() => undefined);
    } else {
      setDocumentIcon(DEFAULT_DOCUMENT_ICON);
    }

    return () => {
      active = false;
      document.title = DEFAULT_DOCUMENT_TITLE;
      setDocumentIcon(DEFAULT_DOCUMENT_ICON);
      removeManagedDocumentMeta();
    };
  }, [detail]);

  useEffect(() => {
    if (!eventId) {
      return;
    }
    void loadDetail(eventId);
  }, [eventId]);

  useEffect(() => {
    if (!detail?.event_code) {
      return;
    }

    let active = true;
    let socketRef: { disconnect: () => void; off: (event: string, listener?: (...args: unknown[]) => void) => void } | null = null;

    const scheduleSilentRefresh = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        if (detailRef.current?.id) {
          void loadDetail(String(detailRef.current.id), { silent: true });
        }
      }, 600);
    };

    const handleNotification = (payload: unknown) => {
      if (!active || !payload || typeof payload !== "object") {
        return;
      }

      const message = payload as MediaNotification;
      if (message.room !== detailRef.current?.event_code && message.event_code !== detailRef.current?.event_code) {
        return;
      }

      setMediaNotification(message);

      if (message.event === "create_album_file" && message.file_id) {
        setDetail((current) => {
          if (!current || current.album_files?.some((file) => file.id === message.file_id)) {
            return current;
          }
          const nextFile = {
            id: message.file_id,
            event_id: message.event_id ?? current.id,
            file_name: message.file_name,
            file_type: message.file_type,
            created_at: message.timestamp,
            user_id: message.user_id,
            user_display_name: message.username || "处理中",
          };
          return {
            ...current,
            album_files: [nextFile, ...(current.album_files || [])],
          };
        });
        scheduleSilentRefresh();
        return;
      }

      if (message.event === "delete_album_file" && message.file_id) {
        setDetail((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            album_files: (current.album_files || []).filter((file) => file.id !== message.file_id),
            event_image:
              current.event_image?.id === message.file_id
                ? null
                : current.event_image,
          };
        });
        scheduleSilentRefresh();
        return;
      }

      if (message.event === "video_done") {
        scheduleSilentRefresh();
      }
    };

    void connectEventMediaRoom(detail.event_code)
      .then((socket) => {
        if (!active) {
          socket.disconnect();
          return;
        }
        socketRef = socket;
        socket.on(MEDIA_ROOM_UPDATE_EVENT, handleNotification);
      })
      .catch((error) => {
        console.warn("[album-realtime] socket unavailable", error);
      });

    return () => {
      active = false;
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (socketRef) {
        socketRef.off(MEDIA_ROOM_UPDATE_EVENT, handleNotification);
        socketRef.disconnect();
      }
    };
  }, [detail?.event_code]);

  async function loadDetail(id: string, options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const payload = await fetchEventDetail(id);
      const shared = getEventById(id);
      const next = payload.data ? { ...shared, ...payload.data } : shared;
      setDetail((next as EventDetailRecord | null) ?? null);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "读取活动失败");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function handleDownloadBrochure() {
    if (!detail?.brochure_path) {
      return;
    }
    const url = `/media_file/${detail.brochure_path}`;
    const filename = detail.brochure_name || detail.brochure_path.split("/").pop() || "event-brochure";
    try {
      await downloadUrlOrShare(url, filename, {
        isMobile,
        title: detail.event_name || filename,
        text: filename,
        fallbackUrl: `${window.location.origin}${url}`,
        mimeType: detail.brochure_mime || undefined,
      });
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "下载失败");
    }
  }

  async function handleShareEvent() {
    if (!detail || sharing) {
      return;
    }

    setSharing(true);
    try {
      const title = detail.event_name || `活动 #${detail.id}`;
      const result = await shareUrlOrCopy(buildEventShareUrl(detail.id), title, buildEventDocumentDescription(detail));
      if (result === "copied") {
        show_alert("success", "系统分享不可用，已复制活动分享链接。");
      }
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "分享失败");
    } finally {
      setSharing(false);
    }
  }

  if (!eventId) {
    return (
      <div id="event-detail-missing-id" style={placeholderStyle}>
        缺少 event_id
      </div>
    );
  }

  if (loading) {
    return (
      <div id="event-detail-loading" style={placeholderStyle}>
        读取活动详情中…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div id="event-detail-error" style={errorStyle}>
        {error || "活动不存在"}
      </div>
    );
  }

  return (
    <div id="event-detail-page" style={pageStyle}>
      <style>{eventDetailToolbarInteractionStyle}</style>
      <div id="event-detail-hero-shell" style={heroShellStyle}>
        <section
          id="event-detail-hero"
          style={heroStyle(Boolean(detail.event_image?.id), isMobile)}
          onMouseEnter={() => !isMobile && setHeroHovered(true)}
          onMouseLeave={() => !isMobile && setHeroHovered(false)}
          onTouchStart={() => setHeroHovered(true)}
          onTouchEnd={() => setHeroHovered(false)}
          onTouchCancel={() => setHeroHovered(false)}
        >
          {detail.event_image?.id ? (
            <div id="event-detail-hero-media" style={heroMediaLayerStyle}>
              <CacheMediaPlayer
                id="event-detail-hero-media-player"
                statusId="event-detail-hero-media-status"
                fileId={detail.event_image.id}
                fileType={detail.event_image.file_type}
                eventCode={detail.event_code}
                mediaNotification={mediaNotification}
                containerStyle={heroMediaContainerStyle}
                style={heroMediaStyle}
                retryAttempts={6}
                retryDelayMs={1500}
              />
            </div>
          ) : null}
          <div id="event-detail-hero-overlay" style={heroOverlayStyle(heroHovered)} />
          <div id="event-detail-hero-content" style={heroContentStyle}>
            <div id="event-detail-hero-eyebrow" style={heroEyebrowStyle}>Event Detail</div>
            <h1 style={heroTitleStyle}>{detail.event_name || `活动 #${detail.id}`}</h1>
            <p style={heroMetaStyle}>
              {detail.location || "地南佛学会"} · {formatDateRange(detail.datetime, detail.end_datetime)}
            </p>
            {detail.purpose ? <p style={heroBodyStyle}>{detail.purpose}</p> : null}
          </div>
        </section>

        <section id="event-detail-toolbar" style={toolbarStyle(isMobile, isNarrowWidth)}>
          <div id="event-detail-toolbar-navigation" style={toolbarGroupStyle}>
            <IconToolbarButton
              id="event-detail-toolbar-home"
              label="返回首页"
              icon="fa-solid fa-house"
              onClick={() => navigate("/")}
            />
            <button
              type="button"
              id="event-detail-toolbar-prev"
              aria-label="上一个"
              title="上一个"
              style={iconToolbarButtonStyle(!detail.prev_event_id)}
              disabled={!detail.prev_event_id}
              onClick={() => {
                if (detail.prev_event_id) {
                  navigate(`/event/${detail.prev_event_id}`);
                }
              }}
            >
              <i className="fa-solid fa-chevron-left" aria-hidden="true" style={toolbarIconStyle} />
            </button>
            <button
              type="button"
              id="event-detail-toolbar-next"
              aria-label="下一个"
              title="下一个"
              style={iconToolbarButtonStyle(!detail.next_event_id)}
              disabled={!detail.next_event_id}
              onClick={() => {
                if (detail.next_event_id) {
                  navigate(`/event/${detail.next_event_id}`);
                }
              }}
            >
              <i className="fa-solid fa-chevron-right" aria-hidden="true" style={toolbarIconStyle} />
            </button>
          </div>
          <div id="event-detail-toolbar-actions" style={toolbarGroupStyle}>
            <IconToolbarButton
              id="event-detail-toolbar-content"
              label="内容"
              icon="fa-solid fa-circle-info"
              onClick={() => setShowContentInfo(true)}
            />
            <IconToolbarButton
              id="event-detail-toolbar-share"
              label={sharing ? "分享中" : "分享活动"}
              icon={sharing ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-share-nodes"}
              disabled={sharing}
              onClick={() => void handleShareEvent()}
            />
            <IconToolbarButton
              id="event-detail-toolbar-photos"
              label="照片"
              icon="fa-solid fa-images"
              active={viewMode === "photos"}
              onClick={() => setViewMode("photos")}
            />
            {canUseCheckIn ? (
              <IconToolbarButton
                id="event-detail-toolbar-checkin"
                label="签到"
                icon="fa-solid fa-clipboard-check"
                active={viewMode === "checkin"}
                onClick={() => {
                  if (isMobile && !isAuthenticated) {
                    openLogin(window.location.pathname + window.location.search);
                    return;
                  }
                  setViewMode("checkin");
                }}
              />
            ) : null}
            {canEditEvent ? (
              <IconToolbarButton
                id="event-detail-toolbar-edit"
                label="编辑活动资料"
                icon="fa-solid fa-pen-to-square"
                accent
                onClick={() => setEditing(true)}
              />
            ) : null}
            {canEditEvent ? (
              <IconToolbarButton
                id="event-detail-toolbar-upload"
                label="上传照片 / 视频"
                icon="fa-solid fa-cloud-arrow-up"
                onClick={() => setShowUpload(true)}
              />
            ) : null}
            {detail.datetime && detail.end_datetime ? (
              <IconToolbarButton
                id="event-detail-toolbar-flow"
                label="活动流程"
                icon="fa-solid fa-timeline"
                onClick={() => setShowFlow(true)}
              />
            ) : null}
          </div>
        </section>
      </div>

      <section id="event-detail-content" style={contentWrapStyle(isMobile, isNarrowWidth)}>
        {viewMode === "photos" ? (
          <PhotoGrid detail={detail} isMobile={isMobile} mediaNotification={mediaNotification} canEditEvent={canEditEvent} hideHeader />
        ) : (
          <EventCheckInPanel
            detail={detail}
            isMobile={isMobile}
            onChanged={async () => {
              await loadDetail(String(detail.id), { silent: true });
              void refreshEvents();
            }}
          />
        )}
      </section>

      {editing ? (
        <EditEventModal
          detail={detail}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setDetail(next);
            void refreshEvents();
          }}
        />
      ) : null}
      {showUpload ? (
        <UploadMediaModal
          eventId={detail.id}
          eventName={detail.event_name}
          onClose={() => setShowUpload(false)}
          onUploaded={async () => {
            await loadDetail(String(detail.id));
            void refreshEvents();
          }}
        />
      ) : null}
      {showFlow ? <EventFlowModal detail={detail} canEdit={canEditEvent} onClose={() => setShowFlow(false)} /> : null}
      {showContentInfo ? (
        <EventContentInfoModal
          detail={detail}
          isMobile={isMobile}
          onDownloadBrochure={() => void handleDownloadBrochure()}
          onClose={() => setShowContentInfo(false)}
        />
      ) : null}
    </div>
  );
}

function EventContentInfoModal({
  detail,
  isMobile,
  onDownloadBrochure,
  onClose,
}: {
  detail: EventDetailRecord;
  isMobile: boolean;
  onDownloadBrochure: () => void;
  onClose: () => void;
}) {
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const photoCount = detail.album_files?.length || 0;
  const organizers = (detail.organizers || []).map((user) => user.display_name || user.username || user.id).join(", ") || "-";
  const hasBrochure = Boolean(detail.brochure_path);

  return createPortal(
    <>
    <style>{contentInfoAnimationStyle}</style>
    <div id="event-detail-content-info-overlay" style={contentInfoOverlayStyle(isMobile)} onClick={onClose}>
      <div id="event-detail-content-info-dialog" style={contentInfoDialogStyle(isMobile)} onClick={(event) => event.stopPropagation()}>
        <div id="event-detail-content-info-header" style={contentInfoHeaderStyle}>
          <div id="event-detail-content-info-title-block" style={contentInfoTitleBlockStyle}>
            <div id="event-detail-content-info-kicker" style={contentInfoKickerStyle}>Event Content</div>
            <div id="event-detail-content-info-title" style={contentInfoTitleStyle}>内容</div>
          </div>
          <button
            id="event-detail-content-info-close"
            type="button"
            aria-label="关闭"
            title="关闭"
            style={contentInfoCloseButtonStyle}
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div id="event-detail-content-info-body" style={contentInfoBodyStyle}>
          <section id="event-detail-content-info-summary-section" style={contentInfoSectionStyle}>
            <div id="event-detail-content-info-summary-header" style={contentInfoSectionHeaderStyle}>
              <div id="event-detail-content-info-summary-icon" style={contentInfoSectionIconStyle}>
                <i className="fa-solid fa-list-check" aria-hidden="true" />
              </div>
              <div id="event-detail-content-info-summary-heading" style={contentInfoSectionHeadingStyle}>活动信息</div>
            </div>
            <div id="event-detail-content-info-grid" style={contentInfoGridStyle(isMobile)}>
              <InfoRow id="event-detail-content-info-photos-row" icon="fa-solid fa-images" label="活动照片" value={`${photoCount} 张`} isMobile={isMobile} />
              <InfoRow id="event-detail-content-info-creator-row" icon="fa-solid fa-user" label="创建者" value={detail.display_name || detail.username || "-"} isMobile={isMobile} />
              <InfoRow id="event-detail-content-info-type-row" icon="fa-solid fa-layer-group" label="类型" value={detail.type || "-"} isMobile={isMobile} />
              <InfoRow id="event-detail-content-info-target-row" icon="fa-solid fa-users" label="对象" value={detail.target || "-"} isMobile={isMobile} />
              <InfoRow id="event-detail-content-info-organizers-row" icon="fa-solid fa-people-group" label="筹备团队" value={organizers} isMobile={isMobile} />
            </div>
          </section>

          <section id="event-detail-content-info-brochure-section" style={contentInfoSectionStyle}>
            <div id="event-detail-content-info-brochure-header" style={contentInfoSectionHeaderStyle}>
              <div id="event-detail-content-info-brochure-icon" style={contentInfoSectionIconStyle}>
                <i className="fa-solid fa-file-lines" aria-hidden="true" />
              </div>
              <div id="event-detail-content-info-brochure-heading" style={contentInfoSectionHeadingStyle}>简章</div>
            </div>
            <div id="event-detail-content-info-brochure-card" style={contentInfoBrochureCardStyle(hasBrochure, isMobile)}>
              <div id="event-detail-content-info-brochure-meta" style={contentInfoBrochureMetaStyle}>
                <div id="event-detail-content-info-brochure-name" style={contentInfoBrochureNameStyle}>
                  {detail.brochure_name || (hasBrochure ? "活动文件" : "未上传简章")}
                </div>
                <div id="event-detail-content-info-brochure-mime" style={contentInfoBrochureMimeStyle}>
                  {hasBrochure ? detail.brochure_mime || "可以预览或下载" : "暂无简章文件"}
                </div>
              </div>
              {hasBrochure ? (
                <div id="event-detail-content-info-brochure-actions" style={contentInfoBrochureActionsStyle}>
                  <button
                    id="event-detail-content-info-brochure-preview"
                    type="button"
                    aria-label="预览简章"
                    title="预览简章"
                    style={contentInfoActionButtonStyle}
                    onClick={() =>
                      openBrochurePreviewModal({
                        file_name: detail.brochure_name || undefined,
                        file_path: detail.brochure_path || "",
                        mime_type: detail.brochure_mime || undefined,
                      })
                    }
                  >
                    <i className="fa-solid fa-eye" aria-hidden="true" />
                  </button>
                  <button
                    id="event-detail-content-info-brochure-download"
                    type="button"
                    aria-label="下载简章"
                    title="下载简章"
                    style={contentInfoActionButtonStyle}
                    onClick={onDownloadBrochure}
                  >
                    <i className="fa-solid fa-download" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
    </>,
    document.body,
  );
}

function InfoRow({
  id,
  icon,
  label,
  value,
  isMobile,
}: {
  id: string;
  icon: string;
  label: string;
  value: string;
  isMobile: boolean;
}) {
  return (
    <div id={id} style={contentInfoRowStyle(isMobile)}>
      <div id={`${id}-label-block`} style={contentInfoLabelBlockStyle}>
        <span id={`${id}-icon`} style={contentInfoRowIconStyle}>
          <i className={icon} aria-hidden="true" />
        </span>
        <span id={`${id}-label`} style={contentInfoLabelStyle}>{label}</span>
      </div>
      <span id={`${id}-value`} style={contentInfoValueStyle(isMobile)}>{value}</span>
    </div>
  );
}

function IconToolbarButton({
  id,
  label,
  icon,
  active = false,
  accent = false,
  disabled = false,
  onClick,
}: {
  id: string;
  label: string;
  icon: string;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      aria-label={label}
      title={label}
      style={iconToolbarButtonStyle(disabled, active, accent)}
      disabled={disabled}
      onClick={onClick}
    >
      <i className={icon} aria-hidden="true" style={toolbarIconStyle} />
    </button>
  );
}

function formatDateRange(start?: string, end?: string) {
  if (!start) return "-";
  const startDate = start.slice(0, 10);
  const endDate = end?.slice(0, 10);
  return endDate && endDate !== startDate ? `${startDate} - ${endDate}` : startDate;
}

function buildEventDocumentDescription(detail: EventDetailRecord) {
  return [
    detail.datetime ? formatDateRange(detail.datetime, detail.end_datetime) : "",
    detail.location,
    detail.type,
    detail.target,
    detail.purpose,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" · ")
    .slice(0, 220) || "UTBA 活动详情";
}

function buildEventShareUrl(eventId: number) {
  const base = API_BASE || window.location.origin;
  return new URL(`/event/${eventId}`, base).toString();
}

function findDocumentMeta(attribute: "name" | "property", key: string) {
  return Array.from(document.head.querySelectorAll("meta")).find(
    (element) => element.getAttribute(attribute) === key,
  ) as HTMLMetaElement | undefined;
}

function setDocumentMeta(attribute: "name" | "property", key: string, content: string) {
  if (!content) {
    return;
  }
  let element = findDocumentMeta(attribute, key);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    element.dataset.xinyaEventMeta = "true";
    document.head.appendChild(element);
  }
  element.content = content;
}

function removeManagedDocumentMeta() {
  document.head.querySelectorAll('meta[data-xinya-event-meta="true"]').forEach((element) => {
    element.remove();
  });
}

function setDocumentIcon(href: string) {
  const rels = ["icon", "apple-touch-icon"];
  rels.forEach((rel) => {
    let element = Array.from(document.head.querySelectorAll("link")).find((link) => {
      return (link.getAttribute("rel") || "").split(/\s+/).includes(rel);
    }) as HTMLLinkElement | undefined;
    if (!element) {
      element = document.createElement("link");
      element.rel = rel;
      document.head.appendChild(element);
    }
    element.href = href;
  });
}

function toAbsoluteDocumentUrl(url: string) {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

function isUsableDocumentImage(url: string) {
  return Boolean(url && !url.includes("broken-image.png"));
}

function heroStyle(hasCover: boolean, isMobile: boolean): CSSProperties {
  return {
    minHeight: isMobile ? "42vh" : "58vh",
    position: "relative",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    background: hasCover
      ? "linear-gradient(135deg, rgba(18,52,59,0.7), rgba(15,118,110,0.52), rgba(29,78,216,0.4))"
      : "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
  };
}

const heroShellStyle: CSSProperties = {
  position: "relative",
};

const heroMediaLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
};

const heroMediaContainerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  height: "100%",
};

const heroMediaStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  background: "#eef9ff",
  paddingBottom: "32px",
};

function heroOverlayStyle(hovered: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(to bottom, rgba(14,116,144,0.08), rgba(214,242,255,0.5))",
    backdropFilter: `blur(${hovered ? 1 : 6}px)`,
    zIndex: 1,
  };
}

const heroContentStyle: CSSProperties = {
  position: "relative",
  zIndex: 2,
  padding: "24px",
  textAlign: "center",
  display: "grid",
  gap: "12px",
  color: "rgba(12,74,110,0.96)",
  textShadow: "0 1px 18px rgba(255,255,255,0.72)",
};

const heroEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  opacity: 0.8,
};

const heroTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(32px, 5vw, 52px)",
};

const heroMetaStyle: CSSProperties = {
  margin: 0,
  fontSize: "16px",
  opacity: 0.88,
};

const heroBodyStyle: CSSProperties = {
  margin: "0 auto",
  maxWidth: "60ch",
  lineHeight: 1.7,
  opacity: 0.92,
};

const glassContainerStyle: CSSProperties = {
  boxSizing: "border-box",
  borderRadius: 0,
  background: "linear-gradient(180deg, rgba(255,255,255,0.64), rgba(232,247,255,0.5))",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 24px 60px rgba(14,116,144,0.12), inset 0 1px 0 rgba(255,255,255,0.1)",
  backdropFilter: "blur(22px) saturate(140%)",
};

const glassInsetStyle: CSSProperties = {
  boxSizing: "border-box",
  borderRadius: 0,
  background: "rgba(255,255,255,0.48)",
  border: "1px solid rgba(255,255,255,0.11)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 28px rgba(14,116,144,0.08)",
  backdropFilter: "blur(14px) saturate(130%)",
};

function toolbarStyle(isMobile: boolean, isNarrowWidth: boolean): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 4,
    maxWidth: "none",
    width: "100%",
    boxSizing: "border-box",
    margin: 0,
    padding: isNarrowWidth ? "0 0 12px" : isMobile ? "0 14px 14px" : "0 20px 18px",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    alignItems: isMobile ? "stretch" : "center",
    flexDirection: isMobile ? "column" : "row",
    background: "transparent",
    border: "none",
    boxShadow: "none",
    backdropFilter: "none",
  };
}

const toolbarGroupStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
  padding: "8px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.56)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 16px 38px rgba(14,116,144,0.14), inset 0 1px 0 rgba(255,255,255,0.08)",
  backdropFilter: "blur(18px) saturate(140%)",
};

function iconToolbarButtonStyle(disabled: boolean, active = false, accent = false): CSSProperties {
  const isActive = active || accent;
  return {
    width: "42px",
    height: "42px",
    padding: 0,
    borderRadius: "999px",
    border: isActive ? "1px solid rgba(255,255,255,0.24)" : "1px solid rgba(255,255,255,0.2)",
    background: disabled
      ? "rgba(125,211,252,0.18)"
      : isActive
        ? "linear-gradient(135deg, rgba(14,165,233,0.78), rgba(125,211,252,0.62))"
        : "rgba(255,255,255,0.58)",
    color: disabled ? "rgba(70,120,158,0.32)" : isActive ? "rgba(3,105,161,0.98)" : "rgba(31,78,121,0.9)",
    display: "grid",
    placeItems: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : isActive ? "0 14px 32px rgba(56,189,248,0.22)" : "0 10px 24px rgba(14,116,144,0.12)",
    backdropFilter: "blur(14px) saturate(130%)",
    transition: "transform 170ms ease, background 170ms ease, border-color 170ms ease, color 170ms ease",
  };
}

const toolbarIconStyle: CSSProperties = {
  fontSize: "17px",
  lineHeight: 1,
  pointerEvents: "none",
};

const eventDetailToolbarInteractionStyle = `
#event-detail-toolbar button:not(:disabled):hover {
  transform: translateY(-2px) scale(1.08);
}

#event-detail-toolbar button:focus-visible {
  outline: 2px solid rgba(15,118,110,0.48);
  outline-offset: 3px;
}
`;

function contentWrapStyle(isMobile: boolean, isNarrowWidth: boolean): CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    margin: 0,
    padding: 0,
    display: "grid",
    gap: 0,
  };
}

const placeholderStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  display: "grid",
  placeItems: "center",
  background: "#eef9ff",
  color: "rgba(70,120,158,0.86)",
};

const errorStyle: CSSProperties = {
  ...placeholderStyle,
  color: "rgba(190,18,60,0.86)",
};

const contentInfoAnimationStyle = `
@keyframes event-content-info-overlay-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes event-content-info-dialog-in {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.965);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes event-content-info-section-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

#event-detail-content-info-dialog button:not(:disabled):hover {
  transform: translateY(-2px) scale(1.08);
  background: rgba(255,255,255,0.82) !important;
  border-color: rgba(56,189,248,0.44) !important;
  color: rgba(3,105,161,0.98) !important;
}

#event-detail-content-info-dialog button:focus-visible {
  outline: 2px solid rgba(56,189,248,0.7);
  outline-offset: 3px;
}
`;

function contentInfoOverlayStyle(isMobile: boolean): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex: 2800,
    display: "grid",
    placeItems: isMobile ? "end stretch" : "center",
    padding: isMobile ? "12px 0 0" : "24px",
    background: "rgba(214,242,255,0.64)",
    backdropFilter: "blur(10px)",
    animation: "event-content-info-overlay-in 180ms ease-out both",
  };
}

function contentInfoDialogStyle(isMobile: boolean): CSSProperties {
  return {
    width: isMobile ? "100%" : "min(760px, 92vw)",
    maxHeight: isMobile ? "min(88dvh, 760px)" : "86vh",
    overflow: "auto",
    boxSizing: "border-box",
    padding: isMobile ? "18px 16px max(18px, env(safe-area-inset-bottom))" : "22px",
    borderRadius: 0,
    background: "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(232,247,255,0.58))",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 30px 90px rgba(14,116,144,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
    color: "rgba(31,78,121,0.92)",
    backdropFilter: "blur(24px) saturate(140%)",
    animation: "event-content-info-dialog-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
  };
}

const contentInfoHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  marginBottom: "18px",
};

const contentInfoTitleBlockStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const contentInfoKickerStyle: CSSProperties = {
  fontSize: "11px",
  lineHeight: 1,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "rgba(14,165,233,0.82)",
};

const contentInfoTitleStyle: CSSProperties = {
  fontSize: "22px",
  lineHeight: 1.15,
  fontWeight: 850,
  color: "rgba(12,74,110,0.98)",
};

const contentInfoCloseButtonStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  padding: 0,
  borderRadius: "999px",
  border: "1px solid rgba(125,211,252,0.26)",
  background: "rgba(255,255,255,0.6)",
  color: "rgba(31,78,121,0.9)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  boxShadow: "0 12px 28px rgba(14,116,144,0.14)",
  backdropFilter: "blur(14px)",
  transition: "transform 170ms ease, background 170ms ease, border-color 170ms ease, color 170ms ease",
};

const contentInfoBodyStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

const contentInfoSectionStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "16px",
  borderRadius: 0,
  background: "rgba(255,255,255,0.5)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 16px 34px rgba(14,116,144,0.08)",
  backdropFilter: "blur(16px) saturate(130%)",
  animation: "event-content-info-section-in 220ms ease both",
};

const contentInfoSectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const contentInfoSectionIconStyle: CSSProperties = {
  width: "34px",
  height: "34px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  background: "rgba(14,165,233,0.13)",
  border: "1px solid rgba(56,189,248,0.22)",
  color: "rgba(14,165,233,0.94)",
  boxShadow: "0 10px 24px rgba(14,116,144,0.1)",
};

const contentInfoSectionHeadingStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 850,
  color: "rgba(12,74,110,0.96)",
};

function contentInfoGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "10px",
  };
}

function contentInfoRowStyle(isMobile: boolean): CSSProperties {
  return {
    minWidth: 0,
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px",
    borderRadius: 0,
    background: "rgba(232,247,255,0.42)",
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
    backdropFilter: "blur(12px)",
    flexDirection: isMobile ? "column" : "row",
    alignItems: isMobile ? "flex-start" : "center",
  };
}

const contentInfoLabelBlockStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "9px",
  minWidth: 0,
};

const contentInfoRowIconStyle: CSSProperties = {
  width: "28px",
  height: "28px",
  flex: "0 0 auto",
  display: "grid",
  placeItems: "center",
  borderRadius: "999px",
  background: "rgba(56,189,248,0.1)",
  color: "rgba(14,165,233,0.9)",
  fontSize: "12px",
};

const contentInfoLabelStyle: CSSProperties = {
  color: "rgba(70,120,158,0.9)",
  fontSize: "13px",
  fontWeight: 800,
};

function contentInfoValueStyle(isMobile: boolean): CSSProperties {
  return {
    minWidth: 0,
    color: "rgba(12,74,110,0.94)",
    fontSize: "14px",
    fontWeight: 750,
    textAlign: isMobile ? "left" : "right",
    overflowWrap: "anywhere",
  };
}

function contentInfoBrochureCardStyle(hasBrochure: boolean, isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: isMobile ? "flex-start" : "center",
    flexDirection: isMobile ? "column" : "row",
    padding: "14px",
    borderRadius: 0,
    background: hasBrochure
      ? "linear-gradient(135deg, rgba(56,189,248,0.18), rgba(255,255,255,0.48))"
      : "rgba(255,255,255,0.44)",
    border: hasBrochure ? "1px solid rgba(56,189,248,0.26)" : "1px solid rgba(255,255,255,0.1)",
    boxShadow: hasBrochure ? "0 16px 34px rgba(14,116,144,0.12), inset 0 1px 0 rgba(255,255,255,0.08)" : "inset 0 1px 0 rgba(255,255,255,0.05)",
    backdropFilter: "blur(14px)",
  };
}

const contentInfoBrochureMetaStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: "5px",
};

const contentInfoBrochureNameStyle: CSSProperties = {
  minWidth: 0,
  fontSize: "15px",
  fontWeight: 850,
  color: "rgba(12,74,110,0.96)",
  overflowWrap: "anywhere",
};

const contentInfoBrochureMimeStyle: CSSProperties = {
  fontSize: "12px",
  color: "rgba(70,120,158,0.84)",
};

const contentInfoBrochureActionsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  flexWrap: "wrap",
};

const contentInfoActionButtonStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  padding: 0,
  borderRadius: "999px",
  border: "1px solid rgba(56,189,248,0.22)",
  background: "rgba(255,255,255,0.58)",
  color: "rgba(31,78,121,0.92)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  boxShadow: "0 12px 26px rgba(14,116,144,0.12)",
  backdropFilter: "blur(14px) saturate(130%)",
  transition: "transform 170ms ease, background 170ms ease, border-color 170ms ease, color 170ms ease",
};
