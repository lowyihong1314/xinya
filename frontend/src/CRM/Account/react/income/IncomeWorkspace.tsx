import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { FormPayment, FormRecord } from "../../../form/react/types";
import { designTokens } from "../../../../theme/designTokens";
import { fetchRegisterPaymentForms } from "../register/api";

type IncomeMetric = {
  label: string;
  amount: number;
  hint: string;
};

type ActivityPoint = {
  key: string;
  label: string;
  amount: number;
  count: number;
  forms: number;
};

type FormPoint = {
  key: string;
  label: string;
  amount: number;
  count: number;
  activityKey: string;
};

type MonthPoint = {
  key: string;
  label: string;
  amount: number;
  count: number;
};

export function IncomeWorkspace() {
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [selectedActivityKey, setSelectedActivityKey] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextForms = await fetchRegisterPaymentForms();
        if (cancelled) {
          return;
        }
        setForms(nextForms);
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "载入 register income 失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkedForms = useMemo(() => buildCheckedIncomeForms(forms), [forms]);
  const metrics = useMemo(() => buildMetrics(checkedForms), [checkedForms]);
  const activitySeries = useMemo(() => buildActivitySeries(checkedForms), [checkedForms]);
  const activityOptions = useMemo(
    () => [{ key: "all", label: "全部活动" }, ...activitySeries.map((item) => ({ key: item.key, label: item.label }))],
    [activitySeries],
  );
  const monthSeries = useMemo(() => buildMonthSeries(checkedForms), [checkedForms]);
  const formSeries = useMemo(() => buildFormSeries(checkedForms, selectedActivityKey), [checkedForms, selectedActivityKey]);

  if (loading) {
    return <div style={placeholderStyle}>收益数据载入中…</div>;
  }

  if (error && !checkedForms.length) {
    return <div style={errorStyle}>{error}</div>;
  }

  if (!checkedForms.length) {
    return <div style={placeholderStyle}>目前没有 `checked` 的报名付款记录。</div>;
  }

  return (
    <div style={workspaceStyle}>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Income</div>
          <h3 style={titleStyle}>报名收入</h3>
          <div style={subtitleStyle}>只统计 `RegisPayment.status === "checked"`，并按活动与表单整理。</div>
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
          <div style={panelTitleStyle}>月度收入趋势</div>
          <MonthBarChart data={monthSeries} />
        </section>

        <section style={panelStyle}>
          <div style={panelTitleStyle}>活动收入排行</div>
          <ActivityBars data={activitySeries} />
        </section>

        <section style={panelStyle}>
          <div style={panelTitleStyle}>
            {selectedActivityKey === "all" ? "表单收入排行" : "当前活动的表单收入排行"}
          </div>
          <FormBars data={formSeries} />
        </section>
      </div>
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
          <div style={listMetaStyle}>
            {item.count} 笔付款 · {item.forms} 个表单
          </div>
        </div>
      ))}
    </div>
  );
}

function FormBars({ data }: { data: FormPoint[] }) {
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
                background: `linear-gradient(90deg, ${colors.info}, ${colors.accent})`,
                width: `${Math.max((item.amount / maxAmount) * 100, item.amount ? 8 : 0)}%`,
              }}
            />
          </div>
          <div style={listMetaStyle}>{item.count} 笔已确认付款</div>
        </div>
      ))}
      {!data.length ? <div style={emptyStyle}>这个活动下没有已确认的表单收入。</div> : null}
    </div>
  );
}

function buildCheckedIncomeForms(forms: FormRecord[]) {
  return forms
    .map((form) => {
      const checkedPayments = (form.payments || []).filter((payment) => payment.status === "checked");
      return {
        ...form,
        checkedPayments,
        activityKey: buildActivityKey(form),
        activityLabel: buildActivityLabel(form),
      };
    })
    .filter((form) => form.checkedPayments.length > 0);
}

