import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { PageHero } from "../../components/PageHero";
import { useEventData } from "../../event/shared/EventDataContext";
import { fetchEventDetail } from "../../event/shared/api";
import { calendarDateFromParts, calendarDateKey, parseCalendarDateParts } from "../../event/shared/eventDate";
import type { AlbumFile, SharedEventRecord } from "../../event/shared/types";
import { smartImageURL } from "../../js/get_img";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { useUserState } from "../../app/UserState";

export function HomeAlbumPage() {
  useEnsureDesignTokens();

  const { events, getEventsForMonth, loading, error } = useEventData();
  const { isMobile } = useUserState();
  const navigate = useNavigate();
  const now = new Date();
  const currentYear = now.getFullYear();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  const [eventImageUrls, setEventImageUrls] = useState<Record<number, string>>({});
  const [slideTick, setSlideTick] = useState(0);
  const yearOptions = useMemo(() => buildYearOptions(events, currentYear), [events, currentYear]);
  const monthEvents = useMemo(() => getEventsForMonth(year, month), [getEventsForMonth, year, month]);
  const eventMap = useMemo(() => buildEventMap(monthEvents, year, month), [monthEvents, year, month]);
  const calendar_data = useMemo(() => buildCalendarData(year, month, eventMap), [year, month, eventMap]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const layoutScale = useMemo(() => buildLayoutScale(viewportWidth, isMobile), [isMobile, viewportWidth]);

  useEffect(() => {
    const initial = pickInitialDate(eventMap, year, month);
    setSelectedDate(initial);
  }, [eventMap, year, month]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previousBodyBackground = document.body.style.background;
    const previousHtmlBackground = document.documentElement.style.background;
    document.body.style.background = SKY_PAGE_BACKGROUND;
    document.documentElement.style.background = SKY_PAGE_BACKGROUND;

    return () => {
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousHtmlBackground;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!monthEvents.length) {
      setEventImageUrls({});
      return () => {
        cancelled = true;
      };
    }

    void loadMonthEventImages(monthEvents).then((nextUrls) => {
      if (!cancelled) {
        setEventImageUrls(nextUrls);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [monthEvents]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSlideTick((value) => value + 1);
    }, 4600);

    return () => window.clearInterval(timer);
  }, []);

  const selectedEvents = selectedDate ? eventMap[selectedDate] || [] : [];
  function changeMonth(delta: number) {
    const base = new Date(year, month - 1 + delta, 1);
    setYear(base.getFullYear());
    setMonth(base.getMonth() + 1);
  }

  return (
    <div id="home-album-page" style={pageStyle}>
      <style id="home-album-calendar-event-button-style">{calendarEventButtonCss}</style>
      <PageHero idPrefix="home-hero" tone="sky" title="地南佛学会" subtitle="Album Calendar" />

      <section id="home-album-toolbar" style={toolbarStyle(isMobile)}>
        <div id="home-album-month-nav" style={monthNavStyle}>
          <button id="home-album-month-prev" type="button" style={monthButtonStyle} onClick={() => changeMonth(-1)}>
            ◀
          </button>
          <div id="home-album-month-label" style={monthLabelStyle}>
            <select
              id="home-album-year-select"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              style={yearSelectStyle}
              aria-label="选择年份"
            >
              {yearOptions.map((optionYear) => (
                <option key={optionYear} value={optionYear}>
                  {optionYear}
                </option>
              ))}
            </select>
            <span id="home-album-month-text">/ {String(month).padStart(2, "0")}</span>
          </div>
          <button id="home-album-month-next" type="button" style={monthButtonStyle} onClick={() => changeMonth(1)}>
            ▶
          </button>
        </div>

      </section>

      {error ? <div id="home-album-error-banner" style={errorBannerStyle}>{error}</div> : null}
      {loading ? <div id="home-album-loading" style={placeholderStyle}>读取活动中…</div> : null}

      <div id="home-album-mobile-summary" style={mobileSummaryStyle(isMobile)}>
        <div id="home-album-mobile-month-count" style={mobileSummaryValueStyle}>{monthEvents.length}</div>
        <div id="home-album-mobile-month-label" style={mobileSummaryLabelStyle}>本月活动</div>
        <div id="home-album-mobile-summary-divider" style={mobileSummaryDividerStyle} />
        <div id="home-album-mobile-day-count" style={mobileSummaryValueStyle}>{selectedEvents.length}</div>
        <div id="home-album-mobile-day-label" style={mobileSummaryLabelStyle}>当天活动</div>
      </div>

      <div id="home-album-layout" style={layoutStyle(isMobile)}>
        <section id="home-album-calendar-section" style={calendarStyle(isMobile, layoutScale)}>
          {isMobile
            ? renderMobileCalendarCards(calendar_data, selectedDate, setSelectedDate, navigate, layoutScale, eventImageUrls, slideTick)
            : (
              <>
                {["日", "一", "二", "三", "四", "五", "六"].map((name, index) => (
                  <div key={name} id={`home-calendar-week-header-${index}`} style={weekHeaderStyle(layoutScale)}>
                    {name}
                  </div>
                ))}
                {renderCalendarCells(
                  calendar_data,
                  selectedDate,
                  setSelectedDate,
                  isMobile,
                  navigate,
                  layoutScale,
                  eventImageUrls,
                  slideTick,
                )}
              </>
            )}
        </section>
      </div>
    </div>
  );
}

function getDaysLeft(dateStr: string) {
  const today = new Date();
  const targetParts = parseCalendarDateParts(dateStr);

  if (!targetParts) {
    return 0;
  }

  const target = calendarDateFromParts(targetParts);
  today.setHours(0, 0, 0, 0);

  const diff = target.getTime() - today.getTime();

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

async function loadMonthEventImages(monthEvents: SharedEventRecord[]) {
  const entries = await Promise.all(
    monthEvents.map(async (event) => {
      const primaryUrl = await resolveEventPrimaryImage(event);
      return primaryUrl ? ([event.id, primaryUrl] as const) : null;
    }),
  );
  const nextUrls: Record<number, string> = {};

  entries.forEach((entry) => {
    if (entry) {
      nextUrls[entry[0]] = entry[1];
    }
  });

  return nextUrls;
}

async function resolveEventPrimaryImage(event: SharedEventRecord) {
  if (typeof event.event_image?.id === "number") {
    const posterUrl = await resolveImageUrl(event.event_image.id);
    if (posterUrl) {
      return posterUrl;
    }
  }

  const payload = await fetchEventDetail(event.id).catch(() => null);
  const files = Array.isArray(payload?.data?.album_files) ? (payload.data.album_files as AlbumFile[]) : [];
  const imageFile = files
    .filter((file) => typeof file.id === "number" && !isVideoFileType(file.file_type))
    .sort(
      (left, right) =>
        new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime(),
    )[0];

  return imageFile ? resolveImageUrl(imageFile.id) : null;
}

async function resolveImageUrl(fileId: number) {
  const url = await smartImageURL(fileId, "cache").catch(() => null);
  return url && url !== "/static/images/file_icon/broken-image.png" ? url : null;
}

function isVideoFileType(fileType?: string | null) {
  return ["mp4", "mov", "mod", "m4v", "avi", "mkv", "webm", "flv", "mts", "m2ts", "3gp", "wmv"].includes(
    String(fileType || "").trim().toLowerCase(),
  );
}

function renderCalendarCells(
  calendar_data: CalendarCellData[],
  selectedDate: string | null,
  setSelectedDate: (value: string) => void,
  isMobile: boolean,
  navigate: (path: string) => void,
  layoutScale: number,
  eventImageUrls: Record<number, string>,
  slideTick: number,
) {
  return calendar_data.map((cell, index) => {
    if (!cell.dateKey) {
      return <div key={index} id={`home-calendar-empty-cell-${index}`} style={emptyDayStyle(layoutScale)} />;
    }

    const active = selectedDate === cell.dateKey;
    const hasEvent = cell.items.length > 0;
    const imageUrls = getCellImageUrls(cell.items, eventImageUrls);

    // 👇 只有有 event 才算
    const daysLeft = hasEvent ? getDaysLeft(cell.dateKey) : null;

    return (
      <div
        key={index}
        id={`home-calendar-day-${cell.dateKey}`}
        style={dayCardStyle(active, hasEvent, isMobile, layoutScale)}
        onClick={() => setSelectedDate(cell.dateKey)}
      >
        {renderCalendarBackgroundLayers(`home-calendar-day-bg-${cell.dateKey}`, imageUrls, slideTick)}
        <div id={`home-calendar-day-number-${cell.dateKey}`} style={dayNumberStyle(layoutScale, Boolean(imageUrls.length))}>
          {cell.dayLabel}

          {/* 👇 只有有 event 才显示 */}
          {hasEvent && daysLeft !== null && (
            <span id={`home-calendar-days-left-${cell.dateKey}`} style={{ marginLeft: 6 * layoutScale, fontSize: 12 * layoutScale }}>
              {daysLeft > 0
                ? `${daysLeft}d`
                : daysLeft === 0
                ? "Today"
                : ""}
            </span>
          )}
        </div>

        {cell.items.map((activity) => (
          <button
            key={activity.id}
            id={`home-calendar-day-event-${cell.dateKey}-${activity.id}`}
            className="home-calendar-event-button"
            type="button"
            style={dayEventButtonStyle(layoutScale, Boolean(imageUrls.length))}
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/event/${activity.id}`);
            }}
          >
            {activity.event_name || `活动 #${activity.id}`}
          </button>
        ))}
      </div>
    );
  });
}

function renderMobileCalendarCards(
  calendar_data: CalendarCellData[],
  selectedDate: string | null,
  setSelectedDate: (value: string) => void,
  navigate: (path: string) => void,
  layoutScale: number,
  eventImageUrls: Record<number, string>,
  slideTick: number,
) {
  return calendar_data
    .filter((cell) => cell.dateKey && cell.items.length > 0)
    .map((cell, index) => {
      const imageUrls = getCellImageUrls(cell.items, eventImageUrls);

      return (
        <div
          key={index}
          id={`home-mobile-day-card-${cell.dateKey}`}
          style={mobileDayCardStyle(selectedDate === cell.dateKey, layoutScale)}
          onClick={() => setSelectedDate(cell.dateKey!)}
        >
          {renderCalendarBackgroundLayers(`home-mobile-day-bg-${cell.dateKey}`, imageUrls, slideTick)}
          <div id={`home-mobile-day-header-${cell.dateKey}`} style={mobileDayHeaderStyle(layoutScale)}>
            <div id={`home-mobile-day-date-${cell.dateKey}`} style={mobileDayDateStyle(layoutScale, Boolean(imageUrls.length))}>
              {cell.dateKey}
            </div>
            <div id={`home-mobile-day-count-${cell.dateKey}`} style={mobileDayCountStyle(layoutScale, Boolean(imageUrls.length))}>
              {cell.items.length} 个活动
            </div>
          </div>
          <div id={`home-mobile-day-event-list-${cell.dateKey}`} style={mobileDayEventListStyle(layoutScale)}>
            {cell.items.map((activity) => (
              <button
                key={activity.id}
                id={`home-mobile-day-event-${cell.dateKey}-${activity.id}`}
                className="home-calendar-event-button"
                type="button"
                style={dayEventButtonStyle(layoutScale * 0.88, Boolean(imageUrls.length))}
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/event/${activity.id}`);
                }}
              >
                {activity.event_name || `活动 #${activity.id}`}
              </button>
            ))}
          </div>
        </div>
      );
    });
}

function getCellImageUrls(items: SharedEventRecord[], eventImageUrls: Record<number, string>) {
  return Array.from(
    new Set(
      items
        .map((event) => eventImageUrls[event.id])
        .filter((url): url is string => Boolean(url)),
    ),
  );
}

function renderCalendarBackgroundLayers(idPrefix: string, imageUrls: string[], slideTick: number) {
  if (!imageUrls.length) {
    return null;
  }

  const activeIndex = slideTick % imageUrls.length;

  return imageUrls.map((url, index) => (
    <div
      key={`${url}-${index}`}
      id={`${idPrefix}-${index}`}
      style={calendarBackgroundLayerStyle(url, index === activeIndex)}
    />
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
    const startParts = parseCalendarDateParts(event.datetime);
    if (!startParts) {
      return;
    }

    const endParts = parseCalendarDateParts(event.end_datetime) || startParts;
    const start = calendarDateFromParts(startParts);
    const end = calendarDateFromParts(endParts) < start ? start : calendarDateFromParts(endParts);
    const cursor = new Date(start);

    while (cursor <= end) {
      if (cursor.getFullYear() === year && cursor.getMonth() + 1 === month) {
        const key = calendarDateKey({
          year: cursor.getFullYear(),
          month: cursor.getMonth() + 1,
          day: cursor.getDate(),
        });
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

function buildYearOptions(events: SharedEventRecord[], currentYear: number) {
  const years = new Set<number>([currentYear - 2, currentYear - 1, currentYear, currentYear + 1]);

  events.forEach((event) => {
    [event.datetime, event.end_datetime].forEach((value) => {
      const parts = parseCalendarDateParts(value);
      if (!parts) {
        return;
      }
      years.add(parts.year);
    });
  });

  return Array.from(years).sort((left, right) => right - left);
}

function buildLayoutScale(width: number, isMobile: boolean) {
  if (isMobile || width < 1200) {
    return 1;
  }

  const tier = Math.floor((width - 1200) / 200) + 1;
  return Math.min(1.34, 1 + tier * 0.08);
}

const SKY_PAGE_BACKGROUND = "#eef9ff";
const SKY_TEXT = "rgba(12, 74, 110, 0.98)";
const SKY_TEXT_SOFT = "rgba(31, 78, 121, 0.9)";
const SKY_TEXT_MUTED = "rgba(70, 120, 158, 0.86)";
const SKY_GLASS =
  "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(232,247,255,0.6))";
const SKY_GLASS_SOFT = "rgba(255, 255, 255, 0.48)";
const SKY_BORDER = "1px solid rgba(255, 255, 255, 0.74)";
const SKY_ACCENT_BORDER = "1px solid rgba(56, 189, 248, 0.34)";
const SKY_SHADOW = "0 24px 60px rgba(14, 116, 144, 0.12)";
const SKY_SHADOW_SOFT = "0 14px 34px rgba(14, 116, 144, 0.1)";
const calendarEventButtonCss = `
  .home-calendar-event-button:hover,
  .home-calendar-event-button:focus-visible {
    background: rgba(255,255,255,0.62) !important;
    border-color: rgba(255,255,255,0.56) !important;
    box-shadow: 0 8px 18px rgba(14, 116, 144, 0.08) !important;
    backdrop-filter: blur(12px);
  }

  @media (hover: none) {
    .home-calendar-event-button:active {
      background: rgba(255,255,255,0.58) !important;
      border-color: rgba(255,255,255,0.52) !important;
    }
  }
`;

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  paddingBottom: "32px",
  overflowX: "hidden",
  background:
    "radial-gradient(circle at top left, rgba(125,211,252,0.42), transparent 28%), radial-gradient(circle at top right, rgba(186,230,253,0.58), transparent 32%), linear-gradient(180deg, #eef9ff, #f8fcff)",
};

function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    zIndex: 4,
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: isMobile ? "stretch" : "center",
    flexWrap: "wrap",
    flexDirection: isMobile ? "column" : "row",
    width: "100%",
    margin: isMobile ? "-58px auto 0" : "-68px auto 0",
    padding: isMobile ? "12px 14px" : "14px 20px",
    boxSizing: "border-box",
    borderRadius: "0",
    background: "transparent",
    border: "none",
    boxShadow: "none",
    backdropFilter: "none",
  };
}

const monthNavStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "8px",
  borderRadius: "999px",
  background: "rgba(255, 255, 255, 0.58)",
  border: SKY_ACCENT_BORDER,
  boxShadow: "0 12px 28px rgba(14, 116, 144, 0.1)",
  backdropFilter: "blur(14px)",
};

const monthButtonStyle: CSSProperties = {
  width: "42px",
  height: "42px",
  padding: 0,
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.72)",
  background: "rgba(255,255,255,0.68)",
  color: "rgba(14, 116, 144, 0.92)",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 10px 24px rgba(14, 116, 144, 0.1)",
  transition: "transform 140ms ease, background 140ms ease, box-shadow 140ms ease",
};

const monthLabelStyle: CSSProperties = {
  minWidth: "126px",
  color: SKY_TEXT,
  fontWeight: 800,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
};

const yearSelectStyle: CSSProperties = {
  border: SKY_ACCENT_BORDER,
  borderRadius: "999px",
  padding: "8px 10px",
  background: "rgba(255,255,255,0.74)",
  color: SKY_TEXT,
  fontWeight: 800,
  outline: "none",
  boxShadow: "0 8px 20px rgba(14, 116, 144, 0.08)",
};

const errorBannerStyle: CSSProperties = {
  maxWidth: "1400px",
  margin: "16px auto 0",
  padding: "14px 16px",
  borderRadius: "var(--x-radius-md)",
  background: "rgba(255, 241, 242, 0.86)",
  border: "1px solid rgba(244, 63, 94, 0.24)",
  color: "rgba(159, 18, 57, 0.86)",
  boxShadow: "0 14px 34px rgba(159, 18, 57, 0.08)",
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
    background: SKY_GLASS,
    border: SKY_BORDER,
    boxShadow: SKY_SHADOW_SOFT,
    backdropFilter: "blur(18px)",
  };
}

function layoutStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 0,
    width: "100%",
    maxWidth: "none",
    margin: isMobile ? "12px 0 0" : "16px 0 0",
    padding: 0,
    alignItems: "start",
    boxSizing: "border-box",
  };
}

