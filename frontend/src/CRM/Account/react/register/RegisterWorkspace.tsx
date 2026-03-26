import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { FormPayment } from "../../../form/react/types";
import { designTokens } from "../../../../theme/designTokens";
import { fetchRegisterPaymentForms, updateRegisterPaymentStatus } from "./api";
import { PaymentDetailPanel } from "./PaymentDetailPanel";
import type { RegisterPaymentForm, RegisterPaymentStatus } from "./types";

const STATUS_OPTIONS: Array<{ key: RegisterPaymentStatus; label: string }> = [
  { key: "process", label: "处理中" },
  { key: "checked", label: "已确认" },
  { key: "fail", label: "失败" },
  { key: "all", label: "全部" },
];

export function RegisterWorkspace() {
  const [forms, setForms] = useState<RegisterPaymentForm[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<RegisterPaymentStatus>("process");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextForms = (await fetchRegisterPaymentForms())
          .filter((form) => Array.isArray(form.payments) && form.payments.length > 0)
          .sort((left, right) => (right.payments?.length || 0) - (left.payments?.length || 0));
        if (cancelled) {
          return;
        }
        setForms(nextForms);
        setSelectedFormId((current) => pickDefaultFormId(nextForms, current));
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "载入 payment 失败");
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

  const selectedForm = useMemo(
    () => forms.find((form) => form.id === selectedFormId) ?? forms[0] ?? null,
    [forms, selectedFormId],
  );

  const formPayments = useMemo(
    () => sortPayments(selectedForm?.payments || []),
    [selectedForm],
  );

  const filteredPayments = useMemo(() => {
    if (statusFilter === "all") {
      return formPayments;
    }
    return formPayments.filter((payment) => payment.status === statusFilter);
  }, [formPayments, statusFilter]);

  useEffect(() => {
    setSelectedPaymentId((current) => {
      if (!filteredPayments.length) {
        return null;
      }
      if (current && filteredPayments.some((payment) => payment.id === current)) {
        return current;
      }
      return filteredPayments[0].id;
    });
  }, [filteredPayments]);

  const selectedPayment = useMemo(
    () =>
      filteredPayments.find((payment) => payment.id === selectedPaymentId) ||
      formPayments.find((payment) => payment.id === selectedPaymentId) ||
      null,
    [filteredPayments, formPayments, selectedPaymentId],
  );

  function applyPaymentUpdate(nextPayment: FormPayment) {
    setForms((current) =>
      current.map((form) =>
        form.id !== nextPayment.regis_form_id
          ? form
          : {
              ...form,
              payments: (form.payments || []).map((payment) => (payment.id === nextPayment.id ? nextPayment : payment)),
            },
      ),
    );
  }

  function applyPaymentRemoval(paymentId: number) {
    let nextForms: RegisterPaymentForm[] = [];
    setForms((current) => {
      nextForms = current
        .map((form) => ({
          ...form,
          payments: (form.payments || []).filter((payment) => payment.id !== paymentId),
        }))
        .filter((form) => (form.payments || []).length > 0);
      return nextForms;
    });
    setSelectedFormId((current) => pickDefaultFormId(nextForms, current));
    setSelectedPaymentId((current) => (current === paymentId ? null : current));
  }

  async function handleStatusChange(status: Exclude<RegisterPaymentStatus, "all">) {
    if (!selectedPayment || updating || selectedPayment.status === status) {
      return;
    }
    setUpdating(true);
    setError(null);
    try {
      const payload = await updateRegisterPaymentStatus(selectedPayment.id, status);
      const nextPayment = payload.payment;
      if (!nextPayment) {
        throw new Error("更新付款状态失败");
      }
      applyPaymentUpdate(nextPayment);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "更新付款状态失败");
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return <div style={surfaceStyle}>付款记录载入中…</div>;
  }

  if (error && !forms.length) {
    return <div style={surfaceStyle}>{error}</div>;
  }

  if (!forms.length) {
    return <div style={surfaceStyle}>目前还没有任何报名付款记录。</div>;
  }

  return (
    <div style={workspaceStyle}>
      <section style={sidebarStyle}>
        <div style={panelEyebrowStyle}>Register Payment</div>
        <h3 style={panelTitleStyle}>按报名表分类</h3>
        <div style={panelBodyTextStyle}>先看每个 form 的付款数量和状态，再进入该 form 的 payment 记录。</div>
        <div style={formCardListStyle}>
          {forms.map((form) => {
            const summary = summarizePayments(form.payments || []);
            const active = form.id === selectedForm?.id;
            return (
              <button
                key={form.id}
                type="button"
                style={formCardStyle(active)}
                onClick={() => {
                  setSelectedFormId(form.id);
                  setStatusFilter("process");
                }}
              >
                <div style={formCardHeaderStyle}>
                  <div style={formCardTitleStyle}>{form.title || `Form #${form.id}`}</div>
                  <div style={formCardCountStyle}>{summary.totalCount} 笔</div>
                </div>
                <div style={formCardStatsStyle}>
                  <StatusPill label="处理中" value={summary.processCount} tone="warning" />
                  <StatusPill label="已确认" value={summary.checkedCount} tone="success" />
                  <StatusPill label="失败" value={summary.failCount} tone="danger" />
                </div>
                <div style={formCardFootStyle}>总额 RM {summary.totalAmount.toFixed(2)}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section style={contentStyle}>
        <div style={toolbarStyle}>
          <div>
            <div style={panelEyebrowStyle}>Current Form</div>
            <h3 style={panelTitleStyle}>{selectedForm?.title || "-"}</h3>
          </div>
          <div style={filterTabsStyle}>
            {STATUS_OPTIONS.map((option) => {
              const active = option.key === statusFilter;
              const count = countByStatus(formPayments, option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  style={filterButtonStyle(active)}
                  onClick={() => setStatusFilter(option.key)}
                >
                  {option.label}
                  <span style={filterCountStyle(active)}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <div style={detailLayoutStyle}>
          <div style={paymentListStyle}>
            {filteredPayments.length ? (
              filteredPayments.map((payment) => {
                const active = payment.id === selectedPayment?.id;
                const statusMeta = getStatusMeta(payment.status);
                return (
                  <button
                    key={payment.id}
                    type="button"
                    style={paymentCardStyle(active)}
                    onClick={() => setSelectedPaymentId(payment.id)}
                  >
                    <div style={paymentCardHeadStyle}>
                      <div>
                        <div style={paymentNameStyle}>{payment.name || payment.nric}</div>
                        <div style={paymentMetaStyle}>{payment.nric}</div>
                      </div>
                      <div style={{ ...statusTagStyle, color: statusMeta.text, background: statusMeta.background }}>
                        {statusMeta.label}
                      </div>
                    </div>
                    <div style={paymentGridStyle}>
                      <MetaItem label="金额" value={`RM ${Number(payment.price || 0).toFixed(2)}`} />
                      <MetaItem label="方式" value={payment.payment_mode} />
                      <MetaItem label="日期" value={payment.date} />
                      <MetaItem label="时间" value={payment.time} />
                    </div>
                  </button>
                );
              })
            ) : (
              <div style={emptyStyle}>这个状态下没有 payment 记录。</div>
            )}
          </div>

          <div style={detailPanelStyle}>
            <PaymentDetailPanel
              payment={selectedPayment}
              updatingStatus={updating}
              onStatusChange={handleStatusChange}
              onPaymentUpdated={applyPaymentUpdate}
              onPaymentRemoved={applyPaymentRemoval}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function pickDefaultFormId(forms: RegisterPaymentForm[], current: number | null) {
  if (current && forms.some((form) => form.id === current)) {
    return current;
  }
  const processFirst = forms.find((form) => (form.payments || []).some((payment) => payment.status === "process"));
  return processFirst?.id ?? forms[0]?.id ?? null;
}

function sortPayments(payments: FormPayment[]) {
  return [...payments].sort((left, right) => {
    const leftKey = `${left.date || ""} ${left.time || ""} ${left.id}`;
    const rightKey = `${right.date || ""} ${right.time || ""} ${right.id}`;
    return rightKey.localeCompare(leftKey);
  });
}

function summarizePayments(payments: FormPayment[]) {
  return payments.reduce(
    (summary, payment) => {
      summary.totalCount += 1;
      summary.totalAmount += Number(payment.price || 0);
      if (payment.status === "checked") {
        summary.checkedCount += 1;
      } else if (payment.status === "fail") {
        summary.failCount += 1;
      } else {
        summary.processCount += 1;
      }
      return summary;
    },
    {
      totalCount: 0,
      totalAmount: 0,
      processCount: 0,
      checkedCount: 0,
      failCount: 0,
    },
  );
}

function countByStatus(payments: FormPayment[], status: RegisterPaymentStatus) {
  if (status === "all") {
    return payments.length;
  }
  return payments.filter((payment) => payment.status === status).length;
}

function getStatusMeta(status: FormPayment["status"]) {
  if (status === "checked") {
    return { label: "已确认", text: colors.success, background: colors.successSoft };
  }
  if (status === "fail") {
    return { label: "失败", text: colors.danger, background: colors.dangerSoft };
  }
  return { label: "处理中", text: colors.warning, background: colors.warningSoft };
}

function MetaItem({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div style={metaItemStyle}>
      <div style={metaLabelStyle}>{label}</div>
      <div style={metaValueStyle}>{value == null || value === "" ? "-" : String(value)}</div>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "warning" | "success" | "danger";
}) {
  const meta =
    tone === "success"
      ? { text: colors.success, background: colors.successSoft }
      : tone === "danger"
        ? { text: colors.danger, background: colors.dangerSoft }
        : { text: colors.warning, background: colors.warningSoft };
  return (
    <div style={{ ...statusPillStyle, color: meta.text, background: meta.background }}>
      {label} {value}
    </div>
  );
}

const colors = designTokens.colors;
const radius = designTokens.radius;

const workspaceStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "320px minmax(0, 1fr)",
  gap: "16px",
  minHeight: 0,
  height: "100%",
  maxHeight: "100%",
};

const surfaceStyle: CSSProperties = {
  padding: "24px",
  borderRadius: radius.lg,
  background: colors.panelStrong,
  border: `1px solid ${colors.lineSoft}`,
  color: colors.ink,
};

const sidebarStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: "12px",
  padding: "18px",
  borderRadius: radius.lg,
  background: colors.panelStrong,
  border: `1px solid ${colors.lineSoft}`,
  boxShadow: `0 16px 36px ${colors.shadowSoft}`,
  overflow: "auto",
};

const contentStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: "14px",
  minWidth: 0,
  padding: "18px",
  borderRadius: radius.lg,
  background: colors.panelStrong,
  border: `1px solid ${colors.lineSoft}`,
  boxShadow: `0 16px 36px ${colors.shadowSoft}`,
  overflow: "auto",
};

const panelEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: colors.accent,
  fontWeight: 700,
};

const panelTitleStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "26px",
  color: colors.ink,
};

const panelBodyTextStyle: CSSProperties = {
  color: colors.inkMuted,
  lineHeight: 1.6,
  fontSize: "13px",
};

const formCardListStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const formCardStyle = (active: boolean): CSSProperties => ({
  display: "grid",
  gap: "10px",
  width: "100%",
  padding: "14px",
  borderRadius: radius.md,
  border: active ? `1px solid ${colors.accentBorder}` : `1px solid ${colors.lineSoft}`,
  background: active ? colors.accentTint : colors.panel,
  textAlign: "left",
  cursor: "pointer",
});

const formCardHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
};

const formCardTitleStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "15px",
  fontWeight: 800,
};

const formCardCountStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "12px",
  fontWeight: 700,
};

const formCardStatsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

const formCardFootStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "12px",
};

const statusPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 800,
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "start",
  flexWrap: "wrap",
};

const filterTabsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

const filterButtonStyle = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  borderRadius: "999px",
  border: active ? `1px solid ${colors.accentBorder}` : `1px solid ${colors.line}`,
  background: active ? colors.accentTint : colors.panel,
  color: active ? colors.accentStrong : colors.ink,
  cursor: "pointer",
  fontWeight: 700,
});

const filterCountStyle = (active: boolean): CSSProperties => ({
  minWidth: "20px",
  height: "20px",
  padding: "0 6px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  background: active ? colors.accent : colors.panelAlt,
  color: active ? colors.panel : colors.inkMuted,
  fontSize: "11px",
});

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: radius.sm,
  background: colors.dangerSoft,
  color: colors.danger,
  fontWeight: 700,
};

const detailLayoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.1fr) minmax(320px, 0.9fr)",
  gap: "14px",
  minHeight: 0,
};

const paymentListStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
  alignContent: "start",
  minWidth: 0,
};

const paymentCardStyle = (active: boolean): CSSProperties => ({
  display: "grid",
  gap: "10px",
  width: "100%",
  padding: "14px",
  borderRadius: radius.md,
  border: active ? `1px solid ${colors.info}` : `1px solid ${colors.lineSoft}`,
  background: active ? colors.infoTint : colors.panel,
  textAlign: "left",
  cursor: "pointer",
});

const paymentCardHeadStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "start",
};

const paymentNameStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "15px",
  fontWeight: 800,
};

const paymentMetaStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "12px",
  marginTop: "4px",
};

const paymentGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
  gap: "8px",
};

const metaItemStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
};

const metaLabelStyle: CSSProperties = {
  color: colors.inkMuted,
  fontSize: "11px",
  fontWeight: 700,
  marginBottom: "4px",
};

const metaValueStyle: CSSProperties = {
  color: colors.ink,
  fontSize: "13px",
  wordBreak: "break-word",
};

const detailPanelStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: "14px",
  padding: "16px",
  borderRadius: radius.md,
  background: colors.panelAlt,
  border: `1px solid ${colors.lineSoft}`,
};

const statusTagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "5px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 800,
};

const emptyStyle: CSSProperties = {
  padding: "14px",
  borderRadius: radius.sm,
  background: colors.panel,
  border: `1px solid ${colors.lineSoft}`,
  color: colors.inkMuted,
};
