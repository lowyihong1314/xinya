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
  const [view, setView] = useState<"cards" | "calendar">("cards");
  const homeEvents = useMemo(() => buildHomeEvents(events), [events]);
  const pastEvents = homeEvents.pastEvents;
  const hasAnyHomeEvent =
    Boolean(homeEvents.nextEvent) || homeEvents.upcomingList.length > 0 || pastEvents.length > 0;
  const [cardImageUrls, setCardImageUrls] = useState<Record<number, string>>({});
  const [cardPage, setCardPage] = useState(0);
  const cardPageSize = isMobile ? 6 : 8;
  const cardPageCount = Math.max(1, Math.ceil(pastEvents.length / cardPageSize));
  const safeCardPage = Math.min(cardPage, cardPageCount - 1);
  const pagedPastEvents = useMemo(
    () => pastEvents.slice(safeCardPage * cardPageSize, safeCardPage * cardPageSize + cardPageSize),
    [pastEvents, safeCardPage, cardPageSize],
  );

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
    setCardPage(0);
  }, [pastEvents]);

  useEffect(() => {
    let cancelled = false;

    const targets: SharedEventRecord[] = [];
    if (homeEvents.nextEvent) {
      targets.push(homeEvents.nextEvent.event);
    }
    pagedPastEvents.forEach((entry) => targets.push(entry.event));

    if (!targets.length) {
      setCardImageUrls({});
      return () => {
        cancelled = true;
      };
    }

    void loadMonthEventImages(targets).then((nextUrls) => {
      if (!cancelled) {
        setCardImageUrls(nextUrls);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [homeEvents.nextEvent, pagedPastEvents]);

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
      <style id="home-album-calendar-event-button-style">{calendarEventButtonCss + eventCardCss}</style>
      <PageHero idPrefix="home-hero" tone="sky" title="地南佛学会" subtitle="南 無 阿 彌 陀 佛" subtitleFromMedia />

      <div id="home-content" style={contentWrapStyle}>
        <div id="home-view-toggle" style={segmentedWrapStyle}>
          <div style={segmentedStyle}>
            <button
              id="home-view-cards"
              type="button"
              style={segButtonStyle(view === "cards")}
              onClick={() => setView("cards")}
            >
              近期活动
            </button>
            <button
              id="home-view-calendar"
              type="button"
              style={segButtonStyle(view === "calendar")}
              onClick={() => setView("calendar")}
            >
              日历
            </button>
          </div>
        </div>

        {error ? <div id="home-album-error-banner" style={errorBannerStyle}>{error}</div> : null}
        {loading ? <div id="home-album-loading" style={placeholderStyle}>读取活动中…</div> : null}

        {view === "cards" ? (
          hasAnyHomeEvent ? (
            <>
              {renderFeaturedEvent(homeEvents.nextEvent, cardImageUrls, navigate, isMobile)}
              {renderUpcomingList(homeEvents.upcomingList, navigate)}
              {renderPastSection(
                pagedPastEvents,
                cardImageUrls,
                navigate,
                isMobile,
                cardPageCount,
                safeCardPage,
                setCardPage,
              )}
            </>
          ) : (
            <div id="home-cards-empty" style={cardsEmptyStyle}>
              {loading ? "读取活动中…" : "暂时还没有活动，敬请期待。"}
            </div>
          )
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

type CardEventEntry = {
  event: SharedEventRecord;
  start: Date;
  end: Date;
};

type HomeEvents = {
  nextEvent: CardEventEntry | null;
  upcomingList: CardEventEntry[];
  pastEvents: CardEventEntry[];
};

function buildHomeEvents(events: SharedEventRecord[]): HomeEvents {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  const withDate: CardEventEntry[] = [];
  events.forEach((event) => {
    const startParts = parseCalendarDateParts(event.datetime);
    if (!startParts) {
      return;
    }
    const start = calendarDateFromParts(startParts);
    const endParts = parseCalendarDateParts(event.end_datetime) || startParts;
    const end = calendarDateFromParts(endParts);
    withDate.push({ event, start, end: end < start ? start : end });
  });

  // 未来（含今天）：最近的在前
  const upcoming = withDate
    .filter((entry) => entry.start.getTime() >= todayTime)
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  // 过去：只保留有封面图的，最近的在前
  const past = withDate
    .filter(
      (entry) =>
        entry.start.getTime() < todayTime && typeof entry.event.event_image?.id === "number",
    )
    .sort((left, right) => right.start.getTime() - left.start.getTime());

  return {
    nextEvent: upcoming[0] || null,
    upcomingList: upcoming.slice(1, 6),
    pastEvents: past,
  };
}

function formatCardDate(date: Date) {
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
    date.getDate(),
  ).padStart(2, "0")} 周${weekday}`;
}

function formatFullDate(date: Date) {
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 周${weekday}`;
}

function extractTime(value?: string | null) {
  if (!value) {
    return "";
  }
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function formatTimeRange(event: SharedEventRecord) {
  const start = extractTime(event.datetime);
  const end = extractTime(event.end_datetime);
  if (!start) {
    return "";
  }
  return end && end !== start ? `${start}–${end}` : start;
}

function renderSectionHeader(title: string, subtitle?: string) {
  return (
    <div style={sectionHeaderStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      {subtitle ? <span style={sectionSubtitleStyle}>{subtitle}</span> : null}
    </div>
  );
}

function renderFeaturedEvent(
  entry: CardEventEntry | null,
  cardImageUrls: Record<number, string>,
  navigate: (path: string) => void,
  isMobile: boolean,
) {
  if (!entry) {
    return null;
  }

  const { event, start } = entry;
  const imageUrl = cardImageUrls[event.id];
  const name = event.event_name || `活动 #${event.id}`;
  const dateKey = calendarDateKey({
    year: start.getFullYear(),
    month: start.getMonth() + 1,
    day: start.getDate(),
  });
  const daysLeft = getDaysLeft(dateKey);
  const timeRange = formatTimeRange(event);

  return (
    <section id="home-featured-section" style={sectionStyle}>
      {renderSectionHeader("下一个活动", "即将到来")}
      <button
        id="home-featured-card"
        type="button"
        className="home-event-card"
        style={featuredCardStyle(isMobile)}
        onClick={() => navigate(`/event/${event.id}`)}
      >
        <div style={featuredMediaStyle(imageUrl, isMobile)}>
          {imageUrl ? null : <span style={cardPlaceholderCharStyle}>{name.trim().charAt(0) || "佛"}</span>}
          {daysLeft >= 0 ? (
            <span style={cardBadgeStyle}>{daysLeft === 0 ? "今天" : `剩 ${daysLeft} 天`}</span>
          ) : null}
        </div>
        <div style={featuredBodyStyle(isMobile)}>
          <div style={featuredDateStyle}>
            {formatFullDate(start)}
            {timeRange ? ` · ${timeRange}` : ""}
          </div>
          <div style={featuredTitleStyle(isMobile)}>{name}</div>
          <div style={featuredMetaWrapStyle}>
            {event.location ? (
              <span style={featuredMetaStyle}>
                <i className="fas fa-location-dot" style={featuredMetaIconStyle} />
                {event.location}
              </span>
            ) : null}
            {event.type ? <span style={featuredChipStyle}>{event.type}</span> : null}
            {event.target ? <span style={featuredChipStyle}>{event.target}</span> : null}
          </div>
          {event.purpose ? <p style={featuredDescStyle}>{event.purpose}</p> : null}
          <span style={featuredCtaStyle}>查看详情 →</span>
        </div>
      </button>
    </section>
  );
}

function renderUpcomingList(entries: CardEventEntry[], navigate: (path: string) => void) {
  if (!entries.length) {
    return null;
  }

  return (
    <section id="home-upcoming-section" style={sectionStyle}>
      {renderSectionHeader("即将举行", "近期活动预告")}
      <div id="home-upcoming-list" style={listWrapStyle}>
        {entries.map(({ event, start }) => {
          const name = event.event_name || `活动 #${event.id}`;
          const dateKey = calendarDateKey({
            year: start.getFullYear(),
            month: start.getMonth() + 1,
            day: start.getDate(),
          });
          const daysLeft = getDaysLeft(dateKey);
          const timeRange = formatTimeRange(event);

          return (
            <button
              key={event.id}
              id={`home-upcoming-${event.id}`}
              type="button"
              className="home-list-row"
              style={listRowStyle}
              onClick={() => navigate(`/event/${event.id}`)}
            >
              <div style={listDateColStyle}>
                <div style={listDayStyle}>{start.getDate()}</div>
                <div style={listMonthStyle}>{start.getMonth() + 1} 月</div>
              </div>
              <div style={listMainStyle}>
                <div style={listNameStyle}>{name}</div>
                <div style={listMetaStyle}>
                  {formatCardDate(start)}
                  {timeRange ? ` · ${timeRange}` : ""}
                  {event.location ? ` · ${event.location}` : ""}
                </div>
              </div>
              {daysLeft >= 0 ? (
                <span style={listBadgeStyle}>{daysLeft === 0 ? "今天" : `${daysLeft} 天`}</span>
              ) : null}
              <span style={listArrowStyle}>›</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function renderPastSection(
  pastEvents: CardEventEntry[],
  cardImageUrls: Record<number, string>,
  navigate: (path: string) => void,
  isMobile: boolean,
  pageCount: number,
  page: number,
  setPage: (updater: (page: number) => number) => void,
) {
  if (!pastEvents.length) {
    return null;
  }

  return (
    <section id="home-past-section" style={sectionStyle}>
      {renderSectionHeader("往期活动", "回顾过去的法会与共修")}
      <div id="home-cards-grid" style={cardsGridStyle(isMobile)}>
        {pastEvents.map(({ event, start }) => {
          const imageUrl = cardImageUrls[event.id];
          const name = event.event_name || `活动 #${event.id}`;

          return (
            <button
              key={event.id}
              id={`home-card-${event.id}`}
              type="button"
              className="home-event-card"
              style={cardStyle}
              onClick={() => navigate(`/event/${event.id}`)}
            >
              <div id={`home-card-media-${event.id}`} style={cardMediaStyle(imageUrl)}>
                {imageUrl ? null : <span style={cardPlaceholderCharStyle}>{name.trim().charAt(0) || "佛"}</span>}
              </div>
              <div style={cardBodyStyle}>
                <div style={cardDateStyle}>{formatCardDate(start)}</div>
                <div style={cardTitleStyle}>{name}</div>
              </div>
            </button>
          );
        })}
      </div>
      {pageCount > 1 ? (
        <div id="home-cards-pager" style={pagerStyle}>
          <button
            id="home-cards-prev"
            type="button"
            style={pagerButtonStyle(page === 0)}
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            ◀ 上一页
          </button>
          <span id="home-cards-page-label" style={pagerLabelStyle}>
            {page + 1} / {pageCount}
          </span>
          <button
            id="home-cards-next"
            type="button"
            style={pagerButtonStyle(page >= pageCount - 1)}
            disabled={page >= pageCount - 1}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          >
            下一页 ▶
          </button>
        </div>
      ) : null}
    </section>
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

// 沿用全站 CRM token（青绿主题）
const SKY_PAGE_BACKGROUND = "#eef3f9";
const SKY_TEXT = "var(--x-color-ink)";
const SKY_TEXT_SOFT = "var(--x-color-ink-muted)";
const SKY_TEXT_MUTED = "var(--x-color-ink-muted)";
const SKY_GLASS =
  "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(246,248,252,0.82))";
const SKY_GLASS_SOFT = "rgba(255, 255, 255, 0.7)";
const SKY_BORDER = "1px solid var(--x-color-line)";
const SKY_ACCENT_BORDER = "1px solid var(--x-color-accent-border)";
const SKY_SHADOW = "0 20px 48px var(--x-color-shadow)";
const SKY_SHADOW_SOFT = "0 12px 28px var(--x-color-shadow-soft)";
const calendarEventButtonCss = `
  .home-calendar-event-button:hover,
  .home-calendar-event-button:focus-visible {
    background: rgba(255,255,255,0.82) !important;
    border-color: var(--x-color-line) !important;
    box-shadow: 0 8px 18px var(--x-color-shadow-soft) !important;
  }

  @media (hover: none) {
    .home-calendar-event-button:active {
      background: rgba(255,255,255,0.78) !important;
      border-color: var(--x-color-line) !important;
    }
  }
`;

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  paddingBottom: "48px",
  overflowX: "hidden",
  background: "linear-gradient(180deg, #eef3f9, #f8fcff)",
};

function toolbarStyle(_isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    zIndex: 4,
    display: "flex",
    justifyContent: "center",
    gap: "14px",
    alignItems: "center",
    flexWrap: "wrap",
    width: "100%",
    margin: "4px auto 0",
    padding: "4px 0",
    boxSizing: "border-box",
    background: "transparent",
    border: "none",
    boxShadow: "none",
  };
}

const contentWrapStyle: CSSProperties = {
  maxWidth: "1180px",
  margin: "0 auto",
  padding: "28px 20px 0",
  boxSizing: "border-box",
};

const segmentedWrapStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  marginBottom: "22px",
};

const segmentedStyle: CSSProperties = {
  display: "inline-flex",
  gap: "4px",
  padding: "5px",
  borderRadius: "999px",
  background: "var(--x-color-panel-glass)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
};

function segButtonStyle(active: boolean): CSSProperties {
  return {
    minWidth: "104px",
    padding: "9px 22px",
    borderRadius: "999px",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--x-font-serif)",
    fontSize: "15px",
    letterSpacing: "0.12em",
    fontWeight: 500,
    color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)",
    background: active ? "var(--x-color-accent-soft)" : "transparent",
    boxShadow: active ? "inset 0 0 0 1px var(--x-color-accent-border)" : "none",
    transition: "background 160ms ease, color 160ms ease",
  };
}

function cardsGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile
      ? "repeat(2, minmax(0, 1fr))"
      : "repeat(auto-fill, minmax(248px, 1fr))",
    gap: isMobile ? "14px" : "22px",
    width: "100%",
  };
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: 0,
  textAlign: "left",
  overflow: "hidden",
  borderRadius: "var(--x-radius-lg)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxShadow: "0 12px 30px var(--x-color-shadow-soft)",
  cursor: "pointer",
  transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
};

function cardMediaStyle(imageUrl?: string): CSSProperties {
  return {
    position: "relative",
    width: "100%",
    aspectRatio: "4 / 3",
    display: "grid",
    placeItems: "center",
    backgroundImage: imageUrl
      ? `linear-gradient(180deg, rgba(15,23,42,0.02), rgba(15,23,42,0.12)), url("${imageUrl}")`
      : "linear-gradient(135deg, #eef3f9, #d9f3ef)",
    backgroundSize: "cover",
    backgroundPosition: "center 25%",
  };
}

const cardPlaceholderCharStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "52px",
  color: "rgba(15, 118, 110, 0.3)",
  userSelect: "none",
};

const cardBadgeStyle: CSSProperties = {
  position: "absolute",
  top: "10px",
  right: "10px",
  padding: "4px 11px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  color: "#ffffff",
  background: "var(--x-color-accent)",
  boxShadow: "0 6px 16px var(--x-color-shadow)",
};

const cardBodyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "14px 16px 16px",
};

const cardDateStyle: CSSProperties = {
  fontSize: "12.5px",
  letterSpacing: "0.08em",
  color: "var(--x-color-ink-muted)",
};

const cardTitleStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "17px",
  fontWeight: 500,
  lineHeight: 1.4,
  color: "var(--x-color-ink)",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const pagerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "16px",
  marginTop: "26px",
};

function pagerButtonStyle(disabled: boolean): CSSProperties {
  return {
    padding: "9px 20px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-line)",
    background: disabled ? "transparent" : "var(--x-color-panel)",
    color: disabled ? "var(--x-color-ink-muted)" : "var(--x-color-accent-strong)",
    fontFamily: "var(--x-font-serif)",
    fontSize: "14px",
    letterSpacing: "0.1em",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
    boxShadow: disabled ? "none" : "0 8px 20px var(--x-color-shadow-soft)",
    transition: "background 160ms ease, box-shadow 160ms ease",
  };
}

const pagerLabelStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "15px",
  letterSpacing: "0.14em",
  color: "var(--x-color-ink-muted)",
  minWidth: "58px",
  textAlign: "center",
};

const cardsEmptyStyle: CSSProperties = {
  padding: "56px 18px",
  textAlign: "center",
  fontFamily: "var(--x-font-serif)",
  fontSize: "16px",
  letterSpacing: "0.08em",
  color: "var(--x-color-ink-muted)",
};

const eventCardCss = `
  .home-event-card:hover,
  .home-event-card:focus-visible {
    transform: translateY(-3px);
    border-color: var(--x-color-accent-border) !important;
    box-shadow: 0 18px 40px var(--x-color-shadow) !important;
  }
  .home-list-row:hover,
  .home-list-row:focus-visible {
    border-color: var(--x-color-accent-border) !important;
    background: var(--x-color-panel-strong) !important;
    box-shadow: 0 10px 24px var(--x-color-shadow-soft) !important;
  }
`;

const sectionStyle: CSSProperties = {
  marginBottom: "40px",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "12px",
  flexWrap: "wrap",
  marginBottom: "16px",
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  paddingLeft: "11px",
  borderLeft: "3px solid var(--x-color-accent)",
  fontFamily: "var(--x-font-serif)",
  fontSize: "22px",
  fontWeight: 500,
  letterSpacing: "0.1em",
  color: "var(--x-color-ink)",
};

const sectionSubtitleStyle: CSSProperties = {
  fontSize: "13px",
  letterSpacing: "0.06em",
  color: "var(--x-color-ink-muted)",
};

function featuredCardStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 44%) 1fr",
    padding: 0,
    textAlign: "left",
    overflow: "hidden",
    borderRadius: "var(--x-radius-lg)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    boxShadow: "0 16px 40px var(--x-color-shadow-soft)",
    cursor: "pointer",
    width: "100%",
    transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
  };
}

