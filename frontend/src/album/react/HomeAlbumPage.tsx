import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { CacheMediaPlayer } from "../../components/CacheMediaPlayer";
import { PageHero } from "../../components/PageHero";
import { smartImageURL } from "../../js/get_img";
import { useEventData } from "../../event/shared/EventDataContext";
import { fetchEventDetail } from "../../event/shared/api";
import type { AlbumFile, SharedEventRecord } from "../../event/shared/types";
import { ensureDesignTokens } from "../../theme/designTokens";
import { useUserState } from "../../app/UserState";

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function HomeAlbumPage() {
  ensureDesignTokens();

  const { getEventsForMonth, loading, error, refreshEvents } = useEventData();
  const { isMobile } = useUserState();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const monthEvents = useMemo(() => getEventsForMonth(year, month), [getEventsForMonth, year, month]);
  const eventMap = useMemo(() => buildEventMap(monthEvents, year, month), [monthEvents, year, month]);
  const calendar_data = useMemo(() => buildCalendarData(year, month, eventMap), [year, month, eventMap]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    const initial = pickInitialDate(eventMap, year, month);
    setSelectedDate(initial);
  }, [eventMap, year, month]);

  const selectedEvents = selectedDate ? eventMap[selectedDate] || [] : [];
  function changeMonth(delta: number) {
    const base = new Date(year, month - 1 + delta, 1);
    setYear(base.getFullYear());
    setMonth(base.getMonth() + 1);
  }

  return (
    <div style={pageStyle}>
      <PageHero title="地南佛学会" subtitle="Album Calendar" />

      <section style={toolbarStyle(isMobile)}>
        <div style={monthNavStyle}>
          <button type="button" style={monthButtonStyle} onClick={() => changeMonth(-1)}>
            ◀
          </button>
          <div style={monthLabelStyle}>
            {year} / {String(month).padStart(2, "0")}
          </div>
          <button type="button" style={monthButtonStyle} onClick={() => changeMonth(1)}>
            ▶
          </button>
        </div>
        <button type="button" style={secondaryButtonStyle} onClick={() => void refreshEvents()}>
          刷新活动
        </button>
      </section>

      {error ? <div style={errorBannerStyle}>{error}</div> : null}
      {loading ? <div style={placeholderStyle}>读取活动中…</div> : null}

      <div style={mobileSummaryStyle(isMobile)}>
        <div style={mobileSummaryValueStyle}>{monthEvents.length}</div>
        <div style={mobileSummaryLabelStyle}>本月活动</div>
        <div style={mobileSummaryDividerStyle} />
        <div style={mobileSummaryValueStyle}>{selectedEvents.length}</div>
        <div style={mobileSummaryLabelStyle}>当天活动</div>
      </div>

      <div style={layoutStyle(isMobile)}>
        <section style={calendarStyle(isMobile)}>
          {isMobile
            ? renderMobileCalendarCards(calendar_data, selectedDate, setSelectedDate)
            : (
              <>
                {["日", "一", "二", "三", "四", "五", "六"].map((name) => (
                  <div key={name} style={weekHeaderStyle}>
                    {name}
                  </div>
                ))}
                {renderCalendarCells(calendar_data, selectedDate, setSelectedDate, isMobile)}
              </>
            )}
        </section>

        <aside style={detailPanelStyle(isMobile)}>
          <div style={detailHeaderStyle}>
            <div>
              <div style={detailEyebrowStyle}>Selected Date</div>
              <h2 style={detailTitleStyle}>{selectedDate || "未选择日期"}</h2>
            </div>
          </div>
          {!selectedEvents.length ? <div style={placeholderStyle}>这个日期没有活动</div> : null}
          {selectedEvents.length ? (
            <div style={eventListStyle}>
              {selectedEvents.map((event) => (
                <EventPreviewCard key={event.id} event={event} isMobile={isMobile} />
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function EventPreviewCard({ event, isMobile }: { event: SharedEventRecord; isMobile: boolean }) {
  const [coverMedia, setCoverMedia] = useState<{ id: number; fileType?: string | null } | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadCardImages() {
      let nextCover: { id: number; fileType?: string | null } | null = null;

      if (event.event_image?.id) {
        nextCover = {
          id: event.event_image.id,
          fileType: event.event_image.file_type,
        };
      }

      const payload = await fetchEventDetail(event.id).catch(() => null);
      const files = Array.isArray(payload?.data?.album_files) ? (payload.data.album_files as AlbumFile[]) : [];
      const previewFiles = files
        .filter((file) => typeof file.id === "number" && file.id !== event.event_image?.id)
        .sort(
          (left, right) =>
            new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime(),
        )
        .slice(0, 3);

      if (!nextCover && previewFiles[0]?.id) {
        nextCover = {
          id: previewFiles[0].id,
          fileType: previewFiles[0].file_type,
        };
      }

      const nextPreviewUrls = (
        await Promise.all(
          previewFiles.map(async (file) => {
            if (["mp4", "mov"].includes(String(file.file_type || "").toLowerCase())) {
              return null;
            }
            const url = await smartImageURL(file.id, "cache").catch(() => null);
            return url && url !== "/static/images/file_icon/broken-image.png" ? url : null;
          }),
        )
      ).filter((url): url is string => Boolean(url));

      if (!cancelled) {
        setCoverMedia(nextCover);
        setPreviewUrls(nextPreviewUrls);
      }
    }

    void loadCardImages();

    return () => {
      cancelled = true;
    };
  }, [event.id, event.event_image?.id]);

  return (
    <button
      type="button"
      style={eventCardStyle(isMobile)}
      onClick={() => {
        window.location.hash = `#/event/${event.id}`;
      }}
    >
      <div style={eventCardMediaWrapStyle(isMobile)}>
        <div style={eventCardHeroStyle}>
          {coverMedia ? (
            <CacheMediaPlayer
              fileId={coverMedia.id}
              fileType={coverMedia.fileType}
              style={eventCardHeroImageStyle}
              containerStyle={eventCardHeroContainerStyle}
              retryAttempts={6}
              retryDelayMs={1500}
            />
          ) : null}
          {!coverMedia ? <div style={eventCardImageFallbackStyle}>MAIN</div> : null}
        </div>
        <div style={eventCardPreviewGridStyle}>
          {[0, 1, 2].map((index) => {
            const src = previewUrls[index];
            return src ? (
              <img key={`${event.id}-${index}`} src={src} alt="" style={eventCardPreviewImageStyle} />
            ) : (
              <div key={`${event.id}-${index}`} style={eventCardPreviewFallbackStyle} />
            );
          })}
        </div>
      </div>
      <div style={eventCardTitleStyle}>{event.event_name || `活动 #${event.id}`}</div>
      <div style={eventCardMetaStyle}>
        {event.datetime || "-"} · {event.location || "-"}
      </div>
      <div style={eventCardMetaStyle}>
        {event.type || "-"} · {event.target || "-"}
      </div>
    </button>
  );
}

function renderCalendarCells(
  calendar_data: CalendarCellData[],
  selectedDate: string | null,
  setSelectedDate: (value: string) => void,
  isMobile: boolean,
) {
  return calendar_data.map((cell, index) => {
    if (!cell.dateKey) {
      return <div key={index} style={emptyDayStyle} />;
    }

    const active = selectedDate === cell.dateKey;
    return (
      <button
        key={index}
        type="button"
        style={dayCardStyle(active, cell.items.length > 0, isMobile)}
        onClick={() => setSelectedDate(cell.dateKey)}
      >
        <div style={dayNumberStyle}>{cell.dayLabel}</div>
        {cell.items.slice(0, 3).map((event) => (
          <div key={event.id} style={dayEventStyle}>
            {event.event_name}
          </div>
        ))}
        {cell.items.length > 3 ? <div style={dayMoreStyle}>+{cell.items.length - 3}</div> : null}
      </button>
    );
  });
}

function renderMobileCalendarCards(
  calendar_data: CalendarCellData[],
  selectedDate: string | null,
  setSelectedDate: (value: string) => void,
) {
  return calendar_data
    .filter((cell) => cell.dateKey && cell.items.length > 0)
    .map((cell, index) => (
      <button
        key={index}
        type="button"
        style={mobileDayCardStyle(selectedDate === cell.dateKey)}
        onClick={() => setSelectedDate(cell.dateKey!)}
      >
        <div style={mobileDayHeaderStyle}>
          <div style={mobileDayDateStyle}>{cell.dateKey}</div>
          <div style={mobileDayCountStyle}>{cell.items.length} 个活动</div>
        </div>
        <div style={mobileDayEventListStyle}>
          {cell.items.slice(0, 3).map((event) => (
            <div key={event.id} style={dayEventStyle}>
              {event.event_name}
            </div>
          ))}
          {cell.items.length > 3 ? <div style={dayMoreStyle}>+{cell.items.length - 3}</div> : null}
        </div>
      </button>
    ));
}

type CalendarCellData = {
  dateKey: string | null;
  dayLabel: number | null;
  items: SharedEventRecord[];
};

function buildCalendarData(
  year: number,
  month: number,
  eventMap: Record<string, SharedEventRecord[]>,
): CalendarCellData[] {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: CalendarCellData[] = Array.from({ length: 42 }, () => ({
    dateKey: null,
    dayLabel: null,
    items: [],
  }));

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellIndex = firstDay + day - 1;
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells[cellIndex] = {
      dateKey,
      dayLabel: day,
      items: eventMap[dateKey] || [],
    };
  }

  return cells;
}

function buildEventMap(events: ReturnType<typeof useEventData>["events"], year: number, month: number) {
  const map: Record<string, ReturnType<typeof useEventData>["events"]> = {};

  events.forEach((event) => {
    if (!event.datetime) {
      return;
    }

    const start = new Date(event.datetime);
    const end = event.end_datetime ? new Date(event.end_datetime) : new Date(event.datetime);
    const cursor = new Date(start);

    while (cursor <= end) {
      if (cursor.getFullYear() === year && cursor.getMonth() + 1 === month) {
        const key = formatDateKey(cursor);
        map[key] ||= [];
        map[key].push(event);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return map;
}

function pickInitialDate(
  eventMap: Record<string, ReturnType<typeof useEventData>["events"]>,
  year: number,
  month: number,
) {
  const today = new Date();
  const todayKey = `${year}-${String(month).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  if (eventMap[todayKey]?.length) {
    return todayKey;
  }

  const future = Object.keys(eventMap)
    .filter((key) => key >= todayKey)
    .sort()[0];

  return future || Object.keys(eventMap).sort()[0] || null;
}

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  paddingBottom: "32px",
  background:
    "radial-gradient(circle at top left, var(--x-color-warning-tint), transparent 22%), radial-gradient(circle at top right, var(--x-color-info-tint-strong), transparent 28%), linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
};

function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: isMobile ? "stretch" : "center",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    maxWidth: "1400px",
    margin: "24px auto 0",
    padding: isMobile ? "0 14px" : "0 20px",
  };
}

const monthNavStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "14px 20px",
  borderRadius: "18px",
  background: "linear-gradient(135deg, var(--x-color-warning), var(--x-color-danger))",
  boxShadow: "0 14px 30px var(--x-color-shadow-medium)",
};

const monthButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "12px",
  border: "none",
  background: "var(--x-color-panel)",
  color: "var(--x-color-danger)",
  cursor: "pointer",
  fontWeight: 700,
};

const monthLabelStyle: CSSProperties = {
  minWidth: "110px",
  textAlign: "center",
  color: "white",
  fontWeight: 700,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 700,
};

const errorBannerStyle: CSSProperties = {
  maxWidth: "1400px",
  margin: "16px auto 0",
  padding: "14px 16px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};

function mobileSummaryStyle(isMobile: boolean): CSSProperties {
  return {
    display: isMobile ? "grid" : "none",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: "10px",
    maxWidth: "1400px",
    margin: "16px auto 0",
    padding: "14px 18px",
    borderRadius: "20px",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 14px 30px var(--x-color-shadow-soft)",
  };
}

function layoutStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.5fr) minmax(340px, 0.8fr)",
    gap: "20px",
    maxWidth: "1400px",
    margin: "20px auto 0",
    padding: isMobile ? "0 14px" : "0 20px",
    alignItems: "start",
  };
}

function calendarStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(7, minmax(0, 1fr))",
    gap: isMobile ? "6px" : "10px",
  };
}

const weekHeaderStyle: CSSProperties = {
  textAlign: "center",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
  padding: "8px 0",
};

const emptyDayStyle: CSSProperties = {
  minHeight: "82px",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
};

function dayCardStyle(active: boolean, hasEvent: boolean, isMobile: boolean): CSSProperties {
  return {
    minHeight: isMobile ? "78px" : "92px",
    padding: isMobile ? "8px" : "10px",
    borderRadius: "14px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid transparent",
    background: hasEvent
      ? "linear-gradient(135deg, var(--x-color-warning-tint), var(--x-color-info-soft))"
      : "var(--x-color-panel-alt)",
    boxShadow: hasEvent ? "0 8px 20px var(--x-color-shadow-soft)" : "none",
    textAlign: "left",
    cursor: "pointer",
  };
}

const dayNumberStyle: CSSProperties = {
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

const mobileSummaryValueStyle: CSSProperties = {
  fontSize: "26px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
  textAlign: "center",
};

const mobileSummaryLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

const mobileSummaryDividerStyle: CSSProperties = {
  width: "1px",
  height: "100%",
  background: "var(--x-color-line-soft)",
};

const dayEventStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "12px",
  lineHeight: 1.35,
  color: "var(--x-color-ink)",
};

const dayMoreStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};

function mobileDayCardStyle(active: boolean): CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: "16px",
    border: active ? "1px solid var(--x-color-accent-border)" : "1px solid var(--x-color-line-soft)",
    background: active
      ? "linear-gradient(135deg, var(--x-color-warning-tint), var(--x-color-info-soft))"
      : "var(--x-color-panel)",
    boxShadow: "0 10px 24px var(--x-color-shadow-soft)",
    textAlign: "left",
    cursor: "pointer",
    display: "grid",
    gap: "8px",
  };
}

const mobileDayHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
};

const mobileDayDateStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const mobileDayCountStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};

const mobileDayEventListStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
};

function detailPanelStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "18px" : "20px",
    borderRadius: "var(--x-radius-lg)",
    background: "var(--x-color-panel-strong)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
    position: isMobile ? "static" : "sticky",
    top: isMobile ? undefined : "76px",
  };
}

const detailHeaderStyle: CSSProperties = {
  paddingBottom: "14px",
  marginBottom: "16px",
  borderBottom: "1px solid var(--x-color-line-soft)",
};

const detailEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const detailTitleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "24px",
  color: "var(--x-color-ink)",
};

const placeholderStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
};

const eventListStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

function eventCardStyle(isMobile: boolean): CSSProperties {
  return {
    padding: isMobile ? "12px" : "14px",
    borderRadius: "var(--x-radius-md)",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    textAlign: "left",
    cursor: "pointer",
    display: "grid",
    gap: "12px",
  };
}

function eventCardMediaWrapStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) 96px",
    gap: "10px",
    alignItems: "stretch",
  };
}

const eventCardHeroContainerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
};

const eventCardHeroStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  borderRadius: "16px",
  overflow: "hidden",
  background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-nav-end))",
};

const eventCardHeroImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const eventCardHeroVideoStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

const eventCardPreviewGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "repeat(3, minmax(0, 1fr))",
  gap: "10px",
};

const eventCardPreviewImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: "45px",
  objectFit: "cover",
  display: "block",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
};

const eventCardImageFallbackStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  color: "white",
  fontSize: "13px",
  fontWeight: 800,
  letterSpacing: "0.2em",
};

const eventCardPreviewFallbackStyle: CSSProperties = {
  minHeight: "45px",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
  border: "1px dashed var(--x-color-line-soft)",
};

const eventCardTitleStyle: CSSProperties = {
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

const eventCardMetaStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};
