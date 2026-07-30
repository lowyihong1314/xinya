import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { CacheMediaPlayer } from "../../components/CacheMediaPlayer";
import { GoogleMapEmbed } from "../../components/GoogleMapEmbed";
import { useEventData } from "../../event/shared/EventDataContext";
import { fetchEventDetail } from "../../event/shared/api";
import type { EventDetailRecord } from "../../event/shared/types";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { PhotoGrid } from "./PhotoGrid";
import { EventCheckInPanel } from "./EventCheckInPanel";
import { EventFlowInline } from "../../CRM/event/react/EventFlowInline";
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

type EventDetailView = "photos" | "checkin" | "info" | "upload" | "flow";

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
  const [viewMode, setViewMode] = useState<EventDetailView>("info");
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
    if (!canEditEvent && viewMode === "upload") {
      setViewMode("photos");
    }
  }, [canUseCheckIn, canEditEvent, viewMode]);

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
            <div id="event-detail-hero-eyebrow" style={heroEyebrowStyle}>活 动 详 情</div>
            <h1 style={heroTitleStyle}>{detail.event_name || `活动 #${detail.id}`}</h1>
            <p style={heroMetaStyle}>
              地南佛学会 · {formatDateRange(detail.datetime, detail.end_datetime)}
            </p>
            {detail.purpose ? <p style={heroBodyStyle}>{detail.purpose}</p> : null}
          </div>
        </section>

        <section id="event-detail-toolbar" style={toolbarStyle(isMobile, isNarrowWidth)}>
          <div id="event-detail-toolbar-nav" style={toolbarGroupStyle(isMobile)}>
            <TabButton
              id="event-detail-toolbar-home"
              label="首页"
              icon="fa-solid fa-house"
              color={TAB_COLORS.home}
              iconOnly={isMobile}
              onClick={() => navigate("/")}
            />
            <TabButton
              id="event-detail-toolbar-prev"
              label="上一个"
              icon="fa-solid fa-chevron-left"
              color={TAB_COLORS.prev}
              iconOnly={isMobile}
              disabled={!detail.prev_event_id}
              onClick={() => detail.prev_event_id && navigate(`/event/${detail.prev_event_id}`)}
            />
            <TabButton
              id="event-detail-toolbar-next"
              label="下一个"
              icon="fa-solid fa-chevron-right"
              color={TAB_COLORS.next}
              iconOnly={isMobile}
              disabled={!detail.next_event_id}
              onClick={() => detail.next_event_id && navigate(`/event/${detail.next_event_id}`)}
            />
            <TabButton
              id="event-detail-toolbar-share"
              label={sharing ? "分享中" : "分享"}
              icon={sharing ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-share-nodes"}
              color={TAB_COLORS.share}
              iconOnly={isMobile}
              disabled={sharing}
              onClick={() => void handleShareEvent()}
            />
          </div>
          <div id="event-detail-toolbar-views" style={toolbarGroupStyle(isMobile)}>
            <TabButton
              id="event-detail-toolbar-content"
              label="内容"
              icon="fa-solid fa-circle-info"
              color={TAB_COLORS.content}
              iconOnly={isMobile}
              active={viewMode === "info"}
              onClick={() => setViewMode("info")}
            />
            <TabButton
              id="event-detail-toolbar-photos"
              label="照片"
              icon="fa-solid fa-images"
              color={TAB_COLORS.photos}
              iconOnly={isMobile}
              active={viewMode === "photos"}
              onClick={() => setViewMode("photos")}
            />
            {canUseCheckIn ? (
              <TabButton
                id="event-detail-toolbar-checkin"
                label="签到"
                icon="fa-solid fa-clipboard-check"
                color={TAB_COLORS.checkin}
                iconOnly={isMobile}
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
              <TabButton
                id="event-detail-toolbar-upload"
                label="上传"
                icon="fa-solid fa-cloud-arrow-up"
                color={TAB_COLORS.upload}
                iconOnly={isMobile}
                active={viewMode === "upload"}
                onClick={() => setViewMode("upload")}
              />
            ) : null}
            {detail.datetime && detail.end_datetime ? (
              <TabButton
                id="event-detail-toolbar-flow"
                label="流程"
                icon="fa-solid fa-timeline"
                color={TAB_COLORS.flow}
                iconOnly={isMobile}
                active={viewMode === "flow"}
                onClick={() => setViewMode("flow")}
              />
            ) : null}
          </div>
        </section>

      <section id="event-detail-content" style={contentWrapStyle(isMobile, viewMode)}>
        {viewMode === "photos" ? (
          <PhotoGrid detail={detail} isMobile={isMobile} mediaNotification={mediaNotification} canEditEvent={canEditEvent} hideHeader />
        ) : viewMode === "checkin" ? (
          <EventCheckInPanel
            detail={detail}
            isMobile={isMobile}
            onChanged={async () => {
              await loadDetail(String(detail.id), { silent: true });
              void refreshEvents();
            }}
          />
        ) : viewMode === "info" ? (
          <EventInfoPanel
            detail={detail}
            isMobile={isMobile}
            onDownloadBrochure={() => void handleDownloadBrochure()}
            onOpenPhotos={() => setViewMode("photos")}
            onOpenSettings={
              isAuthenticated
                ? () => navigate(`/crm/event_table?event_id=${detail.id}&event_tab=settings`)
                : undefined
            }
          />
        ) : viewMode === "upload" ? (
          <UploadMediaModal
            embedded
            eventId={detail.id}
            eventName={detail.event_name}
            onClose={() => setViewMode("photos")}
            onUploaded={async () => {
              await loadDetail(String(detail.id));
              void refreshEvents();
            }}
          />
        ) : viewMode === "flow" ? (
          <EventFlowInline detail={detail} canEdit={canEditEvent} isMobile={isMobile} />
        ) : null}
      </section>
    </div>
  );
}

