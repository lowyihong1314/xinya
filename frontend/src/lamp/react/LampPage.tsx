import { CSSProperties, useEffect, useMemo, useState } from "react";

import { useUserState } from "../../app/UserState";
import { showConfirmDialog } from "../../js/dialogs";
import { get_phone_on_localhost } from "../../js/get_phone_on_localhost";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { takeLegacyLampPaymentSelection } from "../legacyPaymentSelection";
import {
  deleteLampRegistration,
  fetchAllRegistrations,
  fetchLampByIds,
  registerLamp,
} from "./api";
import { LampPaymentPage } from "./LampPaymentPage";

type LampDraft = {
  id?: number;
  devotee_name?: string;
  address?: string;
  phone?: string;
  total_amount?: number | string;
  lamps?: Array<{ lamp_type: string; gong_zai_amount?: string | number }>;
  payments?: Array<{ amount?: number | string }>;
};

type LampAdminRow = {
  id: number;
  devotee_name?: string;
  phone?: string;
  total_amount?: number | string;
  created_at?: string;
};

type LampFormState = {
  devotee_name: string;
  address: string;
  lamp_168: boolean;
  lamp_88: boolean;
  gong_zai: boolean;
  gong_zai_amount: string;
};

type ToastState = { type: "success" | "error"; text: string } | null;

