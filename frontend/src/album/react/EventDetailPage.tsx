import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
import { hasUserPermission } from "../../app/permissions";
import {
  connectEventMediaRoom,
  MEDIA_ROOM_UPDATE_EVENT,
  type MediaNotification,
} from "./mediaRealtime";
import { openBrochurePreviewModal } from "../../event/shared/brochurePreview";

export function EventDetailPage() {
  useEnsureDesignTokens();

  const { eventId } = useParams();
  const navigate = useNavigate();
  const { getEventById, refreshEvents } = useEventData();
  const { isMobile, user } = useUserState();
  const [detail, setDetail] = useState<EventDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroHovered, setHeroHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showFlow, setShowFlow] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [viewMode, setViewMode] = useState<"photos" | "checkin">("photos");
  const [mediaNotification, setMediaNotification] = useState<MediaNotification | null>(null);
  const detailRef = useRef<EventDetailRecord | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const canEditEvent = hasUserPermission(user, "event_edit");

  useEffect(() => {
    if (!canEditEvent && viewMode === "checkin") {
      setViewMode("photos");
    }
  }, [canEditEvent, viewMode]);

  useEffect(() => {
    detailRef.current = detail;
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

  if (!eventId) {
    return <div style={placeholderStyle}>缺少 event_id</div>;
  }

  if (loading) {
    return <div style={placeholderStyle}>读取活动详情中…</div>;
  }

  if (error || !detail) {
    return <div style={errorStyle}>{error || "活动不存在"}</div>;
  }

  return (
    <div style={pageStyle}>
      <section
        style={heroStyle(Boolean(detail.event_image?.id), isMobile)}
        onMouseEnter={() => !isMobile && setHeroHovered(true)}
        onMouseLeave={() => !isMobile && setHeroHovered(false)}
        onTouchStart={() => setHeroHovered(true)}
        onTouchEnd={() => setHeroHovered(false)}
        onTouchCancel={() => setHeroHovered(false)}
      >
        {detail.event_image?.id ? (
          <div style={heroMediaLayerStyle}>
            <CacheMediaPlayer
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
        <div style={heroOverlayStyle(heroHovered)} />
        <div style={heroContentStyle}>
          <div style={heroEyebrowStyle}>Event Detail</div>
          <h1 style={heroTitleStyle}>{detail.event_name || `活动 #${detail.id}`}</h1>
          <p style={heroMetaStyle}>
            {detail.location || "地南佛学会"} · {formatDateRange(detail.datetime, detail.end_datetime)}
          </p>
          {detail.purpose ? <p style={heroBodyStyle}>{detail.purpose}</p> : null}
        </div>
      </section>

      <section style={toolbarStyle(isMobile)}>
        <button type="button" style={secondaryButtonStyle} onClick={() => navigate("/")}>
          返回首页
        </button>
        <div style={toolbarGroupStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={!detail.prev_event_id}
            onClick={() => {
              if (detail.prev_event_id) {
                navigate(`/event/${detail.prev_event_id}`);
              }
            }}
          >
            上一个
          </button>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={!detail.next_event_id}
            onClick={() => {
              if (detail.next_event_id) {
                navigate(`/event/${detail.next_event_id}`);
              }
            }}
          >
            下一个
          </button>
        </div>
        <div style={toolbarGroupStyle}>
          <>
            <button
              type="button"
              style={viewMode === "photos" ? primaryButtonStyle : secondaryButtonStyle}
              onClick={() => setViewMode("photos")}
            >
              照片
            </button>
            {canEditEvent ? (
              <button
                type="button"
                style={viewMode === "checkin" ? primaryButtonStyle : secondaryButtonStyle}
                onClick={() => setViewMode("checkin")}
              >
                签到
              </button>
            ) : null}
            {canEditEvent ? (
              <button type="button" style={primaryButtonStyle} onClick={() => setEditing(true)}>
                编辑活动资料
              </button>
            ) : null}
            {canEditEvent ? (
              <button type="button" style={secondaryButtonStyle} onClick={() => setShowUpload(true)}>
                上传照片 / 视频
              </button>
            ) : null}
            {detail.datetime && detail.end_datetime ? (
              <button type="button" style={secondaryButtonStyle} onClick={() => setShowFlow(true)}>
                活动流程
              </button>
            ) : null}
          </>
        </div>
      </section>

      <section style={contentWrapStyle(isMobile)}>
        <div style={metaPanelStyle(isMobile)}>
          <div style={metaGridStyle(isMobile)}>
          <div style={metaRowStyle(isMobile)}>
            <span style={metaLabelStyle}>创建者</span>
            <span style={metaValueStyle}>{detail.display_name || detail.username || "-"}</span>
          </div>
          <div style={metaRowStyle(isMobile)}>
            <span style={metaLabelStyle}>类型</span>
            <span style={metaValueStyle}>{detail.type || "-"}</span>
          </div>
          <div style={metaRowStyle(isMobile)}>
            <span style={metaLabelStyle}>对象</span>
            <span style={metaValueStyle}>{detail.target || "-"}</span>
          </div>
          <div style={metaRowStyle(isMobile)}>
            <span style={metaLabelStyle}>筹备团队</span>
            <span style={metaValueStyle}>
              {(detail.organizers || []).map((user) => user.display_name || user.username || user.id).join(", ") || "-"}
            </span>
          </div>
          </div>
        </div>

        {detail.brochure_path ? (
          <div style={metaPanelStyle(isMobile)}>
            <div style={panelHeaderStyle}>
              <div style={panelTitleStyle}>简章</div>
            </div>
            <div style={brochureCardStyle}>
              <div style={brochureMetaStyle}>
                <div style={brochureNameStyle}>{detail.brochure_name || "活动文件"}</div>
                <div style={brochureMimeStyle}>{detail.brochure_mime || "点击预览或下载"}</div>
              </div>
              <div style={brochureActionRowStyle}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() =>
                    openBrochurePreviewModal({
                      file_name: detail.brochure_name || undefined,
                      file_path: detail.brochure_path || "",
                      mime_type: detail.brochure_mime || undefined,
                    })
                  }
                >
                  预览
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={() => window.open(`/media_file/${detail.brochure_path}`, "_blank", "noopener,noreferrer")}
                >
                  下载
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {viewMode === "photos" ? (
          <PhotoGrid detail={detail} isMobile={isMobile} mediaNotification={mediaNotification} canEditEvent={canEditEvent} />
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
    </div>
  );
}

function formatDateRange(start?: string, end?: string) {
  if (!start) return "-";
  const startDate = start.slice(0, 10);
  const endDate = end?.slice(0, 10);
  return endDate && endDate !== startDate ? `${startDate} - ${endDate}` : startDate;
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
  background: "linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
  paddingBottom: "32px",
};

function heroOverlayStyle(hovered: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(to bottom, rgba(0,0,0,0.18), rgba(0,0,0,0.48))",
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
  color: "white",
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

function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: "1400px",
    margin: "24px auto 0",
    padding: isMobile ? "0 14px" : "0 20px",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    alignItems: isMobile ? "stretch" : "center",
    flexDirection: isMobile ? "column" : "row",
  };
}

const toolbarGroupStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
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

function contentWrapStyle(isMobile: boolean): CSSProperties {
  return {
    maxWidth: "1400px",
    margin: "20px auto 0",
    padding: isMobile ? "0 14px" : "0 20px",
    display: "grid",
    gap: "20px",
  };
}

function metaPanelStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "18px" : "20px",
    borderRadius: "var(--x-radius-lg)",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  };
}

function metaGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: isMobile ? "0" : "0 20px",
  };
}

function metaRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    padding: "10px 0",
    borderBottom: "1px solid var(--x-color-line-soft)",
    flexDirection: isMobile ? "column" : "row",
    alignItems: isMobile ? "flex-start" : "center",
  };
}

const metaLabelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};

const metaValueStyle: CSSProperties = {
  color: "var(--x-color-ink)",
  textAlign: "right",
};

const panelTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  marginBottom: "14px",
  flexWrap: "wrap",
};

const brochureCardStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  alignItems: "center",
  flexWrap: "wrap",
  padding: "16px 18px",
  borderRadius: "16px",
  border: "1px solid var(--x-color-line-soft)",
  background: "linear-gradient(180deg, var(--x-color-panel), var(--x-color-panel-alt))",
};

const brochureMetaStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const brochureNameStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
  wordBreak: "break-word",
};

const brochureMimeStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const brochureActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  alignItems: "center",
};

const placeholderStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
};

const errorStyle: CSSProperties = {
  ...placeholderStyle,
  color: "var(--x-color-danger)",
};
