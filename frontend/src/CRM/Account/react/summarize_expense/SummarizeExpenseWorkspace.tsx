import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { designTokens } from "../../../../theme/designTokens";
import { fetchClaims } from "../claim/api";
import type { ClaimRecord } from "../claim/types";

type SummaryMetric = {
  label: string;
  amount: number;
  hint: string;
};

type ActivityPoint = {
  key: string;
  label: string;
  amount: number;
  count: number;
};

type MonthPoint = {
  key: string;
  label: string;
  amount: number;
  count: number;
};

export function SummarizeExpenseWorkspace() {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [selectedActivityKey, setSelectedActivityKey] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadClaims() {
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchClaims();
        if (cancelled) {
          return;
        }
        setClaims(Array.isArray(payload.data) ? payload.data : []);
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "载入支出分析失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadClaims();

    return () => {
      cancelled = true;
    };
  }, []);

  const activitySeries = useMemo(() => buildActivitySeries(claims), [claims]);
  const activityOptions = useMemo(
    () => [{ key: "all", label: "全部活动" }, ...activitySeries.map((item) => ({ key: item.key, label: item.label }))],
    [activitySeries],
  );
  const filteredClaims = useMemo(
    () => claims.filter((claim) => selectedActivityKey === "all" || buildActivityKey(claim) === selectedActivityKey),
    [claims, selectedActivityKey],
  );
  const metrics = useMemo(() => buildMetrics(filteredClaims), [filteredClaims]);
  const monthSeries = useMemo(() => buildMonthSeries(filteredClaims), [filteredClaims]);
  const activityClaims = useMemo(() => buildClaimBars(filteredClaims), [filteredClaims]);

  if (loading) {
    return <div style={placeholderStyle}>支出数据载入中…</div>;
  }

  if (error && !claims.length) {
    return <div style={errorStyle}>{error}</div>;
  }

  if (!claims.length) {
    return <div style={placeholderStyle}>目前还没有支出申请记录。</div>;
  }

  return (
    <div style={workspaceStyle}>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Expense</div>
          <h3 style={titleStyle}>活动支出分析</h3>
          <div style={subtitleStyle}>优先按活动归类，没有活动的申请统一归到“未关联活动”。</div>
        </div>
        <div style={filterWrapStyle}>
          {activityOptions.map((option) => {
            const active = option.key === selectedActivityKey;
            return (
              <button
                key={option.key}
                type="button"
                style={filterButtonStyle(active)}
                onClick={() => setSelectedActivityKey(option.key)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={metricGridStyle}>
        {metrics.map((metric) => (
          <div key={metric.label} style={metricCardStyle}>
            <div style={metricLabelStyle}>{metric.label}</div>
            <div style={metricValueStyle}>RM {formatMoney(metric.amount)}</div>
            <div style={metricHintStyle}>{metric.hint}</div>
          </div>
        ))}
      </div>

      <div style={chartGridStyle}>
        <section style={panelStyle}>
          <div style={panelTitleStyle}>活动支出排行</div>
          <ActivityBars data={activitySeries} />
        </section>

        <section style={panelStyle}>
          <div style={panelTitleStyle}>月度支出趋势</div>
          <MonthBarChart data={monthSeries} />
        </section>

        <section style={panelStyle}>
          <div style={panelTitleStyle}>
            {selectedActivityKey === "all" ? "全部申请金额排行" : "当前活动申请金额排行"}
          </div>
          <ClaimBars data={activityClaims} />
        </section>
      </div>
    </div>
  );
}

function ActivityBars({ data }: { data: ActivityPoint[] }) {
  const maxAmount = Math.max(...data.map((item) => item.amount), 1);

  return (
    <div style={listStyle}>
      {data.map((item) => (
        <div key={item.key} style={listItemStyle}>
          <div style={listHeaderStyle}>
            <div style={listLabelStyle}>{item.label}</div>
            <div style={listValueStyle}>RM {formatMoney(item.amount)}</div>
          </div>
          <div style={trackStyle}>
            <div
              style={{
                ...barStyle,
                width: `${Math.max((item.amount / maxAmount) * 100, item.amount ? 8 : 0)}%`,
              }}
            />
          </div>
          <div style={listMetaStyle}>{item.count} 笔申请</div>
        </div>
      ))}
    </div>
  );
}

function MonthBarChart({ data }: { data: MonthPoint[] }) {
  const maxAmount = Math.max(...data.map((item) => item.amount), 1);

  return (
    <div style={monthChartStyle}>
      {data.map((item) => (
        <div key={item.key} style={monthItemStyle}>
          <div style={monthValueStyle}>RM {formatMoney(item.amount)}</div>
          <div style={monthTrackStyle}>
            <div
              style={{
                ...monthBarStyle,
                height: `${Math.max((item.amount / maxAmount) * 100, item.amount ? 12 : 0)}%`,
              }}
            />
          </div>
          <div style={monthLabelStyle}>{item.label}</div>
          <div style={monthCountStyle}>{item.count} 笔</div>
        </div>
      ))}
    </div>
  );
}

function ClaimBars({
  data,
}: {
  data: Array<{ key: string; label: string; amount: number; hint: string }>;
}) {
  const maxAmount = Math.max(...data.map((item) => item.amount), 1);

  return (
    <div style={listStyle}>
      {data.map((item) => (
        <div key={item.key} style={listItemStyle}>
          <div style={listHeaderStyle}>
            <div style={listLabelStyle}>{item.label}</div>
            <div style={listValueStyle}>RM {formatMoney(item.amount)}</div>
          </div>
          <div style={trackStyle}>
            <div
              style={{
                ...barStyle,
                background: `linear-gradient(90deg, ${colors.info} 0%, ${colors.accent} 100%)`,
                width: `${Math.max((item.amount / maxAmount) * 100, item.amount ? 8 : 0)}%`,
              }}
            />
          </div>
          <div style={listMetaStyle}>{item.hint}</div>
        </div>
      ))}
      {!data.length ? <div style={emptyStyle}>这个活动下没有可统计的支出记录。</div> : null}
    </div>
  );
}

function buildMetrics(claims: ClaimRecord[]): SummaryMetric[] {
  const total = claims.reduce((sum, claim) => sum + getClaimAmount(claim), 0);
  const avg = claims.length ? total / claims.length : 0;
  const uniqueActivities = new Set(claims.map((claim) => buildActivityKey(claim))).size;
  const linkedCount = claims.filter((claim) => Boolean(claim.event_id)).length;

  return [
    { label: "总支出", amount: total, hint: `${claims.length} 笔申请` },
    { label: "平均单笔", amount: avg, hint: "当前活动筛选的平均值" },
    { label: "活动分类数", amount: uniqueActivities, hint: "按 event 或未关联活动归类" },
    { label: "已关联活动", amount: linkedCount, hint: "有 event_id 的申请数量" },
  ];
}

function buildActivitySeries(claims: ClaimRecord[]): ActivityPoint[] {
  const map = new Map<string, ActivityPoint>();

  claims.forEach((claim) => {
    const key = buildActivityKey(claim);
    const label = buildActivityLabel(claim);
    const current = map.get(key) || { key, label, amount: 0, count: 0 };
    current.amount += getClaimAmount(claim);
    current.count += 1;
    map.set(key, current);
  });

  return Array.from(map.values()).sort((left, right) => right.amount - left.amount);
}

function buildMonthSeries(claims: ClaimRecord[]): MonthPoint[] {
  const dates = claims
    .map((claim) => parseClaimDate(claim))
    .filter((value): value is Date => value instanceof Date);

  if (!dates.length) {
    return [];
  }

  const minDate = new Date(Math.min(...dates.map((date) => date.getTime())));
  const maxDate = new Date(Math.max(...dates.map((date) => date.getTime())));
  const start = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
  const months: MonthPoint[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const monthClaims = claims.filter((claim) => {
      const date = parseClaimDate(claim);
      return Boolean(date) && date.getFullYear() === cursor.getFullYear() && date.getMonth() === cursor.getMonth();
    });
    months.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      label: `${cursor.getMonth() + 1}月`,
      amount: monthClaims.reduce((sum, claim) => sum + getClaimAmount(claim), 0),
      count: monthClaims.length,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function buildClaimBars(claims: ClaimRecord[]) {
  return [...claims]
    .sort((left, right) => getClaimAmount(right) - getClaimAmount(left))
    .slice(0, 8)
    .map((claim) => ({
      key: String(claim.id),
      label: claim.purpose?.trim() || `申请 #${claim.id}`,
      amount: getClaimAmount(claim),
      hint: `${buildActivityLabel(claim)} · ${claim.department_name || "-"}`,
    }));
}

function buildActivityKey(claim: ClaimRecord) {
  return claim.event_id ? `event-${claim.event_id}` : "unassigned";
}

function buildActivityLabel(claim: ClaimRecord) {
  return claim.event_name?.trim() || (claim.event_id ? `活动 #${claim.event_id}` : "未关联活动");
}

function getClaimAmount(claim: ClaimRecord) {
  const amount = Number(claim.amount || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function parseClaimDate(claim: ClaimRecord) {
  const value = claim.request_date || claim.created_at;
  if (!value) {
    return null;
  }
  const nextDate = new Date(value);
  return Number.isNaN(nextDate.getTime()) ? null : nextDate;
}

function formatMoney(value: number) {
  return value.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const colors = designTokens.colors;
const radius = designTokens.radius;

const workspaceStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  height: "100%",
  maxHeight: "100%",
  minHeight: 0,
  padding: "10px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.lineSoft}`,
  background: colors.panelStrong,
  boxShadow: "none",
  overflow: "auto",
  boxSizing: "border-box",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "start",
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: colors.warning,
  fontWeight: 700,
};

const titleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "20px",
  lineHeight: 1.05,
  color: colors.ink,
};

const subtitleStyle: CSSProperties = {
  marginTop: "4px",
  color: colors.inkMuted,
  lineHeight: 1.6,
  fontSize: "13px",
};

const filterWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

const filterButtonStyle = (active: boolean): CSSProperties => ({
  padding: "5px 8px",
  borderRadius: "6px",
  border: active ? `1px solid ${colors.warningBorder}` : `1px solid ${colors.line}`,
  background: active ? colors.warningSoft : colors.panel,
  color: active ? colors.warning : colors.ink,
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "12px",
});

const metricGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "8px",
};

const metricCardStyle: CSSProperties = {
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
};

const metricLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: colors.inkMuted,
  fontWeight: 700,
};

const metricValueStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "18px",
  color: colors.ink,
  fontWeight: 900,
};

const metricHintStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "12px",
  color: colors.inkMuted,
};

const chartGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "8px",
};

const panelStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  alignContent: "start",
  minHeight: "320px",
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelStrong,
  border: `1px solid ${colors.lineSoft}`,
};

const panelTitleStyle: CSSProperties = {
  color: colors.ink,
  fontWeight: 900,
  fontSize: "16px",
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const listItemStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const listHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
};

const listLabelStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "14px",
  fontWeight: 800,
};