function loadDrafts(): LampDraft[] {
  try {
    const raw = localStorage.getItem("lamp_drafts");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: LampDraft[]) {
  localStorage.setItem("lamp_drafts", JSON.stringify(drafts));
}

function createInitialForm(): LampFormState {
  return {
    devotee_name: "",
    address: "",
    lamp_168: false,
    lamp_88: false,
    gong_zai: false,
    gong_zai_amount: "",
  };
}

export function LampPage() {
  useEnsureDesignTokens();

  const { user } = useUserState();
  const isAuthenticated = Boolean(user);
  const [phone, setPhone] = useState("");
  const [drafts, setDrafts] = useState<LampDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mode, setMode] = useState<"drafts" | "new" | "admin">("drafts");
  const [adminRows, setAdminRows] = useState<LampAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [form, setForm] = useState<LampFormState>(createInitialForm());
  const [paymentDrafts, setPaymentDrafts] = useState<LampDraft[] | null>(null);

  useEffect(() => {
    const pendingPaymentDrafts = takeLegacyLampPaymentSelection<LampDraft>();
    if (pendingPaymentDrafts?.length) {
      setPaymentDrafts(pendingPaymentDrafts);
      return;
    }

    void loadInitial();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedDrafts = useMemo(
    () => drafts.filter((draft) => selectedIds.includes(draft.id)),
    [drafts, selectedIds],
  );

  const selectedTotal = useMemo(
    () =>
      selectedDrafts.reduce((sum, draft) => {
        const total = Number(draft.total_amount || 0);
        const paid = (draft.payments || []).reduce((acc, payment) => acc + Number(payment.amount || 0), 0);
        return sum + Math.max(0, total - paid);
      }, 0),
    [selectedDrafts],
  );

  async function loadInitial() {
    setLoading(true);
    try {
      const detectedPhone = await get_phone_on_localhost(undefined, { poster: "/static/poster/lamp.png" });
      setPhone((detectedPhone || "").trim());

      const localDrafts = loadDrafts();
      if (!localDrafts.length) {
        setDrafts([]);
        setSelectedIds([]);
        setMode("new");
        return;
      }

      const ids = localDrafts.map((draft) => draft.id).filter(Boolean);
      if (!ids.length) {
        setDrafts(localDrafts);
        setSelectedIds(localDrafts.map((draft) => draft.id).filter(Boolean));
        return;
      }

      const payload = await fetchLampByIds(ids);
      const freshRows = Array.isArray(payload.data) ? payload.data : [];
      const idSet = new Set(freshRows.map((row) => row.id));
      const merged = localDrafts
        .filter((draft) => !draft.id || idSet.has(draft.id))
        .map((draft) => freshRows.find((row) => row.id === draft.id) || draft);

      saveDrafts(merged);
      setDrafts(merged);
      setSelectedIds(merged.map((draft) => draft.id).filter(Boolean));
      setMode(merged.length ? "drafts" : "new");
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取点灯数据失败" });
    } finally {
      setLoading(false);
    }
  }

  async function submitForm() {
    if (!form.devotee_name.trim()) {
      setToast({ type: "error", text: "请填写祈福者姓名" });
      return;
    }

    const lamps = [];
    if (form.lamp_168) lamps.push({ lamp_type: "lamp_168" });
    if (form.lamp_88) lamps.push({ lamp_type: "lamp_88" });
    if (form.gong_zai) {
      if (!form.gong_zai_amount || Number(form.gong_zai_amount) <= 0) {
        setToast({ type: "error", text: "请填写供斋金额" });
        return;
      }
      lamps.push({ lamp_type: "gong_zai", gong_zai_amount: form.gong_zai_amount });
    }

    if (!lamps.length) {
      setToast({ type: "error", text: "请至少选择一项供灯 / 供斋" });
      return;
    }

    try {
      const payload = await registerLamp({
        devotee_name: form.devotee_name.trim(),
        address: form.address,
        phone,
        lamps,
      });

      const nextDraft: LampDraft = {
        id: payload.data?.id,
        devotee_name: payload.data?.devotee_name || form.devotee_name.trim(),
        address: form.address,
        phone,
        total_amount: payload.data?.total_amount,
        lamps,
        payments: [],
      };

      const nextDrafts = [...drafts, nextDraft];
      saveDrafts(nextDrafts);
      setDrafts(nextDrafts);
      setSelectedIds(nextDrafts.map((draft) => draft.id).filter(Boolean));
      setForm(createInitialForm());
      setMode("drafts");
      setToast({ type: "success", text: "报名成功，功德无量" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "提交失败" });
    }
  }

  async function removeDraft(id) {
    if (!(await showConfirmDialog({ message: "确认删除这笔点灯记录吗？", tone: "danger" }))) return;
    try {
      await deleteLampRegistration(id);
      const nextDrafts = drafts.filter((draft) => draft.id !== id);
      saveDrafts(nextDrafts);
      setDrafts(nextDrafts);
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      setToast({ type: "success", text: "记录已删除" });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "删除失败" });
    }
  }

  async function openAdmin() {
    try {
      const payload = await fetchAllRegistrations();
      setAdminRows(Array.isArray(payload.data) ? payload.data : []);
      setMode("admin");
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "读取报名记录失败" });
    }
  }

  if (paymentDrafts) {
    return (
      <LampPaymentPage
        selected={paymentDrafts}
        onBack={() => {
          setPaymentDrafts(null);
          void loadInitial();
        }}
        onCompleted={async () => {
          setPaymentDrafts(null);
          await loadInitial();
        }}
      />
    );
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Lamp Registration</div>
          <h2 style={titleStyle}>点灯供佛</h2>
        </div>
        <div style={toolbarStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={() => void loadInitial()}>
            刷新
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={() => setMode("new")}>
            新增点灯
          </button>
          {drafts.length ? (
            <button type="button" style={secondaryButtonStyle} onClick={() => setMode("drafts")}>
              草稿列表
            </button>
          ) : null}
          {isAuthenticated ? (
            <button type="button" style={primaryButtonStyle} onClick={() => void openAdmin()}>
              全部表格
            </button>
          ) : null}
        </div>
      </header>

      {toast ? <div style={toast.type === "success" ? successBannerStyle : errorBannerStyle}>{toast.text}</div> : null}
      {loading ? <div style={placeholderStyle}>读取点灯资料中…</div> : null}

      {!loading && mode === "drafts" ? (
        <section style={cardStyle}>
          <div style={sectionTitleStyle}>尚未完成的点灯记录</div>
          {!drafts.length ? <div style={placeholderStyle}>当前没有未完成记录</div> : null}
          <div style={listStyle}>
            {drafts.map((draft) => {
              const total = Number(draft.total_amount || 0);
              const paid = (draft.payments || []).reduce((acc, payment) => acc + Number(payment.amount || 0), 0);
              const remaining = Math.max(0, total - paid);
              return (
                <label key={draft.id} style={draftRowStyle(remaining <= 0)}>
                  <input
                    type="checkbox"
                    disabled={remaining <= 0}
                    checked={selectedIds.includes(draft.id)}
                    onChange={(event) =>
                      setSelectedIds((prev) =>
                        event.target.checked ? [...prev, draft.id] : prev.filter((item) => item !== draft.id),
                      )
                    }
                  />
                  <div style={{ flex: 1 }}>
                    <div style={draftNameStyle}>{draft.devotee_name}</div>
                    <div style={draftMetaStyle}>
                      {(draft.lamps || []).length} 项供灯 · RM {total.toFixed(2)}
                    </div>
                    {remaining <= 0 ? (
                      <div style={paidStyle}>已完成支付</div>
                    ) : paid > 0 ? (
                      <div style={draftMetaStyle}>已付 RM {paid.toFixed(2)} · 剩余 RM {remaining.toFixed(2)}</div>
                    ) : null}
                  </div>
                  <button type="button" style={miniDangerButtonStyle} onClick={() => void removeDraft(draft.id)}>
                    删除
                  </button>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={!selectedDrafts.length}
            onClick={() => setPaymentDrafts(selectedDrafts)}
          >
            前往支付 · RM {selectedTotal.toFixed(2)}
          </button>
        </section>
      ) : null}

      {!loading && mode === "new" ? (
        <section style={cardStyle}>
          <div style={sectionTitleStyle}>新春点灯供佛</div>
          <div style={formGridStyle}>
            <input
              style={inputStyle}
              placeholder="祈福者姓名"
              value={form.devotee_name}
              onChange={(event) => setForm((prev) => ({ ...prev, devotee_name: event.target.value }))}
            />
            <textarea
              rows={3}
              style={textareaStyle}
              placeholder="地址"
              value={form.address}
              onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
            />
          </div>
          <div style={optionListStyle}>
            <label style={optionStyle}>
              <input
                type="checkbox"
                checked={form.lamp_168}
                onChange={(event) => setForm((prev) => ({ ...prev, lamp_168: event.target.checked }))}
              />
              <span>光明灯 + 供养八大菩萨</span>
              <strong>RM 168</strong>
            </label>
            <label style={optionStyle}>
              <input
                type="checkbox"
                checked={form.lamp_88}
                onChange={(event) => setForm((prev) => ({ ...prev, lamp_88: event.target.checked }))}
              />
              <span>光明灯</span>
              <strong>RM 88</strong>
            </label>
            <label style={optionStyle}>
              <input
                type="checkbox"
                checked={form.gong_zai}
                onChange={(event) => setForm((prev) => ({ ...prev, gong_zai: event.target.checked }))}
              />
              <span>随缘供斋 / 功德金</span>
            </label>
            {form.gong_zai ? (
              <input
                type="number"
                min="1"
                style={inputStyle}
                placeholder="请输入供斋金额（RM）"
                value={form.gong_zai_amount}
                onChange={(event) => setForm((prev) => ({ ...prev, gong_zai_amount: event.target.value }))}
              />
            ) : null}
          </div>
          <button type="button" style={primaryButtonStyle} onClick={() => void submitForm()}>
            提交
          </button>
        </section>
      ) : null}

      {!loading && mode === "admin" ? (
        <section style={cardStyle}>
          <div style={sectionTitleStyle}>点灯报名记录</div>
          <div style={listStyle}>
            {adminRows.map((row) => (
              <div key={row.id} style={adminRowStyle}>
                <div>
                  <div style={draftNameStyle}>{row.devotee_name}</div>
                  <div style={draftMetaStyle}>{row.phone || "-"} · {row.created_at || "-"}</div>
                </div>
                <div style={amountStyle}>RM {Number(row.total_amount || 0).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "24px",
  background:
    "radial-gradient(circle at top, var(--x-color-warning-tint) 0%, transparent 38%), linear-gradient(180deg, var(--x-color-canvas) 0%, var(--x-color-canvas-alt) 100%)",
  display: "grid",
  gap: "18px",
  boxSizing: "border-box",
};
const headerStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", flexWrap: "wrap" };
const eyebrowStyle: CSSProperties = { fontSize: "12px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const titleStyle: CSSProperties = { margin: "8px 0 0", fontSize: "32px", color: "var(--x-color-ink)" };
const toolbarStyle: CSSProperties = { display: "flex", gap: "10px", flexWrap: "wrap" };
const cardStyle: CSSProperties = {
  maxWidth: "720px",
  width: "100%",
  margin: "0 auto",
  padding: "20px",
  borderRadius: "20px",
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 24px 48px var(--x-color-shadow)",
  backdropFilter: "blur(8px)",
  display: "grid",
  gap: "16px",
};
const sectionTitleStyle: CSSProperties = { fontSize: "20px", fontWeight: 900, color: "var(--x-color-ink)" };
const listStyle: CSSProperties = { display: "grid", gap: "10px" };
const draftRowStyle = (disabled: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "12px",
  borderRadius: "12px",
  background: disabled ? "var(--x-color-panel-alt)" : "var(--x-color-warning-tint)",
  border: "1px solid var(--x-color-warning-border)",
  opacity: disabled ? 0.7 : 1,
});
const draftNameStyle: CSSProperties = { fontWeight: 800, color: "var(--x-color-ink)" };
const draftMetaStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const paidStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-success)", fontWeight: 700 };
const amountStyle: CSSProperties = { fontWeight: 800, color: "var(--x-color-accent-strong)" };
const formGridStyle: CSSProperties = { display: "grid", gap: "12px" };
const optionListStyle: CSSProperties = { display: "grid", gap: "10px" };
const optionStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  padding: "12px",
  borderRadius: "12px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
};
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};
const textareaStyle: CSSProperties = { ...inputStyle, resize: "vertical" };
const primaryButtonStyle: CSSProperties = {
  padding: "14px 18px",
  borderRadius: "14px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-accent-strong))",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};
const secondaryButtonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "12px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
  cursor: "pointer",
};
const miniDangerButtonStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-danger)",
  fontWeight: 700,
  cursor: "pointer",
};
const placeholderStyle: CSSProperties = {
  padding: "20px",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  border: "1px solid var(--x-color-line-soft)",
};
const adminRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  padding: "12px",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
};
const successBannerStyle: CSSProperties = { maxWidth: "720px", width: "100%", margin: "0 auto", padding: "14px 16px", borderRadius: "12px", background: "var(--x-color-success-soft)", color: "var(--x-color-success)" };
const errorBannerStyle: CSSProperties = { maxWidth: "720px", width: "100%", margin: "0 auto", padding: "14px 16px", borderRadius: "12px", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" };