function calendarStyle(isMobile: boolean, scale: number): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(7, minmax(0, 1fr))",
    gap: `${(isMobile ? 7 : 10) * scale}px`,
    padding: `${(isMobile ? 8 : 16) * scale}px`,
    borderRadius: "0",
    background: SKY_GLASS,
    border: SKY_BORDER,
    boxShadow: SKY_SHADOW,
    backdropFilter: "blur(18px)",
  };
}

function weekHeaderStyle(scale: number): CSSProperties {
  return {
    textAlign: "center",
    fontSize: `${14 * scale}px`,
    fontWeight: 800,
    color: SKY_TEXT_MUTED,
    padding: `${8 * scale}px 0`,
  };
}

function emptyDayStyle(scale: number): CSSProperties {
  return {
    minHeight: `${132 * scale}px`,
    borderRadius: `${12 * scale}px`,
    background: "rgba(232, 247, 255, 0.34)",
    border: "1px solid rgba(255,255,255,0.42)",
  };
}

function dayCardStyle(active: boolean, hasEvent: boolean, isMobile: boolean, scale: number): CSSProperties {
  return {
    position: "relative",
    minHeight: `${(isMobile ? 122 : 144) * scale}px`,
    padding: `${(isMobile ? 8 : 10) * scale}px`,
    borderRadius: `${14 * scale}px`,
    border: active ? SKY_ACCENT_BORDER : "1px solid rgba(255,255,255,0.52)",
    background: hasEvent
      ? active
        ? "linear-gradient(135deg, rgba(186,230,253,0.82), rgba(240,249,255,0.78))"
        : "linear-gradient(135deg, rgba(240,249,255,0.68), rgba(224,247,255,0.5))"
      : "rgba(255,255,255,0.36)",
    boxShadow: hasEvent ? "0 12px 26px rgba(14, 116, 144, 0.1)" : "none",
    textAlign: "left",
    cursor: "pointer",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    alignContent: "start",
    gap: `${6 * scale}px`,
    overflow: "hidden",
    transition: "transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
  };
}