function featuredMediaStyle(imageUrl: string | undefined, isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    width: "100%",
    minHeight: isMobile ? "200px" : "260px",
    display: "grid",
    placeItems: "center",
    backgroundImage: imageUrl
      ? `linear-gradient(180deg, rgba(15,23,42,0.02), rgba(15,23,42,0.12)), url("${imageUrl}")`
      : "linear-gradient(135deg, #eef3f9, #d9f3ef)",
    backgroundSize: "cover",
    backgroundPosition: "center 25%",
  };
}

function featuredBodyStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "12px",
    alignContent: "center",
    padding: isMobile ? "20px 20px 24px" : "30px 34px",
  };
}

const featuredDateStyle: CSSProperties = {
  fontSize: "13.5px",
  fontWeight: 600,
  letterSpacing: "0.06em",
  color: "var(--x-color-accent-strong)",
};

function featuredTitleStyle(isMobile: boolean): CSSProperties {
  return {
    fontFamily: "var(--x-font-serif)",
    fontSize: isMobile ? "24px" : "30px",
    fontWeight: 500,
    lineHeight: 1.32,
    color: "var(--x-color-ink)",
  };
}

const featuredMetaWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "8px",
};

const featuredMetaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "13.5px",
  color: "var(--x-color-ink-muted)",
};

const featuredMetaIconStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-accent)",
};

const featuredChipStyle: CSSProperties = {
  padding: "3px 11px",
  borderRadius: "999px",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontSize: "12px",
  letterSpacing: "0.04em",
};

const featuredDescStyle: CSSProperties = {
  margin: 0,
  fontSize: "14.5px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
  whiteSpace: "pre-line",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const featuredCtaStyle: CSSProperties = {
  marginTop: "2px",
  fontSize: "14px",
  fontWeight: 600,
  letterSpacing: "0.08em",
  color: "var(--x-color-accent-strong)",
};

const listWrapStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const listRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  width: "100%",
  padding: "12px 16px",
  textAlign: "left",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  cursor: "pointer",
  transition: "background 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
};

const listDateColStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minWidth: "46px",
  paddingRight: "14px",
  borderRight: "1px solid var(--x-color-line)",
};

const listDayStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "22px",
  fontWeight: 500,
  lineHeight: 1,
  color: "var(--x-color-accent-strong)",
};

const listMonthStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  marginTop: "2px",
};

const listMainStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  flex: 1,
  minWidth: 0,
};

const listNameStyle: CSSProperties = {
  fontFamily: "var(--x-font-serif)",
  fontSize: "16px",
  fontWeight: 500,
  color: "var(--x-color-ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const listMetaStyle: CSSProperties = {
  fontSize: "12.5px",
  color: "var(--x-color-ink-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const listBadgeStyle: CSSProperties = {
  padding: "3px 10px",
  borderRadius: "999px",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontSize: "12px",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const listArrowStyle: CSSProperties = {
  fontSize: "20px",
  color: "var(--x-color-ink-muted)",
  marginLeft: "2px",
};

const monthNavStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "8px",
  borderRadius: "999px",
  background: "var(--x-color-panel-glass)",
  border: SKY_BORDER,
  boxShadow: SKY_SHADOW_SOFT,
};