function formatEventDateTimeRange(detail: EventDetailRecord) {
  const start = detail.datetime;
  if (!start) return "-";
  const norm = (v: string) => v.slice(0, 16).replace("T", " ");
  const startText = norm(start);
  const end = detail.end_datetime;
  if (!end) return startText;
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  const endText = sameDay ? end.slice(11, 16) : norm(end);
  return endText ? `${startText} — ${endText}` : startText;
}

function isVideoFile(fileType?: string | null) {
  return ["mp4", "mov", "mod", "m4v", "avi", "mkv", "webm", "flv", "mts", "m2ts", "3gp", "wmv"].includes(
    String(fileType || "").trim().toLowerCase(),
  );
}

function EventInfoPanel({
  detail,
  isMobile,
  onDownloadBrochure,
  onOpenPhotos,
  onOpenSettings,
}: {
  detail: EventDetailRecord;
  isMobile: boolean;
  onDownloadBrochure: () => void;
  onOpenPhotos: () => void;
  onOpenSettings?: () => void;
}) {
  const photoCount = detail.album_files?.length || 0;
  const checkinCount = detail.check_ins?.length || 0;
  const organizers = (detail.organizers || []).map((user) => user.display_name || user.username || user.id).join("、") || "-";
  const hasBrochure = Boolean(detail.brochure_path);
  const attachments = detail.event_files || [];
  const hasMap = Boolean(detail.place_id || detail.location);
  const timeText = formatEventDateTimeRange(detail);
  const purpose = (detail.purpose || "").trim();

  const mapBlock = hasMap ? (
    <div id="event-detail-content-info-map" style={infoMapWrapStyle}>
      <GoogleMapEmbed
        placeId={detail.place_id}
        lat={detail.lat}
        lng={detail.lng}
        query={detail.location}
        height={isMobile ? 180 : 280}
      />
    </div>
  ) : null;

  // 完整海报（contain 不裁切）
  const posterEl = typeof detail.event_image?.id === "number" ? (
    <div id="event-detail-content-info-poster" style={infoPosterWrapStyle(isMobile)}>
      <CacheMediaPlayer
        id="event-detail-content-info-poster-media"
        fileId={detail.event_image.id}
        fileType={detail.event_image.file_type}
        eventCode={detail.event_code}
        containerStyle={infoPosterMediaContainerStyle}
        style={infoPosterMediaStyle}
        retryAttempts={5}
        retryDelayMs={1200}
      />
    </div>
  ) : null;

  // 照片预览容器：只显示 5 张，点击进入照片 tab
  const previewImages = (detail.album_files || []).filter((file) => !isVideoFile(file.file_type));
  const previewFiles = (previewImages.length ? previewImages : detail.album_files || []).slice(0, 5);
  const previewTileEls = previewFiles.map((file, index) => (
    <div key={file.id} style={isMobile ? photosPreviewTileMobileStyle : photosPreviewTileStyle}>
      <CacheMediaPlayer
        id={`event-detail-content-info-photo-${file.id}`}
        fileId={file.id}
        fileType={file.file_type}
        eventCode={detail.event_code}
        containerStyle={photosPreviewTileMediaContainerStyle}
        style={photosPreviewTileMediaStyle}
        retryAttempts={4}
        retryDelayMs={1200}
      />
      {index === previewFiles.length - 1 && photoCount > previewFiles.length ? (
        <div id="event-detail-photo-preview-overlay" style={photosPreviewMoreOverlayStyle}>
          +{photoCount - previewFiles.length}
        </div>
      ) : null}
    </div>
  ));

  const photosPreviewEl = !photoCount ? null : isMobile ? (
    // 手机：横向小图条 + 全宽实心按钮
    <div id="event-detail-content-info-photos" style={photosPreviewMobileWrapStyle}>
      <div style={photosPreviewMobileGridStyle}>{previewTileEls}</div>
      <button type="button" style={photosViewAllMobileBtnStyle} onClick={onOpenPhotos}>
        <i className="fa-solid fa-images" aria-hidden="true" />
        查看全部照片 · {photoCount} 张
      </button>
    </div>
  ) : (
    // 电脑：卡片区 + 描边胶囊按钮
    <section id="event-detail-content-info-photos" style={contentInfoSectionStyle}>
      <div style={contentInfoSectionHeaderStyle}>
        <div style={contentInfoSectionIconStyle}><i className="fa-solid fa-images" aria-hidden="true" /></div>
        <div style={contentInfoSectionHeadingStyle}>活动照片 · {photoCount} 张</div>
      </div>
      <div style={photosPreviewGridStyle}>{previewTileEls}</div>
      <button type="button" style={photosViewAllBtnStyle} onClick={onOpenPhotos}>
        查看全部照片 →
      </button>
    </section>
  );

  const settingsBtnEl = onOpenSettings ? (
    <button
      id="event-detail-content-info-settings"
      type="button"
      style={isMobile ? infoSettingsMobileBtnStyle : infoSettingsBtnStyle}
      onClick={onOpenSettings}
    >
      <i className="fa-solid fa-gear" aria-hidden="true" />
      活动设置
    </button>
  ) : null;

  // ------- 手机版：极简 -------
  if (isMobile) {
    return (
      <div id="event-detail-content-info-panel" style={infoMobilePanelStyle}>
        {posterEl}
        <div id="event-detail-content-info-mobile-list" style={infoMobileListStyle}>
          <InfoRow id="event-detail-content-info-time-row" icon="fa-solid fa-clock" label="时间" value={timeText} isMobile />
          {detail.location ? (
            <InfoRow id="event-detail-content-info-location-row" icon="fa-solid fa-location-dot" label="地点" value={detail.location} isMobile />
          ) : null}
          <InfoRow id="event-detail-content-info-type-row" icon="fa-solid fa-layer-group" label="类型" value={detail.type || "-"} isMobile />
          <InfoRow id="event-detail-content-info-target-row" icon="fa-solid fa-users" label="对象" value={detail.target || "-"} isMobile />
          <InfoRow id="event-detail-content-info-photos-row" icon="fa-solid fa-images" label="照片" value={`${photoCount} 张`} isMobile />
          <InfoRow id="event-detail-content-info-checkin-row" icon="fa-solid fa-clipboard-check" label="签到" value={`${checkinCount} 人`} isMobile />
        </div>

        {mapBlock}

        {purpose ? <p id="event-detail-content-info-purpose" style={infoPurposeStyle}>{purpose}</p> : null}

        {hasBrochure ? (
          <button
            id="event-detail-content-info-brochure-open"
            type="button"
            style={infoBrochureButtonStyle}
            onClick={() =>
              openBrochurePreviewModal({
                file_name: detail.brochure_name || undefined,
                file_path: detail.brochure_path || "",
                mime_type: detail.brochure_mime || undefined,
              })
            }
          >
            <i className="fa-solid fa-file-lines" aria-hidden="true" />
            查看简章
          </button>
        ) : null}

        {photosPreviewEl}
        {settingsBtnEl}
      </div>
    );
  }

  // ------- 电脑版：完整 -------
  return (
    <div id="event-detail-content-info-panel" style={infoDesktopPanelStyle}>
      <div id="event-detail-content-info-header" style={contentInfoHeaderStyle}>
        <div id="event-detail-content-info-title-block" style={contentInfoTitleBlockStyle}>
          <div id="event-detail-content-info-kicker" style={contentInfoKickerStyle}>活动内容</div>
          <div id="event-detail-content-info-title" style={contentInfoTitleStyle}>{detail.event_name || `活动 #${detail.id}`}</div>
        </div>
      </div>

      {posterEl}

      <div id="event-detail-content-info-columns" style={infoDesktopGridStyle}>
        <div style={infoDesktopColStyle}>
          <section id="event-detail-content-info-summary-section" style={contentInfoSectionStyle}>
            <div style={contentInfoSectionHeaderStyle}>
              <div style={contentInfoSectionIconStyle}><i className="fa-solid fa-list-check" aria-hidden="true" /></div>
              <div style={contentInfoSectionHeadingStyle}>活动信息</div>
            </div>
            <div style={contentInfoGridStyle(false)}>
              <InfoRow id="event-detail-content-info-time-row" icon="fa-solid fa-clock" label="时间" value={timeText} isMobile={false} />
              <InfoRow id="event-detail-content-info-location-row" icon="fa-solid fa-location-dot" label="地点" value={detail.location || "-"} isMobile={false} />
              <InfoRow id="event-detail-content-info-type-row" icon="fa-solid fa-layer-group" label="类型" value={detail.type || "-"} isMobile={false} />
              <InfoRow id="event-detail-content-info-target-row" icon="fa-solid fa-users" label="对象" value={detail.target || "-"} isMobile={false} />
              <InfoRow id="event-detail-content-info-code-row" icon="fa-solid fa-hashtag" label="活动编号" value={detail.event_code || "-"} isMobile={false} />
              <InfoRow id="event-detail-content-info-creator-row" icon="fa-solid fa-user" label="创建者" value={detail.display_name || detail.username || "-"} isMobile={false} />
              <InfoRow id="event-detail-content-info-organizers-row" icon="fa-solid fa-people-group" label="筹备团队" value={organizers} isMobile={false} />
              <InfoRow id="event-detail-content-info-photos-row" icon="fa-solid fa-images" label="活动照片" value={`${photoCount} 张`} isMobile={false} />
              <InfoRow id="event-detail-content-info-checkin-row" icon="fa-solid fa-clipboard-check" label="签到人数" value={`${checkinCount} 人`} isMobile={false} />
            </div>
          </section>

          {purpose ? (
            <section id="event-detail-content-info-purpose-section" style={contentInfoSectionStyle}>
              <div style={contentInfoSectionHeaderStyle}>
                <div style={contentInfoSectionIconStyle}><i className="fa-solid fa-quote-left" aria-hidden="true" /></div>
                <div style={contentInfoSectionHeadingStyle}>简介</div>
              </div>
              <p style={infoPurposeStyle}>{purpose}</p>
            </section>
          ) : null}
        </div>

        <div style={infoDesktopColStyle}>
          {mapBlock ? (
            <section id="event-detail-content-info-map-section" style={contentInfoSectionStyle}>
              <div style={contentInfoSectionHeaderStyle}>
                <div style={contentInfoSectionIconStyle}><i className="fa-solid fa-map-location-dot" aria-hidden="true" /></div>
                <div style={contentInfoSectionHeadingStyle}>{detail.location || "活动地点"}</div>
              </div>
              {mapBlock}
            </section>
          ) : null}

          <section id="event-detail-content-info-brochure-section" style={contentInfoSectionStyle}>
            <div style={contentInfoSectionHeaderStyle}>
              <div style={contentInfoSectionIconStyle}><i className="fa-solid fa-file-lines" aria-hidden="true" /></div>
              <div style={contentInfoSectionHeadingStyle}>简章</div>
            </div>
            <div style={contentInfoBrochureCardStyle(hasBrochure, false)}>
              <div style={contentInfoBrochureMetaStyle}>
                <div style={contentInfoBrochureNameStyle}>{detail.brochure_name || (hasBrochure ? "活动文件" : "未上传简章")}</div>
                <div style={contentInfoBrochureMimeStyle}>{hasBrochure ? detail.brochure_mime || "可以预览或下载" : "暂无简章文件"}</div>
              </div>
              {hasBrochure ? (
                <div style={contentInfoBrochureActionsStyle}>
                  <button
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
                  <button type="button" aria-label="下载简章" title="下载简章" style={contentInfoActionButtonStyle} onClick={onDownloadBrochure}>
                    <i className="fa-solid fa-download" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          {attachments.length ? (
            <section id="event-detail-content-info-attachments-section" style={contentInfoSectionStyle}>
              <div style={contentInfoSectionHeaderStyle}>
                <div style={contentInfoSectionIconStyle}><i className="fa-solid fa-paperclip" aria-hidden="true" /></div>
                <div style={contentInfoSectionHeadingStyle}>附件 · {attachments.length}</div>
              </div>
              <div style={infoAttachmentListStyle}>
                {attachments.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    style={infoAttachmentRowStyle}
                    title={file.file_name || "附件"}
                    onClick={() =>
                      openBrochurePreviewModal({
                        file_name: file.file_name || undefined,
                        file_path: file.file_path || "",
                        mime_type: file.mime_type || undefined,
                      })
                    }
                  >
                    <i className="fa-solid fa-file" aria-hidden="true" style={{ color: "var(--x-color-accent)" }} />
                    <span style={infoAttachmentNameStyle}>{file.file_name || "附件"}</span>
                    <i className="fa-solid fa-eye" aria-hidden="true" style={{ color: "var(--x-color-ink-muted)" }} />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {photosPreviewEl}
      {settingsBtnEl}
    </div>
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

function TabButton({
  id,
  label,
  icon,
  color,
  iconOnly = false,
  active = false,
  disabled = false,
  onClick,
}: {
  id: string;
  label: string;
  icon: string;
  color: string;
  iconOnly?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      aria-label={label}
      title={label}
      style={tabButtonStyle(color, active, disabled, iconOnly)}
      disabled={disabled}
      onClick={onClick}
    >
      <i className={icon} aria-hidden="true" style={tabIconStyle} />
      {iconOnly ? null : <span style={tabLabelStyle}>{label}</span>}
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

function heroStyle(_hasCover: boolean, _isMobile: boolean): CSSProperties {
  return {
    height: "80vh",
    minHeight: "80vh",
    position: "relative",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    // 冷色兜底（有海报时被照片覆盖）
    background:
      "linear-gradient(160deg, rgba(240,249,255,0.98), rgba(217,243,239,0.9), rgba(238,243,249,0.94))",
  };
}

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
  objectPosition: "center 25%",
  display: "block",
};

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  background: "linear-gradient(180deg, #eef3f9, #f8fcff)",
  paddingBottom: "40px",
};

function heroOverlayStyle(hovered: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    // 全透明，仅保留模糊
    background: "transparent",
    backdropFilter: `blur(${hovered ? 0.5 : 3}px)`,
    zIndex: 1,
  };
}

const heroContentStyle: CSSProperties = {
  position: "relative",
  zIndex: 2,
  maxWidth: "760px",
  margin: "0 24px",
  padding: "32px 36px",
  textAlign: "center",
  display: "grid",
  gap: "14px",
  color: "var(--x-color-ink)",
  background: "rgba(255,255,255,0.55)",
  borderRadius: "var(--x-radius-lg)",
  border: "1px solid rgba(255,255,255,0.6)",
  boxShadow: "0 16px 40px var(--x-color-shadow-soft)",
  backdropFilter: "blur(8px)",
};

const heroEyebrowStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "13px",
  letterSpacing: "0.32em",
  textIndent: "0.32em",
  color: "var(--x-color-accent-strong)",
};

const heroTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--x-font-serif)",
  fontWeight: 500,
  fontSize: "clamp(28px, 5vw, 46px)",
  lineHeight: 1.28,
  letterSpacing: "0.04em",
  color: "var(--x-color-ink)",
};

const heroMetaStyle: CSSProperties = {
  margin: 0,
  fontSize: "15px",
  letterSpacing: "0.02em",
  color: "var(--x-color-ink-muted)",
};

const heroBodyStyle: CSSProperties = {
  margin: "4px auto 0",
  maxWidth: "58ch",
  fontSize: "14.5px",
  lineHeight: 1.8,
  color: "var(--x-color-ink-muted)",
  whiteSpace: "pre-line",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const TAB_TOOLBAR_HEIGHT = 46;

const TAB_COLORS = {
  home: "#e7e0d3",
  prev: "#d8e6de",
  next: "#e2dced",
  content: "#f0e3d2",
  share: "#d7e5ef",
  photos: "#ecdcd6",
  checkin: "#dde8d6",
  upload: "#f1dede",
  flow: "#dcd9ee",
} as const;

function toolbarStyle(isMobile: boolean, _isNarrowWidth: boolean): CSSProperties {
  // 书签风格：section 全透明，向上覆盖自身高度压在 hero 底部
  // 手机：两行 Tab，每行铺满宽度；电脑：单行
  const height = isMobile ? 88 : TAB_TOOLBAR_HEIGHT;
  return {
    position: "relative",
    zIndex: 5,
    width: "100%",
    height: `${height}px`,
    marginTop: `-${height}px`,
    boxSizing: "border-box",
    padding: isMobile ? "0" : "0 8px 0 12px",
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    justifyContent: isMobile ? "flex-end" : "flex-start",
    alignItems: isMobile ? "stretch" : "flex-end",
    gap: isMobile ? "0" : "3px",
    flexWrap: "nowrap",
    overflowX: isMobile ? "hidden" : "auto",
    background: "transparent",
  };
}

function toolbarGroupStyle(isMobile: boolean): CSSProperties {
  if (!isMobile) {
    // 电脑：不生成额外盒子，子按钮直接参与单行排列
    return { display: "contents" };
  }
  // 手机：一行铺满，每个 tab 等宽、无间隙
  return {
    flex: 1,
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    gap: "0",
    width: "100%",
  };
}

function tabButtonStyle(color: string, active: boolean, disabled: boolean, iconOnly = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    // 手机：每个 tab 等宽铺满、撑满整行高度
    flex: iconOnly ? "1 1 0" : undefined,
    minWidth: iconOnly ? 0 : undefined,
    height: iconOnly ? "100%" : undefined,
    gap: iconOnly ? 0 : "7px",
    padding: iconOnly ? "0" : active ? "9px 16px" : "8px 14px",
    borderTopLeftRadius: iconOnly ? 0 : "10px",
    borderTopRightRadius: iconOnly ? 0 : "10px",
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTop: active ? "3px solid var(--x-color-accent)" : "3px solid transparent",
    borderLeft: "none",
    borderRight: "none",
    borderBottom: "none",
    background: color,
    color: "var(--x-color-ink)",
    fontSize: "14px",
    fontWeight: active ? 600 : 500,
    whiteSpace: "nowrap",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    boxShadow: active
      ? "0 -6px 16px var(--x-color-shadow)"
      : "0 -3px 8px var(--x-color-shadow-soft)",
    transition: "opacity 160ms ease, padding 160ms ease, transform 160ms ease",
  };
}

const tabIconStyle: CSSProperties = {
  fontSize: "15px",
  lineHeight: 1,
  pointerEvents: "none",
};

const tabLabelStyle: CSSProperties = {
  lineHeight: 1,
  pointerEvents: "none",
};

const eventDetailToolbarInteractionStyle = `
#event-detail-toolbar button:not(:disabled):hover {
  opacity: 1;
  transform: translateY(-2px);
}

#event-detail-toolbar button:focus-visible {
  outline: 2px solid var(--x-color-accent-border);
  outline-offset: -2px;
}
`;

function contentWrapStyle(_isMobile: boolean, _view: EventDetailView): CSSProperties {
  // 内容区铺满左右，无 padding / margin；书签 Tab 底部紧贴此面板
  return {
    width: "100%",
    minHeight: "1080px",
    boxSizing: "border-box",
    margin: 0,
    padding: 0,
    background: "var(--x-color-panel)",
  };
}

const placeholderStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  display: "grid",
  placeItems: "center",
  background: "linear-gradient(180deg, #eef3f9, #f8fcff)",
  color: "var(--x-color-ink-muted)",
};

const errorStyle: CSSProperties = {
  ...placeholderStyle,
  color: "var(--x-color-danger)",
};

const contentInfoPanelStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
  width: "100%",
  boxSizing: "border-box",
};

const infoMobilePanelStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  width: "100%",
  boxSizing: "border-box",
  padding: "16px 14px",
};

const infoMobileListStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const infoDesktopPanelStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  width: "100%",
  boxSizing: "border-box",
  maxWidth: "1180px",
  margin: "0 auto",
  padding: "28px 24px",
};

const infoDesktopGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
  gap: "18px",
  alignItems: "start",
};

const infoDesktopColStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  alignContent: "start",
  minWidth: 0,
};

const infoMapWrapStyle: CSSProperties = {
  width: "100%",
};

const infoPurposeStyle: CSSProperties = {
  margin: 0,
  fontSize: "14.5px",
  lineHeight: 1.8,
  color: "var(--x-color-ink-muted)",
  whiteSpace: "pre-wrap",
};

const infoBrochureButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  width: "100%",
  padding: "12px 16px",
  borderRadius: "var(--x-radius-md)",
  border: "none",
  background: "var(--x-color-accent)",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
};

const infoAttachmentListStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const infoAttachmentRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  width: "100%",
  padding: "10px 12px",
  borderRadius: "var(--x-radius-sm)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  cursor: "pointer",
  textAlign: "left",
};

const infoAttachmentNameStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: "13.5px",
  color: "var(--x-color-ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// —— 完整海报 ——
function infoPosterWrapStyle(isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    width: "100%",
    height: isMobile ? "300px" : "460px",
    borderRadius: "var(--x-radius-md)",
    overflow: "hidden",
    background: "var(--x-color-canvas-alt)",
    border: "1px solid var(--x-color-line)",
  };
}

const infoPosterMediaContainerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
};

const infoPosterMediaStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
};

// —— 照片预览容器（5 张，点击进入照片 tab）——
const photosPreviewCardStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  padding: "16px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
  cursor: "pointer",
};

const photosPreviewHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "12px",
};

const photosPreviewTitleStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "15px",
  fontWeight: 500,
  color: "var(--x-color-ink)",
};

const photosPreviewLinkStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--x-color-accent-strong)",
};

const photosPreviewGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: "8px",
};

const photosPreviewTileStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  borderRadius: "var(--x-radius-sm)",
  overflow: "hidden",
  background: "var(--x-color-canvas-alt)",
};

const photosPreviewTileMediaContainerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
};

const photosPreviewTileMediaStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "center 25%",
  display: "block",
};

const photosPreviewMoreOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "rgba(17, 94, 89, 0.62)",
  color: "#ffffff",
  fontSize: "18px",
  fontWeight: 700,
  letterSpacing: "0.02em",
};

// 电脑「查看全部」描边胶囊按钮
const photosViewAllBtnStyle: CSSProperties = {
  justifySelf: "start",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "9px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontSize: "13.5px",
  fontWeight: 600,
  cursor: "pointer",
};

// 活动设置按钮（登陆可见）
const infoSettingsBtnStyle: CSSProperties = {
  justifySelf: "start",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 20px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

const infoSettingsMobileBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  width: "100%",
  padding: "12px 16px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
};

