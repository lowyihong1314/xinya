import { useMemo, useState, type CSSProperties } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { Bar } from "react-chartjs-2";

import {
  formatListeningUser,
  sumSessionMinutes,
  type ListeningSessionRecord,
} from "./listeningActivity";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type ListeningActivityChartProps = {
  isMobile?: boolean;
  title: string;
  subtitle: string;
  timezone: string;
  loading: boolean;
  sessions: ListeningSessionRecord[];
  emptyText: string;
  defaultCollapsed?: boolean;
};

type SongChartPoint = {
  key: string;
  label: string;
  fullLabel: string;
  totalMinutes: number;
  listeners: Array<{
    label: string;
    minutes: number;
  }>;
};

export function ListeningActivityChart({
  isMobile = false,
  title,
  subtitle,
  timezone,
  loading,
  sessions,
  emptyText,
  defaultCollapsed = true,
}: ListeningActivityChartProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const songPoints = useMemo(() => buildSongChartPoints(sessions), [sessions]);
  const totalMinutes = useMemo(() => sumSessionMinutes(sessions), [sessions]);
  const chartHeight = isMobile ? 300 : 340;
  const chartWidth = Math.max(
    isMobile ? 480 : 720,
    songPoints.length * (isMobile ? 76 : 92),
  );

  const chartData = useMemo(
    () => ({
      labels: songPoints.map((point) => point.label),
      datasets: [
        {
          label: "收听分钟",
          data: songPoints.map((point) => point.totalMinutes),
          borderRadius: 999,
          borderSkipped: false,
          backgroundColor: "rgba(20, 184, 166, 0.88)",
          hoverBackgroundColor: "rgba(15, 118, 110, 0.96)",
          barThickness: isMobile ? 18 : 16,
          maxBarThickness: isMobile ? 20 : 18,
        },
      ],
    }),
    [isMobile, songPoints],
  );

  const chartOptions = useMemo<ChartOptions<"bar">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          displayColors: false,
          padding: 12,
          backgroundColor: "rgba(15, 23, 42, 0.94)",
          titleFont: {
            size: 13,
            weight: "700",
          },
          bodyFont: {
            size: 12,
          },
          callbacks: {
            title(items) {
              const point = songPoints[items[0]?.dataIndex ?? -1];
              return point?.fullLabel || "";
            },
            label(context) {
              const point = songPoints[context.dataIndex];
              return point ? `总时长 ${point.totalMinutes} 分钟` : "";
            },
            afterBody(items) {
              const point = songPoints[items[0]?.dataIndex ?? -1];
              if (!point?.listeners.length) {
                return ["暂无听众数据"];
              }
              return point.listeners.map(
                (listener) => `${listener.label}: ${listener.minutes} 分钟`,
              );
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          border: {
            display: false,
          },
          ticks: {
            autoSkip: false,
            color: "rgba(15, 23, 42, 0.8)",
            maxRotation: isMobile ? 44 : 32,
            minRotation: isMobile ? 44 : 32,
            font: {
              size: isMobile ? 11 : 12,
              weight: "600",
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(15, 23, 42, 0.08)",
          },
          border: {
            display: false,
          },
          ticks: {
            precision: 0,
            color: "rgba(15, 23, 42, 0.6)",
            font: {
              size: 11,
            },
          },
          title: {
            display: true,
            text: "分钟",
            color: "rgba(15, 23, 42, 0.6)",
            font: {
              size: 11,
              weight: "700",
            },
          },
        },
      },
      onHover: (event, activeElements) => {
        const target = event?.native?.target;
        if (target instanceof HTMLCanvasElement) {
          target.style.cursor = activeElements.length ? "pointer" : "default";
        }
      },
    }),
    [isMobile, songPoints],
  );

  return (
    <section style={sectionStyle}>
      <div style={headerStyle(isMobile)}>
        <div style={titleWrapStyle}>
          <div style={titleStyle}>{title}</div>
          <p style={subtitleStyle}>{subtitle}</p>
        </div>
        <div style={metaWrapStyle}>
          <span style={chipStyle}>{songPoints.length} 首歌曲</span>
          <span style={chipStyle}>{totalMinutes} 分钟</span>
          <span style={chipStyle}>{timezone}</span>
          <button
            type="button"
            style={toggleButtonStyle}
            onClick={() => setCollapsed((current) => !current)}
            aria-expanded={!collapsed}
          >
            {collapsed ? "展开图表" : "收起图表"}
          </button>
        </div>
      </div>

      {collapsed ? (
        <div style={collapsedPreviewStyle}>
          {loading
            ? "收听记录载入中…"
            : songPoints.length
              ? `默认收起。展开后按歌曲查看 bar chart，鼠标移到 bar 上才显示谁听了几分钟。`
              : emptyText}
        </div>
      ) : null}

      {!collapsed && loading ? <div style={emptyStateStyle}>收听记录载入中…</div> : null}

      {!collapsed && !loading && !songPoints.length ? (
        <div style={emptyStateStyle}>{emptyText}</div>
      ) : null}

      {!collapsed && !loading && songPoints.length ? (
        <div style={chartScrollerStyle}>
          <div
            style={{
              ...chartWrapStyle,
              height: `${chartHeight}px`,
              width: `${chartWidth}px`,
            }}
          >
            <Bar data={chartData} options={chartOptions} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function buildSongChartPoints(
  sessions: ListeningSessionRecord[],
  maxBars = 12,
): SongChartPoint[] {
  const bySong = new Map<
    string,
    {
      fullLabel: string;
      totalMinutes: number;
      latestEndAt: string;
      listeners: Map<string, number>;
    }
  >();

  sessions.forEach((session) => {
    const minutes = Math.max(1, Number(session.minute_count || 0));
    const fullLabel = (session.music_title || "未知歌曲").trim() || "未知歌曲";
    const key = session.music_id != null ? `music:${session.music_id}` : `title:${fullLabel}`;
    const existing = bySong.get(key) || {
      fullLabel,
      totalMinutes: 0,
      latestEndAt: session.end_at,
      listeners: new Map<string, number>(),
    };

    existing.totalMinutes += minutes;
    if (session.end_at.localeCompare(existing.latestEndAt) > 0) {
      existing.latestEndAt = session.end_at;
    }

    const listenerLabel = formatListeningUser(session);
    existing.listeners.set(
      listenerLabel,
      (existing.listeners.get(listenerLabel) || 0) + minutes,
    );

    bySong.set(key, existing);
  });

  return [...bySong.entries()]
    .sort((a, b) => {
      const totalGap = b[1].totalMinutes - a[1].totalMinutes;
      if (totalGap !== 0) {
        return totalGap;
      }
      return b[1].latestEndAt.localeCompare(a[1].latestEndAt);
    })
    .slice(0, maxBars)
    .map(([key, value]) => ({
      key,
      label: truncateSongLabel(value.fullLabel),
      fullLabel: value.fullLabel,
      totalMinutes: value.totalMinutes,
      listeners: [...value.listeners.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
        .map(([label, minutes]) => ({ label, minutes })),
    }));
}

function truncateSongLabel(label: string) {
  if (label.length <= 18) {
    return label;
  }
  return `${label.slice(0, 18)}…`;
}

const sectionStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "18px",
  borderRadius: "22px",
  border: "1px solid rgba(15, 118, 110, 0.14)",
  background:
    "linear-gradient(180deg, rgba(248,252,251,0.98), rgba(239,247,245,0.98))",
  boxShadow: "0 18px 38px rgba(15, 23, 42, 0.06)",
};

const headerStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  flexDirection: isMobile ? "column" : "row",
  justifyContent: "space-between",
  alignItems: isMobile ? "stretch" : "flex-start",
  gap: "14px",
});

const titleWrapStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const titleStyle: CSSProperties = {
  fontSize: "17px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "13px",
  lineHeight: 1.5,
  color: "var(--x-color-ink-muted)",
};

const metaWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: "8px",
};

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "30px",
  padding: "0 10px",
  borderRadius: "999px",
  background: "rgba(15, 118, 110, 0.1)",
  color: "var(--x-color-accent-strong, #0f766e)",
  fontSize: "12px",
  fontWeight: 700,
};

const toggleButtonStyle: CSSProperties = {
  minHeight: "30px",
  padding: "0 12px",
  borderRadius: "999px",
  border: "1px solid rgba(15, 118, 110, 0.18)",
  background: "white",
  color: "var(--x-color-accent-strong, #0f766e)",
  fontSize: "12px",
  fontWeight: 800,
  cursor: "pointer",
};

const collapsedPreviewStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(255,255,255,0.72)",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

const emptyStateStyle: CSSProperties = {
  padding: "18px 16px",
  borderRadius: "16px",
  background: "rgba(255,255,255,0.72)",
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  textAlign: "center",
};

const chartWrapStyle: CSSProperties = {
  position: "relative",
  padding: "2px 0 4px",
};

const chartScrollerStyle: CSSProperties = {
  width: "100%",
  overflowX: "auto",
  overflowY: "hidden",
  paddingBottom: "4px",
};