const monthButtonStyle: CSSProperties = {
  width: "42px",
  height: "42px",
  padding: 0,
  borderRadius: "999px",
  border: SKY_BORDER,
  background: "var(--x-color-panel)",
  color: "var(--x-color-accent-strong)",
  cursor: "pointer",
  fontWeight: 600,
  boxShadow: SKY_SHADOW_SOFT,
  transition: "transform 140ms ease, background 140ms ease, box-shadow 140ms ease",
};

const monthLabelStyle: CSSProperties = {
  minWidth: "126px",
  color: SKY_TEXT,
  fontFamily: "var(--x-font-serif)",
  fontWeight: 500,
  fontSize: "18px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
};

const yearSelectStyle: CSSProperties = {
  border: SKY_BORDER,
  borderRadius: "999px",
  padding: "8px 12px",
  background: "var(--x-color-panel)",
  color: SKY_TEXT,
  fontFamily: "var(--x-font-serif)",
  fontWeight: 500,
  outline: "none",
  boxShadow: SKY_SHADOW_SOFT,
};

const errorBannerStyle: CSSProperties = {
  maxWidth: "1180px",
  margin: "16px auto 0",
  padding: "14px 16px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-danger-soft)",
  border: "1px solid var(--x-color-danger-border)",
  color: "var(--x-color-danger)",
  boxShadow: SKY_SHADOW_SOFT,
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
    borderRadius: "var(--x-radius-lg)",
    background: SKY_GLASS,
    border: SKY_BORDER,
    boxShadow: SKY_SHADOW,
  };
}