function dayNumberStyle(scale: number, hasImage: boolean): CSSProperties {
  return {
    position: "relative",
    zIndex: 2,
    width: "max-content",
    padding: hasImage ? `${4 * scale}px ${7 * scale}px` : 0,
    borderRadius: `${10 * scale}px`,
    background: hasImage ? "rgba(255,255,255,0.62)" : "transparent",
    backdropFilter: hasImage ? "blur(12px)" : undefined,
    fontSize: `${14 * scale}px`,
    fontWeight: 800,
    color: SKY_TEXT,
  };
}

const mobileSummaryValueStyle: CSSProperties = {
  fontSize: "26px",
  fontWeight: 800,
  color: SKY_TEXT,
  textAlign: "center",
};

const mobileSummaryLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: SKY_TEXT_MUTED,
  textAlign: "center",
};

const mobileSummaryDividerStyle: CSSProperties = {
  width: "1px",
  height: "100%",
  background: "rgba(56, 189, 248, 0.22)",
};

function calendarBackgroundLayerStyle(url: string, active: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    zIndex: 0,
    opacity: active ? 1 : 0,
    backgroundImage:
      `linear-gradient(180deg, rgba(238,249,255,0.2), rgba(238,249,255,0.72)), url("${url}")`,
    backgroundPosition: "center",
    backgroundSize: "cover",
    transition: "opacity 1100ms ease, transform 4600ms ease",
    transform: active ? "scale(1.03)" : "scale(1)",
    pointerEvents: "none",
  };
}