const listValueStyle: CSSProperties = {
  color: colors.warning,
  fontSize: "13px",
  fontWeight: 800,
};

const trackStyle: CSSProperties = {
  height: "12px",
  borderRadius: "999px",
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
  overflow: "hidden",
};

const barStyle: CSSProperties = {
  height: "100%",
  borderRadius: "999px",
  background: `linear-gradient(90deg, ${colors.warning} 0%, ${colors.danger} 100%)`,
};

const listMetaStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "12px",
};

const monthChartStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))",
  gap: "10px",
  alignItems: "end",
  minHeight: "240px",
};

const monthItemStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  alignItems: "end",
};

const monthValueStyle: CSSProperties = {
  fontSize: "11px",
  color: colors.inkMuted,
  textAlign: "center",
};

const monthTrackStyle: CSSProperties = {
  height: "160px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
  padding: "8px",
  display: "flex",
  alignItems: "end",
};

const monthBarStyle: CSSProperties = {
  width: "100%",
  borderRadius: radius.sm,
  background: `linear-gradient(180deg, ${colors.warning} 0%, ${colors.danger} 100%)`,
};

const monthLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: colors.ink,
  textAlign: "center",
  fontWeight: 700,
};

const monthCountStyle: CSSProperties = {
  fontSize: "11px",
  color: colors.inkMuted,
  textAlign: "center",
};

const errorStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: radius.sm,
  border: `1px solid ${colors.dangerBorder}`,
  background: colors.dangerSoft,
  color: colors.danger,
  fontWeight: 700,
};

const placeholderStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minHeight: "180px",
  padding: "14px",
  borderRadius: radius.sm,
  border: `1px dashed ${colors.lineSoft}`,
  background: colors.panelStrong,
  color: colors.inkMuted,
};

const emptyStyle: CSSProperties = {
  padding: "10px",
  borderRadius: radius.sm,
  background: colors.panelAlt,
  color: colors.inkMuted,
  border: `1px solid ${colors.lineSoft}`,
};