function weekHeaderStyle(scale: number): CSSProperties {
  return {
    textAlign: "center",
    fontFamily: "var(--x-font-serif)",
    fontSize: `${14 * scale}px`,
    fontWeight: 500,
    letterSpacing: "0.1em",
    color: SKY_TEXT_MUTED,
    padding: `${8 * scale}px 0`,
  };
}

function emptyDayStyle(scale: number): CSSProperties {
  return {
    minHeight: `${132 * scale}px`,
    borderRadius: `${12 * scale}px`,
    background: "rgba(255, 255, 255, 0.36)",
    border: "1px solid var(--x-color-line-soft)",
  };
}

function dayCardStyle(active: boolean, hasEvent: boolean, isMobile: boolean, scale: number): CSSProperties {
  return {
    position: "relative",
    minHeight: `${(isMobile ? 122 : 144) * scale}px`,
    padding: `${(isMobile ? 8 : 10) * scale}px`,
    borderRadius: `${14 * scale}px`,
    border: active ? SKY_ACCENT_BORDER : "1px solid var(--x-color-line)",
    background: hasEvent
      ? active
        ? "linear-gradient(135deg, var(--x-color-accent-soft), rgba(255,255,255,0.85))"
        : "linear-gradient(135deg, rgba(255,255,255,0.78), var(--x-color-accent-tint))"
      : "rgba(255,255,255,0.5)",
    boxShadow: hasEvent ? "0 10px 22px var(--x-color-shadow)" : "none",
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
    background: hasImage ? "rgba(255,255,255,0.74)" : "transparent",
    backdropFilter: hasImage ? "blur(8px)" : undefined,
    fontSize: `${14 * scale}px`,
    fontWeight: 600,
    color: SKY_TEXT,
  };
}