function dayEventButtonStyle(scale: number, hasImage: boolean): CSSProperties {
  return {
    position: "relative",
    zIndex: 2,
    width: "100%",
    margin: 0,
    padding: `${3 * scale}px ${5 * scale}px`,
    borderRadius: `${8 * scale}px`,
    border: "1px solid transparent",
    background: "transparent",
    fontSize: `${12 * scale}px`,
    lineHeight: 1.22,
    color: hasImage ? SKY_TEXT : SKY_TEXT_SOFT,
    fontWeight: 800,
    textAlign: "left",
    cursor: "pointer",
    boxShadow: "none",
    backdropFilter: "none",
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
  };
}

function mobileDayCardStyle(active: boolean, scale: number): CSSProperties {
  return {
    position: "relative",
    aspectRatio: "1 / 1",
    minHeight: "auto",
    padding: `${9 * scale}px`,
    borderRadius: `${14 * scale}px`,
    border: active ? SKY_ACCENT_BORDER : "1px solid rgba(255,255,255,0.58)",
    background: active
      ? "linear-gradient(135deg, rgba(186,230,253,0.86), rgba(240,249,255,0.76))"
      : "rgba(255,255,255,0.5)",
    boxShadow: "0 10px 24px rgba(14, 116, 144, 0.1)",
    textAlign: "left",
    cursor: "pointer",
    display: "grid",
    alignContent: "start",
    gap: `${6 * scale}px`,
    overflow: "hidden",
  };
}

