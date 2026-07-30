import { useEffect, useMemo, useState } from "react";

import { openOverlay } from "../../app/OverlayProvider";
import { apiFetch } from "../../js/apiFetch";
import { smartImageURL } from "../../js/get_img";

export type EventPickerRecord = {
  id: number;
  event_name?: string;
  purpose?: string;
  datetime?: string;
  date?: string;
  event_image?: { id?: number } | null;
};

type EventPickerResponse = {
  data?: EventPickerRecord[];
  message?: string;
  error?: string;
};

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonthKey(monthKey: string, offset: number) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return getCurrentMonthKey();
  }

  const nextDate = new Date(Number(match[1]), Number(match[2]) - 1 + offset, 1);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeMonthKey(value?: string) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const match = text.match(/^(\d{4})[-/](\d{1,2})/);
  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

function getEventMonthKey(event: EventPickerRecord) {
  return normalizeMonthKey(event.date || event.datetime);
}

function formatMonthLabel(monthKey: string) {
  if (!monthKey) {
    return "未设置日期";
  }

  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

async function fetchEvents() {
  const response = await apiFetch("/api/event_data/get_all_event_sort", {
    credentials: "include",
  });
  const payload = (await response.json().catch(() => ({}))) as EventPickerResponse;

  if (!response.ok) {
    throw new Error(payload.error || payload.message || "获取活动失败");
  }

  return payload.data || [];
}

function EventCard({
  event,
  selected,
  onSelect,
}: {
  event: EventPickerRecord;
  selected: boolean;
  onSelect: (event: EventPickerRecord) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string>("");

  useEffect(() => {
    let active = true;

    if (!event.event_image?.id) {
      setImageUrl("");
      return;
    }

    void smartImageURL(event.event_image.id, "cache")
      .then((url) => {
        if (active && !url.includes("broken-image.png")) {
          setImageUrl(url);
        }
      })
      .catch(() => {
        if (active) {
          setImageUrl("");
        }
      });

    return () => {
      active = false;
    };
  }, [event.event_image?.id]);

  return (
    <button
      type="button"
      style={{
        ...eventCardStyle,
        ...(selected ? eventCardSelectedStyle : null),
        ...(imageUrl
          ? {
              backgroundImage: `linear-gradient(to top, rgba(20,16,35,0.72), rgba(20,16,35,0.16)), url(${imageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : null),
      }}
      onClick={() => onSelect(event)}
    >
      <div style={eventCardOverlayStyle}>
        <div style={eventCardTopRowStyle}>
          <h4 style={eventCardTitleStyle}>{event.event_name || "(未命名活动)"}</h4>
          <span style={eventIdStyle}>{`#${event.id}`}</span>
        </div>
        <div style={eventCardMetaStyle}>{event.date || event.datetime || ""}</div>
        <div style={{ ...eventCardMetaStyle, whiteSpace: "pre-wrap" }}>{event.purpose || ""}</div>
      </div>
    </button>
  );
}

function EventPickerModal({
  onClose,
}: {
  onClose: (event: EventPickerRecord | null) => void;
}) {
  const [events, setEvents] = useState<EventPickerRecord[]>([]);
  const [selected, setSelected] = useState<EventPickerRecord | null>(null);
  const [query, setQuery] = useState("");
  const currentMonthKey = getCurrentMonthKey();
  const [monthFilter, setMonthFilter] = useState(() => getCurrentMonthKey());
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await fetchEvents();
        if (active) {
          setEvents(payload);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "获取活动失败");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const filteredEvents = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return events.filter((event) => {
      const eventMonthKey = getEventMonthKey(event) || "unknown";
      if (eventMonthKey !== monthFilter) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const text = [event.event_name, event.purpose, event.date, event.datetime]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(keyword);
    });
  }, [events, monthFilter, query]);

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filteredEvents.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  return (
    <div style={overlayStyle} onClick={() => onClose(null)}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Event Picker</div>
            <h3 style={titleStyle}>选择活动</h3>
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={() => onClose(null)}>
            关闭
          </button>
        </div>

        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="搜索活动名称 / 目的 / 日期"
          style={searchInputStyle}
        />

        <div style={monthFilterSectionStyle}>
          <div style={monthFilterLabelStyle}>月份筛选</div>
          <div style={monthNavigatorStyle}>
            <button
              type="button"
              style={monthFilterButtonStyle}
              onClick={() => {
                setMonthFilter((current) => shiftMonthKey(current, -1));
                setPage(0);
              }}
            >
              上个月
            </button>
            <button
              type="button"
              style={{
                ...monthFilterButtonStyle,
                ...(monthFilter === currentMonthKey ? monthFilterButtonActiveStyle : null),
              }}
              onClick={() => {
                setMonthFilter(currentMonthKey);
                setPage(0);
              }}
            >
              这个月
            </button>
            <button
              type="button"
              style={monthFilterButtonStyle}
              onClick={() => {
                setMonthFilter((current) => shiftMonthKey(current, 1));
                setPage(0);
              }}
            >
              下个月
            </button>
            <div style={monthCurrentLabelStyle}>{formatMonthLabel(monthFilter)}</div>
          </div>
        </div>

        <div style={infoRowStyle}>
          <div style={selectionInfoStyle}>
            {selected ? `已选择：${selected.event_name || ""} #${selected.id}` : "未选择活动"}
          </div>
          <div style={resultInfoStyle}>{`显示 ${filteredEvents.length} / ${events.length} 个活动`}</div>
        </div>

        {loading ? <div style={stateStyle}>加载中…</div> : null}
        {!loading && error ? <div style={stateStyle}>{error}</div> : null}
        {!loading && !error && !pageItems.length ? <div style={stateStyle}>没有匹配的活动</div> : null}

        {!loading && !error && pageItems.length ? (
          <>
            <div style={gridStyle}>
              {pageItems.map((event) => (
                <EventCard key={event.id} event={event} selected={selected?.id === event.id} onSelect={setSelected} />
              ))}
            </div>

            <div style={paginationStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={safePage <= 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                上一页
              </button>
              <span style={pageMetaStyle}>{`第 ${safePage + 1} / ${totalPages} 页`}</span>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              >
                下一页
              </button>
            </div>
          </>
        ) : null}

        <div style={footerStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={() => onClose(null)}>
            取消
          </button>
          <button type="button" style={primaryButtonStyle} disabled={!selected} onClick={() => onClose(selected)}>
            确认选择
          </button>
        </div>
      </div>
    </div>
  );
}

export function showEventPicker() {
  return new Promise<EventPickerRecord | null>((resolve) => {
    openOverlay((close) => (
      <EventPickerModal
        onClose={(event) => {
          close();
          resolve(event);
        }}
      />
    ));
  });
}

const overlayStyle = {
  position: "fixed" as const,
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px",
  background: "rgba(15, 23, 42, 0.52)",
};

const modalStyle = {
  width: "min(980px, 100%)",
  maxHeight: "88vh",
  overflowY: "auto" as const,
  padding: "12px",
  borderRadius: "8px",
  background: "#ffffff",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "8px",
  marginBottom: "10px",
};

const eyebrowStyle = {
  marginBottom: "8px",
  fontSize: "11px",
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "#64748b",
};

const titleStyle = {
  margin: 0,
  fontSize: "18px",
  fontWeight: 900,
  color: "#0f172a",
};

const searchInputStyle = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  background: "#fff",
  boxSizing: "border-box" as const,
};

const selectionInfoStyle = {
  fontSize: "13px",
  color: "#475569",
  fontWeight: 700,
};

const monthFilterSectionStyle = {
  marginTop: "12px",
};

const monthFilterLabelStyle = {
  marginBottom: "8px",
  fontSize: "12px",
  fontWeight: 700,
  color: "#475569",
};

const monthNavigatorStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "8px",
  alignItems: "center",
};

const monthFilterButtonStyle = {
  padding: "5px 8px",
  borderRadius: "6px",
  border: "1px solid rgba(148, 163, 184, 0.32)",
  background: "#fff",
  color: "#334155",
  fontWeight: 700,
  cursor: "pointer",
};

const monthFilterButtonActiveStyle = {
  border: "1px solid rgba(37, 99, 235, 0.28)",
  background: "linear-gradient(135deg, rgba(37,99,235,0.12), rgba(79,70,229,0.16))",
  color: "#1d4ed8",
};

const monthCurrentLabelStyle = {
  padding: "5px 4px",
  fontSize: "13px",
  fontWeight: 800,
  color: "#0f172a",
};

const infoRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap" as const,
  marginTop: "12px",
  marginBottom: "12px",
};

const resultInfoStyle = {
  fontSize: "12px",
  color: "#64748b",
  fontWeight: 700,
};

const stateStyle = {
  padding: "18px 10px",
  textAlign: "center" as const,
  color: "#64748b",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "8px",
};

const eventCardStyle = {
  position: "relative" as const,
  minHeight: "150px",
  border: "none",
  borderRadius: "8px",
  overflow: "hidden",
  cursor: "pointer",
  background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(99,102,241,0.14))",
  boxShadow: "none",
  textAlign: "left" as const,
};

const eventCardSelectedStyle = {
  boxShadow: "0 0 0 3px rgba(59,130,246,0.45), 0 18px 34px rgba(59,130,246,0.22)",
};

const eventCardOverlayStyle = {
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "flex-end",
  minHeight: "150px",
  padding: "10px",
  color: "#fff",
  background: "linear-gradient(to top, rgba(15,23,42,0.84), rgba(15,23,42,0.06))",
};

const eventCardTopRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  gap: "10px",
};

const eventCardTitleStyle = {
  margin: 0,
  fontSize: "16px",
  lineHeight: 1.25,
  fontWeight: 900,
};

const eventIdStyle = {
  fontSize: "12px",
  fontWeight: 900,
  opacity: 0.92,
};

const eventCardMetaStyle = {
  marginTop: "6px",
  fontSize: "12px",
  opacity: 0.92,
};

const paginationStyle = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "10px",
  marginTop: "14px",
  flexWrap: "wrap" as const,
};

const pageMetaStyle = {
  fontSize: "13px",
  color: "#475569",
  fontWeight: 700,
};

const footerStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "18px",
};

const primaryButtonStyle = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, #2563eb, #4f46e5)",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  background: "#fff",
  color: "#0f172a",
  fontWeight: 700,
  cursor: "pointer",
};
