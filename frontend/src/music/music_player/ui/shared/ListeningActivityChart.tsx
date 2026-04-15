import { useMemo, type CSSProperties } from "react";
import {
  ArcElement,
  Chart as ChartJS,
  Legend,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";

import {
  formatListeningUser,
  type ListeningSessionRecord,
} from "./listeningActivityShared";

ChartJS.register(ArcElement, Tooltip, Legend);

type ListeningActivityChartProps = {
  isMobile?: boolean;
  timezone: string;
  loading: boolean;
  sessions: ListeningSessionRecord[];
  emptyText: string;
};

type AnalysisTone = "teal" | "sky" | "amber" | "rose" | "violet";

type ChartPoint = {
  key: string;
  label: string;
  fullLabel: string;
  value: number;
  detailLines?: string[];
};

type DoughnutCardDefinition = {
  key: string;
  title: string;
  subtitle: string;
  datasetLabel: string;
  valueUnit: string;
  tone: AnalysisTone;
  emptyText: string;
  points: ChartPoint[];
};

type ChartTonePalette = {
  accentText: string;
  slices: string[];
};

type ChartTheme = {
  cardBorder: string;
  cardBackground: string;
  cardShadow: string;
  emptyBorder: string;
  emptyBackground: string;
  tooltipBackground: string;
  tooltipText: string;
  doughnutBorder: string;
  centerValue: string;
  centerLabel: string;
  legendText: string;
  legendMuted: string;
  tones: Record<AnalysisTone, ChartTonePalette>;
};

type ParsedNaiveDate = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const ISO_NAIVE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const DAY_PARTS = [
  {
    key: "late_night",
    label: "深夜",
    fullLabel: "深夜 00:00 - 03:59",
    startHour: 0,
    endHour: 3,
  },
  {
    key: "dawn",
    label: "清晨",
    fullLabel: "清晨 04:00 - 07:59",
    startHour: 4,
    endHour: 7,
  },
  {
    key: "morning",
    label: "上午",
    fullLabel: "上午 08:00 - 11:59",
    startHour: 8,
    endHour: 11,
  },
  {
    key: "afternoon",
    label: "下午",
    fullLabel: "下午 12:00 - 15:59",
    startHour: 12,
    endHour: 15,
  },
  {
    key: "evening",
    label: "傍晚",
    fullLabel: "傍晚 16:00 - 19:59",
    startHour: 16,
    endHour: 19,
  },
  {
    key: "night",
    label: "夜间",
    fullLabel: "夜间 20:00 - 23:59",
    startHour: 20,
    endHour: 23,
  },
] as const;

export function ListeningActivityChart({
  isMobile = false,
  timezone,
  loading,
  sessions,
  emptyText,
}: ListeningActivityChartProps) {
  const theme = useMemo(() => createChartTheme(), []);
  const cards = useMemo<DoughnutCardDefinition[]>(
    () => [
      {
        key: "songs",
        title: "歌曲热度",
        subtitle: "按总收听次数看最近最常被点的歌，剩余项会自动合并成其他。",
        datasetLabel: "收听次数",
        valueUnit: "次",
        tone: "teal",
        emptyText,
        points: buildSongChartPoints(sessions),
      },
      {
        key: "listeners",
        title: "听众贡献",
        subtitle: "按听众累计分钟数汇总，能看出谁听得最多。",
        datasetLabel: "收听分钟",
        valueUnit: "分钟",
        tone: "sky",
        emptyText,
        points: buildListenerChartPoints(sessions),
      },
      {
        key: "periods",
        title: "活跃时段",
        subtitle: `把一天压成几个时段来看，更适合手机上快速判断什么时候最活跃。时区：${timezone}。`,
        datasetLabel: "活跃分钟",
        valueUnit: "分钟",
        tone: "amber",
        emptyText,
        points: buildDayPartChartPoints(sessions),
      },
      {
        key: "weekdays",
        title: "星期分布",
        subtitle: "看一周里哪几天更常有人听歌。",
        datasetLabel: "活跃分钟",
        valueUnit: "分钟",
        tone: "rose",
        emptyText,
        points: buildWeekdayChartPoints(sessions),
      },
      {
        key: "durations",
        title: "单次时长",
        subtitle: "看收听习惯偏向短听、连续听还是长时间循环。",
        datasetLabel: "收听场次",
        valueUnit: "场",
        tone: "violet",
        emptyText,
        points: buildSessionDurationChartPoints(sessions),
      },
    ],
    [emptyText, sessions, timezone],
  );

  const hasData = cards.some((card) => card.points.length > 0);

  if (loading) {
    return <div style={emptyStateStyle(theme)}>收听记录载入中…</div>;
  }

  if (!hasData) {
    return <div style={emptyStateStyle(theme)}>{emptyText}</div>;
  }

  return (
    <div style={chartGridStyle(isMobile)}>
      {cards.map((card) => (
        <DoughnutAnalysisCard
          key={card.key}
          isMobile={isMobile}
          theme={theme}
          definition={card}
        />
      ))}
    </div>
  );
}

function DoughnutAnalysisCard({
  isMobile,
  theme,
  definition,
}: {
  isMobile: boolean;
  theme: ChartTheme;
  definition: DoughnutCardDefinition;
}) {
  const palette = theme.tones[definition.tone];
  const totalValue = definition.points.reduce((sum, point) => sum + point.value, 0);

  const chartData = useMemo<ChartData<"doughnut">>(
    () => ({
      labels: definition.points.map((point) => point.label),
      datasets: [
        {
          label: definition.datasetLabel,
          data: definition.points.map((point) => point.value),
          backgroundColor: definition.points.map(
            (_, index) => palette.slices[index % palette.slices.length],
          ),
          borderColor: theme.doughnutBorder,
          borderWidth: 2,
          hoverOffset: 8,
          spacing: 2,
        },
      ],
    }),
    [definition.datasetLabel, definition.points, palette.slices, theme.doughnutBorder],
  );

  const chartOptions = useMemo<ChartOptions<"doughnut">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: "64%",
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          displayColors: false,
          padding: 12,
          backgroundColor: theme.tooltipBackground,
          titleColor: theme.tooltipText,
          bodyColor: theme.tooltipText,
          titleFont: {
            size: 13,
            weight: 700,
          },
          bodyFont: {
            size: 12,
          },
          callbacks: {
            title(items) {
              const point = definition.points[items[0]?.dataIndex ?? -1];
              return point?.fullLabel || "";
            },
            label(context) {
              const value = Number(context.raw || 0);
              const percent = totalValue
                ? Math.round((value / totalValue) * 100)
                : 0;
              return `${definition.datasetLabel} ${formatMetricValue(value, definition.valueUnit)} (${percent}%)`;
            },
            afterBody(items) {
              const point = definition.points[items[0]?.dataIndex ?? -1];
              return point?.detailLines?.length ? point.detailLines : [];
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
    [definition, theme, totalValue],
  );

  return (
    <section style={chartCardStyle(theme)}>
      <div style={chartTitleBlockStyle}>
        <div style={chartTitleStyle}>{definition.title}</div>
        <p style={chartSubtitleStyle}>{definition.subtitle}</p>
      </div>

      {!definition.points.length ? (
        <div style={chartEmptyStyle(theme)}>{definition.emptyText}</div>
      ) : (
        <div style={chartBodyStyle(isMobile)}>
          <div style={chartCanvasWrapStyle(isMobile)}>
            <Doughnut data={chartData} options={chartOptions} />
            <div style={chartCenterStyle}>
              <div style={chartCenterValueStyle(theme)}>
                {formatCompactValue(totalValue)}
              </div>
              <div style={chartCenterLabelStyle(theme)}>
                {definition.valueUnit}
              </div>
            </div>
          </div>

          <div style={legendListStyle}>
            {definition.points.map((point, index) => {
              const color = palette.slices[index % palette.slices.length];
              const percent = totalValue
                ? Math.round((point.value / totalValue) * 100)
                : 0;

              return (
                <div key={point.key} style={legendItemStyle}>
                  <div style={legendPrimaryStyle}>
                    <span style={legendDotStyle(color)} />
                    <span style={legendLabelStyle(theme)}>{point.label}</span>
                  </div>
                  <span style={legendMetricStyle(theme)}>
                    {formatMetricValue(point.value, definition.valueUnit)} · {percent}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function buildSongChartPoints(
  sessions: ListeningSessionRecord[],
  maxSlices = 5,
): ChartPoint[] {
  const bySong = new Map<
    string,
    {
      fullLabel: string;
      sessionCount: number;
      totalMinutes: number;
      latestEndAt: string;
      listeners: Map<string, { count: number; minutes: number }>;
    }
  >();

  sessions.forEach((session) => {
    const minutes = Math.max(1, Number(session.minute_count || 0));
    const fullLabel = (session.music_title || "未知歌曲").trim() || "未知歌曲";
    const key = session.music_id != null ? `music:${session.music_id}` : `title:${fullLabel}`;
    const current = bySong.get(key) || {
      fullLabel,
      sessionCount: 0,
      totalMinutes: 0,
      latestEndAt: session.end_at,
      listeners: new Map<string, { count: number; minutes: number }>(),
    };

    current.sessionCount += 1;
    current.totalMinutes += minutes;
    if (session.end_at.localeCompare(current.latestEndAt) > 0) {
      current.latestEndAt = session.end_at;
    }

    const listenerLabel = formatListeningUser(session);
    const listener = current.listeners.get(listenerLabel) || { count: 0, minutes: 0 };
    listener.count += 1;
    listener.minutes += minutes;
    current.listeners.set(listenerLabel, listener);

    bySong.set(key, current);
  });

  const points = [...bySong.entries()]
    .sort((a, b) => {
      const countGap = b[1].sessionCount - a[1].sessionCount;
      if (countGap !== 0) {
        return countGap;
      }
      const minuteGap = b[1].totalMinutes - a[1].totalMinutes;
      if (minuteGap !== 0) {
        return minuteGap;
      }
      return b[1].latestEndAt.localeCompare(a[1].latestEndAt);
    })
    .map(([key, value]) => ({
      key,
      label: truncateLabel(value.fullLabel, 12),
      fullLabel: value.fullLabel,
      value: value.sessionCount,
      detailLines: [
        `累计 ${value.totalMinutes} 分钟`,
        ...[...value.listeners.entries()]
          .sort(
            (a, b) =>
              b[1].count - a[1].count ||
              b[1].minutes - a[1].minutes ||
              a[0].localeCompare(b[0], "zh-Hans-CN"),
          )
          .slice(0, 4)
          .map(
            ([label, listener]) =>
              `${label}: ${listener.count} 次 / ${listener.minutes} 分钟`,
          ),
      ],
    }));

  return collapseTailIntoOther(points, maxSlices, "其他歌曲", "次");
}

function buildListenerChartPoints(
  sessions: ListeningSessionRecord[],
  maxSlices = 5,
): ChartPoint[] {
  const byListener = new Map<
    string,
    {
      fullLabel: string;
      totalMinutes: number;
      sessionCount: number;
      latestEndAt: string;
      songs: Map<string, number>;
    }
  >();

  sessions.forEach((session) => {
    const fullLabel = formatListeningUser(session);
    const key = [
      session.user_id ?? "",
      session.username ?? "",
      session.display_name ?? "",
    ].join(":") || fullLabel;
    const current = byListener.get(key) || {
      fullLabel,
      totalMinutes: 0,
      sessionCount: 0,
      latestEndAt: session.end_at,
      songs: new Map<string, number>(),
    };

    const minutes = Math.max(1, Number(session.minute_count || 0));
    const songLabel = (session.music_title || "未知歌曲").trim() || "未知歌曲";
    current.totalMinutes += minutes;
    current.sessionCount += 1;
    current.songs.set(songLabel, (current.songs.get(songLabel) || 0) + minutes);
    if (session.end_at.localeCompare(current.latestEndAt) > 0) {
      current.latestEndAt = session.end_at;
    }

    byListener.set(key, current);
  });

  const points = [...byListener.entries()]
    .sort((a, b) => {
      const minuteGap = b[1].totalMinutes - a[1].totalMinutes;
      if (minuteGap !== 0) {
        return minuteGap;
      }
      return b[1].latestEndAt.localeCompare(a[1].latestEndAt);
    })
    .map(([key, value]) => ({
      key,
      label: truncateLabel(value.fullLabel, 12),
      fullLabel: value.fullLabel,
      value: value.totalMinutes,
      detailLines: [
        `收听 ${value.sessionCount} 次`,
        `涉及 ${value.songs.size} 首歌`,
        ...[...value.songs.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
          .slice(0, 3)
          .map(([song, minutes]) => `${truncateLabel(song, 12)}: ${minutes} 分钟`),
      ],
    }));

  return collapseTailIntoOther(points, maxSlices, "其他听众", "分钟");
}

function buildDayPartChartPoints(sessions: ListeningSessionRecord[]): ChartPoint[] {
  if (!sessions.length) {
    return [];
  }

  const stats = DAY_PARTS.map((part) => ({
    ...part,
    totalMinutes: 0,
    sessionStarts: 0,
  }));

  sessions.forEach((session) => {
    const startDate = toUtcDate(session.start_at);
    if (startDate) {
      const hour = startDate.getUTCHours();
      const startBucket = stats.find(
        (part) => hour >= part.startHour && hour <= part.endHour,
      );
      if (startBucket) {
        startBucket.sessionStarts += 1;
      }
    }

    forEachSessionMinute(session, (date) => {
      const hour = date.getUTCHours();
      const bucket = stats.find(
        (part) => hour >= part.startHour && hour <= part.endHour,
      );
      if (bucket) {
        bucket.totalMinutes += 1;
      }
    });
  });

  return stats
    .filter((part) => part.totalMinutes > 0)
    .map((part) => ({
      key: part.key,
      label: part.label,
      fullLabel: part.fullLabel,
      value: part.totalMinutes,
      detailLines: [`开始收听 ${part.sessionStarts} 次`],
    }));
}

function buildWeekdayChartPoints(sessions: ListeningSessionRecord[]): ChartPoint[] {
  if (!sessions.length) {
    return [];
  }

  const minutesByDay = Array.from({ length: 7 }, () => 0);
  const sessionStartsByDay = Array.from({ length: 7 }, () => 0);

  sessions.forEach((session) => {
    const startDate = toUtcDate(session.start_at);
    if (startDate) {
      sessionStartsByDay[startDate.getUTCDay()] += 1;
    }

    forEachSessionMinute(session, (date) => {
      minutesByDay[date.getUTCDay()] += 1;
    });
  });

  return WEEKDAY_ORDER.map((day) => ({
    key: `weekday:${day}`,
    label: WEEKDAY_LABELS[(day + 6) % 7],
    fullLabel: WEEKDAY_LABELS[(day + 6) % 7],
    value: minutesByDay[day],
    detailLines: [`开始收听 ${sessionStartsByDay[day]} 次`],
  })).filter((point) => point.value > 0);
}

function buildSessionDurationChartPoints(
  sessions: ListeningSessionRecord[],
): ChartPoint[] {
  if (!sessions.length) {
    return [];
  }

  const buckets = [
    { key: "1-5", label: "1-5 分钟", min: 1, max: 5 },
    { key: "6-10", label: "6-10 分钟", min: 6, max: 10 },
    { key: "11-20", label: "11-20 分钟", min: 11, max: 20 },
    { key: "21-40", label: "21-40 分钟", min: 21, max: 40 },
    { key: "41+", label: "41+ 分钟", min: 41, max: Number.POSITIVE_INFINITY },
  ].map((bucket) => ({
    ...bucket,
    sessionCount: 0,
    totalMinutes: 0,
  }));

  sessions.forEach((session) => {
    const minutes = Math.max(1, Number(session.minute_count || 0));
    const bucket = buckets.find(
      (candidate) => minutes >= candidate.min && minutes <= candidate.max,
    );
    if (!bucket) {
      return;
    }
    bucket.sessionCount += 1;
    bucket.totalMinutes += minutes;
  });

  return buckets
    .filter((bucket) => bucket.sessionCount > 0)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      fullLabel: bucket.label,
      value: bucket.sessionCount,
      detailLines: [
        `累计 ${bucket.totalMinutes} 分钟`,
        `平均 ${Math.round(bucket.totalMinutes / bucket.sessionCount)} 分钟/次`,
      ],
    }));
}

function collapseTailIntoOther(
  points: ChartPoint[],
  maxVisible: number,
  otherLabel: string,
  unit: string,
): ChartPoint[] {
  if (points.length <= maxVisible) {
    return points.filter((point) => point.value > 0);
  }

  const visible = points.slice(0, maxVisible);
  const hidden = points.slice(maxVisible).filter((point) => point.value > 0);
  if (!hidden.length) {
    return visible.filter((point) => point.value > 0);
  }

  return [
    ...visible.filter((point) => point.value > 0),
    {
      key: `other:${otherLabel}`,
      label: "其他",
      fullLabel: otherLabel,
      value: hidden.reduce((sum, point) => sum + point.value, 0),
      detailLines: [
        `合并 ${hidden.length} 项`,
        ...hidden
          .slice(0, 4)
          .map((point) => `${point.fullLabel}: ${formatMetricValue(point.value, unit)}`),
      ],
    },
  ];
}

function parseNaiveIso(value?: string | null): ParsedNaiveDate | null {
  if (!value) {
    return null;
  }
  const match = ISO_NAIVE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || "0"),
  };
}

function toUtcDate(value?: string | null): Date | null {
  const parsed = parseNaiveIso(value);
  if (!parsed) {
    return null;
  }
  return new Date(
    Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      parsed.hour,
      parsed.minute,
      parsed.second,
    ),
  );
}

function forEachSessionMinute(
  session: Pick<ListeningSessionRecord, "start_at" | "minute_count">,
  onMinute: (date: Date) => void,
) {
  const startDate = toUtcDate(session.start_at);
  if (!startDate) {
    return;
  }

  const minutes = Math.max(1, Math.round(Number(session.minute_count || 0) || 1));
  for (let offset = 0; offset < minutes; offset += 1) {
    onMinute(new Date(startDate.getTime() + offset * 60_000));
  }
}

function truncateLabel(label: string, maxLength: number) {
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, maxLength)}…`;
}

function formatMetricValue(value: number, unit: string) {
  return `${Math.max(0, Math.round(value))} ${unit}`;
}

function formatCompactValue(value: number) {
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 10_000) {
    return `${(rounded / 10_000).toFixed(1)}w`;
  }
  return String(rounded);
}

function createChartTheme(): ChartTheme {
  return {
    cardBorder: "rgba(15, 23, 42, 0.08)",
    cardBackground:
      "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(244,250,248,0.94))",
    cardShadow: "0 18px 38px rgba(15, 23, 42, 0.06)",
    emptyBorder: "rgba(15, 23, 42, 0.08)",
    emptyBackground: "rgba(255,255,255,0.74)",
    tooltipBackground: "rgba(15, 23, 42, 0.94)",
    tooltipText: "#f8fafc",
    doughnutBorder: "rgba(255, 255, 255, 0.92)",
    centerValue: "#0f172a",
    centerLabel: "rgba(15, 23, 42, 0.58)",
    legendText: "rgba(15, 23, 42, 0.86)",
    legendMuted: "rgba(15, 23, 42, 0.58)",
    tones: {
      teal: {
        accentText: "#0f766e",
        slices: [
          "#14b8a6",
          "#0f766e",
          "#2dd4bf",
          "#0d9488",
          "#5eead4",
          "#99f6e4",
        ],
      },
      sky: {
        accentText: "#1d4ed8",
        slices: [
          "#3b82f6",
          "#2563eb",
          "#60a5fa",
          "#1d4ed8",
          "#93c5fd",
          "#dbeafe",
        ],
      },
      amber: {
        accentText: "#b45309",
        slices: [
          "#f59e0b",
          "#d97706",
          "#fbbf24",
          "#fcd34d",
          "#fef3c7",
          "#92400e",
        ],
      },
      rose: {
        accentText: "#be123c",
        slices: [
          "#f43f5e",
          "#e11d48",
          "#fb7185",
          "#fda4af",
          "#ffe4e6",
          "#881337",
        ],
      },
      violet: {
        accentText: "#7e22ce",
        slices: [
          "#a855f7",
          "#9333ea",
          "#c084fc",
          "#d8b4fe",
          "#f3e8ff",
          "#6b21a8",
        ],
      },
    },
  };
}

function emptyStateStyle(theme: ChartTheme): CSSProperties {
  return {
    padding: "18px 16px",
    borderRadius: "18px",
    border: `1px solid ${theme.emptyBorder}`,
    background: theme.emptyBackground,
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
    textAlign: "center",
  };
}

function chartGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "14px",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
  };
}

function chartCardStyle(theme: ChartTheme): CSSProperties {
  return {
    display: "grid",
    gap: "12px",
    minWidth: 0,
    padding: "16px",
    borderRadius: "18px",
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBackground,
    boxShadow: theme.cardShadow,
  };
}

const chartTitleBlockStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  minWidth: 0,
};

const chartTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const chartSubtitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "12px",
  lineHeight: 1.55,
  color: "var(--x-color-ink-muted)",
};

function chartBodyStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "14px",
    gridTemplateColumns: isMobile ? "1fr" : "220px minmax(0, 1fr)",
    alignItems: "center",
  };
}

function chartCanvasWrapStyle(isMobile: boolean): CSSProperties {
  return {
    position: "relative",
    width: "100%",
    maxWidth: isMobile ? "220px" : "210px",
    aspectRatio: "1 / 1",
    margin: isMobile ? "0 auto" : 0,
  };
}

const chartCenterStyle: CSSProperties = {
  position: "absolute",
  inset: "50% auto auto 50%",
  transform: "translate(-50%, -50%)",
  display: "grid",
  gap: "2px",
  justifyItems: "center",
  pointerEvents: "none",
};

function chartCenterValueStyle(theme: ChartTheme): CSSProperties {
  return {
    fontSize: "22px",
    lineHeight: 1,
    fontWeight: 900,
    color: theme.centerValue,
  };
}

function chartCenterLabelStyle(theme: ChartTheme): CSSProperties {
  return {
    fontSize: "11px",
    fontWeight: 700,
    color: theme.centerLabel,
  };
}

const legendListStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  minWidth: 0,
};

const legendItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  minWidth: 0,
};

const legendPrimaryStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
};

function legendDotStyle(color: string): CSSProperties {
  return {
    width: "10px",
    height: "10px",
    borderRadius: "999px",
    background: color,
    flex: "0 0 auto",
  };
}

function legendLabelStyle(theme: ChartTheme): CSSProperties {
  return {
    minWidth: 0,
    fontSize: "13px",
    fontWeight: 700,
    color: theme.legendText,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

function legendMetricStyle(theme: ChartTheme): CSSProperties {
  return {
    flex: "0 0 auto",
    fontSize: "12px",
    fontWeight: 700,
    color: theme.legendMuted,
    whiteSpace: "nowrap",
  };
}

function chartEmptyStyle(theme: ChartTheme): CSSProperties {
  return {
    padding: "18px 16px",
    borderRadius: "14px",
    border: `1px solid ${theme.emptyBorder}`,
    background: theme.emptyBackground,
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
    textAlign: "center",
  };
}