function mobileDayHeaderStyle(scale: number): CSSProperties {
  return {
    position: "relative",
    zIndex: 2,
    display: "flex",
    justifyContent: "flex-start",
    flexDirection: "column",
    gap: `${4 * scale}px`,
    alignItems: "flex-start",
  };
}

function mobileDayDateStyle(scale: number, hasImage: boolean): CSSProperties {
  return {
    padding: hasImage ? `${3 * scale}px ${6 * scale}px` : 0,
    borderRadius: `${10 * scale}px`,
    background: hasImage ? "rgba(255,255,255,0.62)" : "transparent",
    backdropFilter: hasImage ? "blur(12px)" : undefined,
    fontSize: `${12.5 * scale}px`,
    fontWeight: 800,
    color: SKY_TEXT,
  };
}

function mobileDayCountStyle(scale: number, hasImage: boolean): CSSProperties {
  return {
    padding: hasImage ? `${3 * scale}px ${6 * scale}px` : 0,
    borderRadius: `${999 * scale}px`,
    background: hasImage ? "rgba(255,255,255,0.58)" : "transparent",
    backdropFilter: hasImage ? "blur(12px)" : undefined,
    fontSize: `${11 * scale}px`,
    color: SKY_TEXT_MUTED,
    fontWeight: 800,
  };
}

function mobileDayEventListStyle(scale: number): CSSProperties {
  return {
    position: "relative",
    zIndex: 2,
    display: "grid",
    gap: `${2 * scale}px`,
    overflowY: "auto",
    minHeight: 0,
  };
}

const placeholderStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "var(--x-radius-md)",
  background: SKY_GLASS_SOFT,
  border: "1px solid rgba(255,255,255,0.58)",
  color: SKY_TEXT_MUTED,
  boxShadow: "0 10px 24px rgba(14, 116, 144, 0.08)",
  backdropFilter: "blur(14px)",
};