function buildMetrics(forms: Array<FormRecord & { checkedPayments: FormPayment[]; activityKey: string; activityLabel: string }>): IncomeMetric[] {
  const payments = forms.flatMap((form) => form.checkedPayments);
  const total = payments.reduce((sum, payment) => sum + normalizeAmount(payment.price), 0);
  const average = payments.length ? total / payments.length : 0;
  const uniqueActivities = new Set(forms.map((form) => form.activityKey)).size;

  return [
    { label: "总收入", amount: total, hint: `${payments.length} 笔已确认付款` },
    { label: "平均单笔", amount: average, hint: "checked payment 平均值" },
    { label: "活动收入数", amount: uniqueActivities, hint: "有收入的活动数量" },
    { label: "表单收入数", amount: forms.length, hint: "有 checked 付款的表单" },
  ];
}

function buildActivitySeries(forms: Array<FormRecord & { checkedPayments: FormPayment[]; activityKey: string; activityLabel: string }>): ActivityPoint[] {
  const map = new Map<string, ActivityPoint>();

  forms.forEach((form) => {
    const current = map.get(form.activityKey) || {
      key: form.activityKey,
      label: form.activityLabel,
      amount: 0,
      count: 0,
      forms: 0,
    };

    current.amount += form.checkedPayments.reduce((sum, payment) => sum + normalizeAmount(payment.price), 0);
    current.count += form.checkedPayments.length;
    current.forms += 1;
    map.set(form.activityKey, current);
  });

  return Array.from(map.values()).sort((left, right) => right.amount - left.amount);
}

function buildFormSeries(
  forms: Array<FormRecord & { checkedPayments: FormPayment[]; activityKey: string; activityLabel: string }>,
  activityKey: string,
): FormPoint[] {
  return forms
    .filter((form) => activityKey === "all" || form.activityKey === activityKey)
    .map((form) => ({
      key: String(form.id),
      label: form.title || `Form #${form.id}`,
      amount: form.checkedPayments.reduce((sum, payment) => sum + normalizeAmount(payment.price), 0),
      count: form.checkedPayments.length,
      activityKey: form.activityKey,
    }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 8);
}

function buildMonthSeries(forms: Array<FormRecord & { checkedPayments: FormPayment[] }>): MonthPoint[] {
  const payments = forms.flatMap((form) => form.checkedPayments);
  const dates = payments
    .map((payment) => parsePaymentDate(payment))
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
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const monthPayments = payments.filter((payment) => {
      const date = parsePaymentDate(payment);
      if (!date) {
        return false;
      }
      return date.getFullYear() === cursor.getFullYear() && date.getMonth() === cursor.getMonth();
    });

    months.push({
      key,
      label: `${cursor.getMonth() + 1}月`,
      amount: monthPayments.reduce((sum, payment) => sum + normalizeAmount(payment.price), 0),
      count: monthPayments.length,
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function buildActivityKey(form: FormRecord) {
  const eventIds = (form.events || []).map((event) => event.id).filter(Boolean);
  if (eventIds.length) {
    return eventIds.join("-");
  }
  return `form-${form.id}`;
}

function buildActivityLabel(form: FormRecord) {
  const names = (form.events || [])
    .map((event) => event.event_name?.trim())
    .filter((value): value is string => Boolean(value));
  if (names.length) {
    return names.join(" / ");
  }
  return "未关联活动";
}

function parsePaymentDate(payment: FormPayment) {
  const value = payment.date ? `${payment.date}T${payment.time || "00:00:00"}` : null;
  if (!value) {
    return null;
  }
  const nextDate = new Date(value);
  return Number.isNaN(nextDate.getTime()) ? null : nextDate;
}

function normalizeAmount(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
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
  color: colors.accent,
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
  border: active ? `1px solid ${colors.accentBorder}` : `1px solid ${colors.line}`,
  background: active ? colors.accentTint : colors.panel,
  color: active ? colors.accentStrong : colors.ink,
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
  background: `linear-gradient(180deg, ${colors.accent} 0%, ${colors.info} 100%)`,
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
  color: colors.accentStrong,
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
  background: `linear-gradient(90deg, ${colors.accent} 0%, ${colors.accentStrong} 100%)`,
};

const listMetaStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "12px",
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
