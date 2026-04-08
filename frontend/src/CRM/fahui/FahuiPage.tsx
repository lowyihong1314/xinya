import { useEffect, useState } from "react";

import { ensureDesignTokens } from "../../theme/designTokens";
import { useUserState } from "../../app/UserState";
import { CachedImage } from "../../components/CachedMedia";
import { LAMP_META } from "../../lamp/render_lamp_init.js";
import { approvePayment, fetchPayments, removePayment } from "./api";
import type { PaymentRecord, RegistrationRecord } from "./types";

const PAGE_SIZE = 8;

type ContextMenuState = {
  payment: PaymentRecord;
  x: number;
  y: number;
};

type DetailState = {
  payment: PaymentRecord;
  edit: boolean;
};

export function FahuiPage() {
  ensureDesignTokens();

  const { isMobile } = useUserState();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);

  useEffect(() => {
    void loadPayments();
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);

    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("scroll", close, true);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!actionMessage) {
      return;
    }

    const timer = window.setTimeout(() => setActionMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredPayments = payments.filter((payment) => {
    if (!normalizedQuery) {
      return true;
    }

    if ((payment.phone || "").toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    if ((payment.payer_name || "").toLowerCase().includes(normalizedQuery)) {
      return true;
    }

    return (payment.registrations || []).some((registration) =>
      (registration.devotee_name || "").toLowerCase().includes(normalizedQuery),
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredPayments.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  async function loadPayments() {
    setLoading(true);
    setError("");

    try {
      const response = await fetchPayments();
      setPayments(response.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(payment: PaymentRecord) {
    setContextMenu(null);
    setError("");

    try {
      await approvePayment(payment.payment_id);
      setPayments((current) =>
        current.map((item) =>
          item.payment_id === payment.payment_id
            ? {
                ...item,
                submitter_id: item.submitter_id ?? 1,
                paid_at: item.paid_at || new Date().toISOString(),
              }
            : item,
        ),
      );
      setActionMessage("审核已通过");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败");
    }
  }

  async function handleRemove(payment: PaymentRecord, mode: "revoke" | "delete") {
    setContextMenu(null);
    setError("");

    const confirmed = window.confirm(mode === "delete" ? "确认删除这笔付款？" : "确认撤销审核？");
    if (!confirmed) {
      return;
    }

    try {
      await removePayment(payment.payment_id);
      setPayments((current) => current.filter((item) => item.payment_id !== payment.payment_id));
      setActionMessage(mode === "delete" ? "付款已删除" : "审核已撤销");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败");
    }
  }

  function renderRegistration(registration: RegistrationRecord, index: number) {
    return (
      <section key={`${registration.devotee_name || "registration"}-${index}`} style={styles.detailSection}>
        <div style={styles.detailSectionTitle}>
          {`报名 #${index + 1} · ${registration.devotee_name || "-"}`}
        </div>
        <div style={styles.detailInfo}>
          <div>{`📞 ${registration.phone || "-"}`}</div>
          <div>{`📍 ${registration.address || "-"}`}</div>
          <div>{`💰 合计：${registration.total_amount ?? "-"}`}</div>
        </div>
        <ul style={styles.lampList}>
          {(registration.lamps || []).map((lamp, lampIndex) => {
            const meta = LAMP_META[lamp.lamp_type] || {};
            const label = meta.withAmount
              ? `${meta.label || lamp.lamp_type}：${lamp.amount ?? "-"}`
              : `${meta.label || lamp.lamp_type}`;

            return <li key={`${lamp.lamp_type}-${lampIndex}`}>{label}</li>;
          })}
        </ul>
      </section>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>Dharma CRM</div>
          <h1 style={styles.title}>法会付款管理</h1>
          <p style={styles.subtitle}>按付款人、电话或祈福者检索，右键执行审核和删除操作。</p>
        </div>

      </div>

      <div style={{ ...styles.toolbar, flexDirection: isMobile ? "column" : "row" }}>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="搜索手机号 / 付款人 / 祈福者"
          style={styles.searchInput}
        />
        <div style={styles.summary}>{`共 ${filteredPayments.length} 条，当前第 ${safePage}/${totalPages} 页`}</div>
      </div>

      {actionMessage ? <div style={styles.toast}>{actionMessage}</div> : null}

      {loading ? <div style={styles.stateCard}>加载中…</div> : null}
      {!loading && error ? <div style={styles.stateCard}>{error}</div> : null}

      {!loading && !error ? (
        <>
          <div style={styles.pagination}>
            {Array.from({ length: totalPages }, (_, index) => {
              const nextPage = index + 1;
              const active = nextPage === safePage;

              return (
                <button
                  key={nextPage}
                  type="button"
                  onClick={() => setPage(nextPage)}
                  style={{
                    ...styles.pageButton,
                    ...(active ? styles.pageButtonActive : null),
                  }}
                >
                  {nextPage}
                </button>
              );
            })}
          </div>

          <div style={styles.grid}>
            {pageItems.map((payment) => {
              const approved = Boolean(payment.submitter_id);
              const registrations = (payment.registrations || [])
                .map((registration) => registration.devotee_name)
                .filter(Boolean)
                .join("、");

              return (
                <article
                  key={payment.payment_id}
                  style={{
                    ...styles.card,
                    ...(approved ? styles.cardApproved : styles.cardPending),
                  }}
                  onClick={() => setDetail({ payment, edit: false })}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      payment,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                >
                  {approved && payment.submitter_id ? (
                    <CachedImage
                      src={`/api/user_control/get_profile_image/${payment.submitter_id}`}
                      cacheKey={`fahui-submitter:${payment.submitter_id}`}
                      resolveRelativeToApi
                      alt=""
                      style={styles.avatar}
                    />
                  ) : null}
                  <div style={styles.cardTitle}>{payment.payer_name || "-"}</div>
                  <div style={styles.cardMeta}>{`📞 ${payment.phone || "-"}`}</div>
                  <div style={styles.cardMeta}>{`💰 ${payment.amount ?? "-"} (${payment.method || "-"})`}</div>
                  <div style={styles.cardRegistrations}>{registrations || "暂无祈福者信息"}</div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      {contextMenu ? (
        <div
          style={{
            ...styles.contextMenu,
            top: contextMenu.y,
            left: contextMenu.x,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            style={styles.menuItem}
            onClick={() => {
              setContextMenu(null);
              setDetail({ payment: contextMenu.payment, edit: true });
            }}
          >
            ✏️ 编辑
          </button>
          <button
            type="button"
            style={{ ...styles.menuItem, ...styles.menuItemApprove }}
            onClick={() =>
              void (contextMenu.payment.submitter_id
                ? handleRemove(contextMenu.payment, "revoke")
                : handleApprove(contextMenu.payment))
            }
          >
            {contextMenu.payment.submitter_id ? "🚫 撤销审核" : "✅ 审核通过"}
          </button>
          <button
            type="button"
            style={{ ...styles.menuItem, ...styles.menuItemDelete }}
            onClick={() => void handleRemove(contextMenu.payment, "delete")}
          >
            🗑 删除
          </button>
        </div>
      ) : null}

      {detail ? (
        <div style={styles.overlay} onClick={() => setDetail(null)}>
          <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalTitle}>{detail.edit ? "付款详情 / 编辑预览" : "付款详情"}</div>
            <DetailField label="付款人姓名" value={detail.payment.payer_name} readOnly={!detail.edit} />
            <DetailField label="付款电话" value={detail.payment.phone} readOnly={!detail.edit} />
            <DetailField label="付款金额" value={detail.payment.amount} readOnly={!detail.edit} />
            <DetailField label="付款方式" value={detail.payment.method} readOnly={!detail.edit} />
            <DetailField label="付款时间" value={detail.payment.paid_at} readOnly={!detail.edit} />
            <DetailField label="创建时间" value={detail.payment.created_at} readOnly={!detail.edit} />
            {(detail.payment.registrations || []).map(renderRegistration)}
            <button type="button" style={styles.closeButton} onClick={() => setDetail(null)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailField({
  label,
  value,
  readOnly,
}: {
  label: string;
  value: number | string | null | undefined;
  readOnly: boolean;
}) {
  return (
    <label style={styles.detailField}>
      <span style={styles.detailLabel}>{label}</span>
      <input value={value ?? ""} readOnly={readOnly} style={styles.detailInput(readOnly)} />
    </label>
  );
}

const styles = {
  page: {
    minHeight: "100%",
    padding: "20px",
    color: "var(--x-color-ink)",
    fontFamily: '"PingFang SC","Microsoft YaHei",var(--x-font-sans)',
    background:
      "radial-gradient(circle at top left, var(--x-color-accent-tint-strong), var(--x-color-canvas) 42%, var(--x-color-canvas-alt) 100%)",
  },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "flex-start",
    padding: "20px",
    borderRadius: "24px",
    background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-accent))",
    color: "white",
    boxShadow: "0 20px 40px var(--x-color-shadow)",
  },
  eyebrow: {
    fontSize: "12px",
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    opacity: 0.84,
    marginBottom: "8px",
  },
  title: {
    margin: 0,
    fontSize: "30px",
    fontWeight: 900,
  },
  subtitle: {
    margin: "10px 0 0",
    maxWidth: "640px",
    lineHeight: 1.6,
    fontSize: "14px",
    color: "rgba(255,255,255,0.84)",
  },
  refreshButton: {
    border: "none",
    borderRadius: "999px",
    padding: "12px 18px",
    background: "white",
    color: "var(--x-color-accent-strong)",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    boxShadow: "0 8px 18px var(--x-color-shadow-soft)",
  },
  toolbar: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    marginTop: "18px",
    marginBottom: "12px",
  },
  searchInput: {
    flex: 1,
    width: "100%",
    padding: "13px 16px",
    borderRadius: "14px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-strongest)",
    boxSizing: "border-box" as const,
    fontSize: "14px",
    color: "var(--x-color-ink)",
  },
  summary: {
    padding: "12px 14px",
    borderRadius: "14px",
    background: "var(--x-color-panel-glass)",
    border: "1px solid var(--x-color-line-soft)",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
    whiteSpace: "nowrap" as const,
  },
  toast: {
    marginBottom: "12px",
    padding: "12px 14px",
    borderRadius: "14px",
    background: "var(--x-color-success-soft)",
    color: "var(--x-color-success)",
    fontWeight: 700,
    border: "1px solid rgba(21, 128, 61, 0.12)",
  },
  stateCard: {
    marginTop: "16px",
    padding: "28px",
    borderRadius: "20px",
    background: "var(--x-color-panel-strong)",
    boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
    border: "1px solid var(--x-color-line-soft)",
    textAlign: "center" as const,
    color: "var(--x-color-ink-muted)",
  },
  pagination: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
    marginBottom: "14px",
  },
  pageButton: {
    minWidth: "40px",
    padding: "8px 12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontWeight: 700,
    cursor: "pointer",
  },
  pageButtonActive: {
    background: "var(--x-color-accent)",
    border: "1px solid var(--x-color-accent)",
    color: "white",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
    gap: "14px",
  },
  card: {
    position: "relative" as const,
    minHeight: "152px",
    padding: "16px",
    borderRadius: "18px",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 14px 30px var(--x-color-shadow-soft)",
    cursor: "pointer",
    transition: "transform 140ms ease, box-shadow 140ms ease",
  },
  cardApproved: {
    background: "linear-gradient(180deg, var(--x-color-success-soft), var(--x-color-panel))",
  },
  cardPending: {
    background: "linear-gradient(180deg, var(--x-color-warning-soft), var(--x-color-panel))",
  },
  avatar: {
    position: "absolute" as const,
    top: "12px",
    right: "12px",
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    objectFit: "cover" as const,
    border: "2px solid var(--x-color-panel)",
    background: "white",
  },
  cardTitle: {
    marginBottom: "6px",
    fontSize: "18px",
    fontWeight: 900,
    paddingRight: "40px",
  },
  cardMeta: {
    fontSize: "13px",
    marginTop: "4px",
    color: "var(--x-color-ink-muted)",
  },
  cardRegistrations: {
    marginTop: "10px",
    fontSize: "12px",
    lineHeight: 1.6,
    color: "var(--x-color-ink-muted)",
  },
  contextMenu: {
    position: "fixed" as const,
    zIndex: 1000,
    minWidth: "168px",
    padding: "6px",
    borderRadius: "14px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 12px 28px var(--x-color-shadow)",
  },
  menuItem: {
    display: "block",
    width: "100%",
    padding: "10px 12px",
    border: "none",
    borderRadius: "10px",
    background: "transparent",
    textAlign: "left" as const,
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    color: "var(--x-color-ink)",
  },
  menuItemApprove: {
    color: "var(--x-color-success)",
  },
  menuItemDelete: {
    color: "var(--x-color-danger)",
  },
  overlay: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 1001,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    background: "rgba(15, 23, 42, 0.42)",
  },
  modal: {
    width: "min(520px, 100%)",
    maxHeight: "90vh",
    overflowY: "auto" as const,
    padding: "20px",
    borderRadius: "20px",
    background: "var(--x-color-panel-strongest)",
    border: "1px solid var(--x-color-line-soft)",
    boxShadow: "0 20px 50px var(--x-color-shadow)",
  },
  modalTitle: {
    marginBottom: "14px",
    fontSize: "20px",
    fontWeight: 900,
    textAlign: "center" as const,
    color: "var(--x-color-ink)",
  },
  detailField: {
    display: "block",
    marginBottom: "12px",
  },
  detailLabel: {
    display: "block",
    marginBottom: "4px",
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--x-color-ink-muted)",
  },
  detailInput: (readOnly: boolean) => ({
    width: "100%",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line)",
    background: readOnly ? "var(--x-color-panel-alt)" : "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    boxSizing: "border-box" as const,
    fontSize: "14px",
  }),
  detailSection: {
    marginTop: "14px",
    paddingTop: "10px",
    borderTop: "1px dashed var(--x-color-line)",
  },
  detailSectionTitle: {
    marginBottom: "6px",
    fontWeight: 800,
    color: "var(--x-color-accent-strong)",
  },
  detailInfo: {
    fontSize: "13px",
    lineHeight: 1.6,
    color: "var(--x-color-ink-muted)",
  },
  lampList: {
    marginTop: "6px",
    paddingLeft: "18px",
    fontSize: "13px",
    color: "var(--x-color-ink)",
  },
  closeButton: {
    marginTop: "18px",
    width: "100%",
    padding: "14px",
    borderRadius: "14px",
    border: "none",
    background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
    color: "white",
    fontWeight: 900,
    fontSize: "15px",
    cursor: "pointer",
  },
};