// 手机照片预览
const photosPreviewMobileWrapStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const photosPreviewMobileGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: "3px",
};

const photosPreviewTileMobileStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  overflow: "hidden",
  background: "var(--x-color-canvas-alt)",
};

const photosViewAllMobileBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  width: "100%",
  padding: "13px 16px",
  borderRadius: "var(--x-radius-md)",
  border: "none",
  background: "var(--x-color-accent)",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
};

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
  fontSize: "12px",
  lineHeight: 1,
  letterSpacing: "0.22em",
  color: "var(--x-color-accent-strong)",
};

const contentInfoTitleStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "22px",
  lineHeight: 1.15,
  fontWeight: 500,
  color: "var(--x-color-ink)",
};

const contentInfoBodyStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

const contentInfoSectionStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "16px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 10px 24px var(--x-color-shadow-soft)",
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
  background: "var(--x-color-accent-soft)",
  border: "1px solid var(--x-color-accent-border)",
  color: "var(--x-color-accent-strong)",
};

const contentInfoSectionHeadingStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "15px",
  fontWeight: 500,
  color: "var(--x-color-ink)",
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
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
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
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontSize: "12px",
};

const contentInfoLabelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  fontWeight: 600,
};

function contentInfoValueStyle(isMobile: boolean): CSSProperties {
  return {
    minWidth: 0,
    color: "var(--x-color-ink)",
    fontSize: "14px",
    fontWeight: 600,
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
    borderRadius: "var(--x-radius-md)",
    background: hasBrochure ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    border: hasBrochure ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line)",
    boxShadow: hasBrochure ? "0 12px 26px var(--x-color-shadow-soft)" : "none",
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
  fontWeight: 600,
  color: "var(--x-color-ink)",
  overflowWrap: "anywhere",
};

const contentInfoBrochureMimeStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
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
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-accent-strong)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  boxShadow: "0 8px 18px var(--x-color-shadow-soft)",
  transition: "transform 170ms ease, background 170ms ease, border-color 170ms ease, color 170ms ease",
};
