import type { CSSProperties } from "react";

import { ListeningActivityChart } from "./ListeningActivityChart";
import type { ListeningSessionRecord } from "./listeningActivityShared";

export function MusicListeningPanel({
  isMobile,
  loading,
  timezone,
  totalMinutes,
  uniqueListeners,
  sessions,
}: {
  isMobile: boolean;
  loading: boolean;
  timezone: string;
  totalMinutes: number;
  uniqueListeners: number;
  sessions: ListeningSessionRecord[];
}) {
  return (
    <section style={panelShellStyle}>
      <div style={headerStyle(isMobile)}>
        <div>
          <div style={eyebrowStyle}>Listening Activity</div>
          <div style={titleStyle}>最近听歌记录</div>
          <div style={copyStyle}>
            这里专门看最近收听情况和分钟统计。
          </div>
        </div>

        <div style={metricRowStyle(isMobile)}>
          <div style={metricChipStyle}>
            <span style={metricValueStyle}>{uniqueListeners}</span>
            <span style={metricLabelStyle}>位听众</span>
          </div>
          <div style={metricChipStyle}>
            <span style={metricValueStyle}>{totalMinutes}</span>
            <span style={metricLabelStyle}>分钟收听</span>
          </div>
          <div style={metricChipStyle}>
            <span style={metricValueStyle}>{sessions.length}</span>
            <span style={metricLabelStyle}>条记录</span>
          </div>
        </div>
      </div>

      <ListeningActivityChart
        isMobile={isMobile}
        title="歌曲收听图表"
        subtitle={`按歌曲总分钟汇总，悬停 bar 可看每位听众分钟数。时区：${timezone}。`}
        timezone={timezone}
        loading={loading}
        sessions={sessions}
        emptyText="暂时还没有收听记录。"
        defaultCollapsed={false}
      />
    </section>
  );
}

const panelShellStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
};

function headerStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
    gap: "14px",
    alignItems: "center",
  };
}

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight: 800,
  color: "var(--x-color-accent)",
};

const titleStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "28px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const copyStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "14px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
  maxWidth: "62ch",
};

function metricRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : "repeat(3, auto)",
    gap: "8px",
    justifyContent: "end",
  };
}

const metricChipStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  padding: "10px 12px",
  borderRadius: "14px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
};

const metricValueStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 900,
  color: "var(--x-color-accent-strong)",
  lineHeight: 1,
};

const metricLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};