const mobileSummaryValueStyle: CSSProperties = {
  fontSize: "26px",
  fontFamily: "var(--x-font-serif)",
  fontWeight: 500,
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
  background: "var(--x-color-line)",
};

function calendarBackgroundLayerStyle(url: string, active: boolean): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    zIndex: 0,
    opacity: active ? 1 : 0,
    backgroundImage:
      `linear-gradient(180deg, rgba(238,243,249,0.24), rgba(238,243,249,0.74)), url("${url}")`,
    backgroundPosition: "center 25%",
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
    fontWeight: 600,
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
    border: active ? SKY_ACCENT_BORDER : "1px solid var(--x-color-line)",
    background: active
      ? "linear-gradient(135deg, var(--x-color-accent-soft), rgba(255,255,255,0.82))"
      : "rgba(255,255,255,0.5)",
    boxShadow: SKY_SHADOW_SOFT,
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
    background: hasImage ? "rgba(255,255,255,0.74)" : "transparent",
    backdropFilter: hasImage ? "blur(8px)" : undefined,
    fontSize: `${12.5 * scale}px`,
    fontWeight: 600,
    color: SKY_TEXT,
  };
}

function mobileDayCountStyle(scale: number, hasImage: boolean): CSSProperties {
  return {
    padding: hasImage ? `${3 * scale}px ${6 * scale}px` : 0,
    borderRadius: `${999 * scale}px`,
    background: hasImage ? "rgba(255,255,255,0.7)" : "transparent",
    backdropFilter: hasImage ? "blur(8px)" : undefined,
    fontSize: `${11 * scale}px`,
    color: SKY_TEXT_MUTED,
    fontWeight: 600,
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
