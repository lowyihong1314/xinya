import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { downloadBlobOrShare, copyTextToClipboard } from "../../js/browserActions";
import { showConfirmDialog } from "../../js/dialogs";
import { correctPhoneInputMY } from "../../js/phone";
import { show_alert } from "../../js/show_alert";
import {
  approvePayment,
  createYlpShareLink,
  deleteYlpOrderItem,
  deleteYlpOrdersBatch,
  downloadYlpPaiwei,
  downloadYlpReceiptImage,
  fetchYlpOrderDetail,
  fetchYlpOrderLogs,
  fetchYlpPayments,
  listYlpRelationOptions,
  previewYlpPaiweiImages,
  updateYlpOrderCustomer,
  updateYlpOrderStatus,
  withdrawPayment,
} from "./api";
import { YlpDrawer, drawerStyles } from "./YlpDrawer";
import { YlpItemModal } from "./YlpItemModal";
import { YlpPaymentModal } from "./YlpPaymentModal";
import { PaymentProofButton } from "./PaymentProof";
import { getUserPermissionNames } from "../../app/permissions";
import { useUserState } from "../../app/UserState";
import { paiweiFieldLabel, paiweiTitleForCode } from "./intake/paiwei";
import { ORDER_STATUS_LABELS, orderStatusLabel, paymentStatusLabel } from "./orderStatus";
import type { YlpOrderDetail, YlpOrderItem, YlpOrderLog, YlpPaiweiTablet, YlpPaymentRecord } from "./types";

// 摘要抽屉（沿用法会那只 ylp-intake-drawer 的外壳与宽度）：
// 除了看，还能改功德主/电话、改状态、增删改牌位项目，以及下载牌位、下载报价单、复制公开链接。
const PAIWEI_FIELD_ORDER = ["owner", "deceased", "relation", "surname", "suffix", "father", "mother", "quantity"];
// 附注已下线：历史数据里零星残留的 note 不再显示
const PAIWEI_HIDDEN_FIELDS = new Set(["note"]);
// 只放订单流程状态；删除不在这里，删除 = 移入 DELETE 版本（见下面的删除按钮）
const STATUS_OPTIONS = ["Draft", "confirm", "paid", "cancel"];

const LOG_ACTION_LABELS: Record<string, string> = {
  create: "新增",
  update: "修改",
  delete: "删除",
  restore: "恢复",
};
const LOG_TARGET_LABELS: Record<string, string> = {
  order: "订单",
  customer: "功德主资料",
  status: "订单状态",
  item: "牌位",
  payment: "付款",
};

function logChipTone(action: string): CSSProperties {
  if (action === "create") return { color: "var(--x-color-success)", borderColor: "rgba(21,128,61,0.28)" };
  if (action === "delete") return { color: "var(--x-color-danger)", borderColor: "rgba(190,18,60,0.28)" };
  return { color: "var(--x-color-accent-strong)", borderColor: "var(--x-color-accent-border)" };
}

export function YlpOrderSummaryDrawer({
  orderId,
  isMobile,
  navbarHeight,
  onClose,
  onOpenDetail,
  onChanged,
}: {
  orderId: number;
  isMobile: boolean;
  navbarHeight: number;
  onClose: () => void;
  onOpenDetail: (orderId: number) => void;
  onChanged?: () => void;
}) {
  const [order, setOrder] = useState<YlpOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ customer_name: "", phone: "", email: "" });
  const [relationOptions, setRelationOptions] = useState<string[]>([]);
  const [itemModal, setItemModal] = useState<{ item: YlpOrderItem | null } | null>(null);
  // 预览牌位：整只抽屉切成预览，顶部换成「返回」
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTablets, setPreviewTablets] = useState<YlpPaiweiTablet[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  // 改动记录：右上角小图标切进来，和预览一样是整只抽屉换内容
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<YlpOrderLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [payments, setPayments] = useState<YlpPaymentRecord[]>([]);
  const [paymentsError, setPaymentsError] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const { user } = useUserState();
  // 审核付款要 account_edit，和后端 /api/payment/review/* 一致
  const canReviewPayment = useMemo(() => getUserPermissionNames(user).has("account_edit"), [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchYlpOrderDetail(orderId);
      const data = res.data || null;
      setOrder(data);
      try {
        setPayments(await fetchYlpPayments(orderId));
        setPaymentsError("");
      } catch (paymentError) {
        setPaymentsError(paymentError instanceof Error ? paymentError.message : "付款记录加载失败");
      }
      setForm({
        customer_name: data?.customer_name || "",
        phone: data?.phone || "",
        email: data?.email || "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取订单失败");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 抽屉是复用的（换订单不会重新挂载），切订单时把预览收回去
  useEffect(() => {
    setPreviewOpen(false);
    setPreviewTablets([]);
    setPreviewError("");
    setLogsOpen(false);
    setLogs([]);
    setLogsError("");
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await listYlpRelationOptions();
        if (!cancelled) setRelationOptions((res.data || []).map((option) => option.label).filter(Boolean));
      } catch {
        /* 关系选项拿不到不影响编辑 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const items = order?.order_items || [];
  const dirty =
    !!order &&
    (form.customer_name.trim() !== (order.customer_name || "") ||
      form.phone.trim() !== (order.phone || "") ||
      form.email.trim() !== (order.email || ""));

  async function run(action: () => Promise<void>, successText?: string) {
    setBusy(true);
    try {
      await action();
      if (successText) show_alert("success", successText);
      onChanged?.();
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const saveCustomer = () =>
    run(async () => {
      await updateYlpOrderCustomer(orderId, {
        customer_name: form.customer_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
      });
      await load();
    }, "订单资料已保存");

  const setStatus = (next: string) =>
    run(async () => {
      if (next === "cancel") {
        const ok = await showConfirmDialog({ message: `确认取消订单 #${orderId}？`, tone: "danger" });
        if (!ok) return;
      }
      await updateYlpOrderStatus(orderId, next);
      await load();
    }, "订单状态已更新");

  const removeItem = (item: YlpOrderItem) =>
    run(async () => {
      const ok = await showConfirmDialog({
        message: `删除「${item.item_name || item.code || "项目"}」？`,
        tone: "danger",
      });
      if (!ok) return;
      await deleteYlpOrderItem(orderId, item.id);
      await load();
    }, "项目已删除");

  const withdrawOne = (paymentId: number) =>
    run(async () => {
      const ok = await showConfirmDialog({
        message: `撤回付款 #${paymentId}？记录会变成「已拒绝」，订单状态不变。`,
        tone: "danger",
      });
      if (!ok) return;
      await withdrawPayment(paymentId);
      await load();
    }, "付款已撤回");

  const approveOne = (paymentId: number) =>
    run(async () => {
      await approvePayment(paymentId);
      await load();
    }, "付款已批准");

  /** 删除订单 = 移入 DELETE 版本（软删除），不是改 status。 */
  const removeOrder = () =>
    run(async () => {
      const ok = await showConfirmDialog({
        message: `删除订单 #${orderId}？会移入「DELETE」版本，切到该版本还能找回或彻底删除。`,
        tone: "danger",
      });
      if (!ok) return;
      const res = await deleteYlpOrdersBatch([orderId]);
      if (res.status === "error") {
        throw new Error(res.message || "删除失败");
      }
      onChanged?.();
      onClose();
    });

  const downloadPaiwei = () =>
    run(async () => {
      const result = await downloadYlpPaiwei(orderId);
      await downloadBlobOrShare(result.blob, result.filename, {
        isMobile,
        title: result.filename,
        text: `订单 #${orderId} 牌位文件`,
      });
    });

  async function openLogs() {
    setLogsOpen(true);
    setPreviewOpen(false);
    setLogsError("");
    setLogsLoading(true);
    try {
      const res = await fetchYlpOrderLogs(orderId);
      setLogs(res.data || []);
      if (!(res.data || []).length) {
        setLogsError("这张订单还没有改动记录（旧数据不会有）");
      }
    } catch (nextError) {
      setLogsError(nextError instanceof Error ? nextError.message : "读取改动记录失败");
    } finally {
      setLogsLoading(false);
    }
  }

  // 后端把牌位 PDF 逐张裁成 JPEG 回来，抽屉里直接看，不用先下载 PDF
  async function openPreview() {
    setPreviewOpen(true);
    setPreviewError("");
    setPreviewTablets([]);
    setPreviewLoading(true);
    try {
      const res = await previewYlpPaiweiImages([orderId]);
      setPreviewTablets(res.data?.tablets || []);
      if (!(res.data?.tablets || []).length) {
        setPreviewError(res.message || "这张订单没有可预览的牌位");
      }
    } catch (nextError) {
      setPreviewError(nextError instanceof Error ? nextError.message : "生成预览失败");
    } finally {
      setPreviewLoading(false);
    }
  }

  const downloadReceipt = () =>
    run(async () => {
      const blob = await downloadYlpReceiptImage(orderId);
      await downloadBlobOrShare(blob, `ylp_order_${orderId}.pdf`, {
        isMobile,
        title: `订单 #${orderId} 报价单`,
        mimeType: "application/pdf",
      });
    });

  // 和订单详情页同一套：拿 token 拼 /#/ylp-shared?token=...，并提示有效天数
  const copyShareLink = () =>
    run(async () => {
      const res = await createYlpShareLink(orderId);
      if (!res.token) throw new Error(res.message || "生成公开链接失败");
      const url = `${window.location.origin}/#/ylp-shared?token=${res.token}`;
      const days = Math.max(1, Math.round((res.expires_in || 0) / 86400));
      await copyTextToClipboard(url);
      show_alert("success", `公开链接已复制（${days} 天内有效）`);
    });

  return (
    <>
      <YlpDrawer
        isMobile={isMobile}
        navbarHeight={navbarHeight}
        title={`订单 #${orderId} · ${previewOpen ? "预览牌位" : logsOpen ? "改动记录" : "摘要"}`}
        hint={
          previewOpen
            ? "打印出来就是这个样子，一张牌位一张图"
            : logsOpen
              ? "谁在什么时候改了什么，从什么改成什么"
              : "可直接改资料与项目，复杂操作请进订单详情"
        }
        actions={
          <>
            {previewOpen || logsOpen ? (
              <button
                type="button"
                style={drawerStyles.button}
                onClick={() => {
                  setPreviewOpen(false);
                  setLogsOpen(false);
                }}
              >
                ← 返回
              </button>
            ) : (
              <>
                <button
                  type="button"
                  style={iconOnlyButtonStyle}
                  title="查看改动记录"
                  aria-label="查看改动记录"
                  onClick={() => void openLogs()}
                >
                  <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
                </button>
                <button type="button" style={drawerStyles.button} onClick={() => onOpenDetail(orderId)}>
                  订单详情
                </button>
              </>
            )}
            <button type="button" style={drawerStyles.buttonMuted} onClick={onClose}>
              关闭
            </button>
          </>
        }
      >
        {logsOpen ? (
          <div style={styles.body}>
            {logsLoading ? <p style={styles.state}>读取中…</p> : null}
            {logsError ? <p style={styles.state}>{logsError}</p> : null}
            {logs.length ? (
              <div style={styles.logList}>
                {logs.map((entry) => (
                  <div key={entry.id} style={styles.logRow}>
                    <div style={styles.logTop}>
                      <span style={{ ...styles.logChip, ...logChipTone(entry.action) }}>
                        {LOG_ACTION_LABELS[entry.action] || entry.action}
                      </span>
                      <span style={styles.logTarget}>{LOG_TARGET_LABELS[entry.target] || entry.target}</span>
                      <span style={styles.logTime}>{entry.created_at}</span>
                    </div>
                    <span style={styles.logSummary}>{entry.summary || entry.field || "—"}</span>
                    <span style={styles.logActor}>
                      <i className="fa-regular fa-user" aria-hidden="true" /> {entry.actor}
                      {entry.phone ? "（手机号验证）" : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <button type="button" style={styles.backButton} onClick={() => setLogsOpen(false)}>
              ← 返回摘要
            </button>
          </div>
        ) : null}

        {previewOpen ? (
          <div style={styles.body}>
            {previewLoading ? <p style={styles.state}>正在生成预览图…</p> : null}
            {previewError ? <p style={styles.error}>{previewError}</p> : null}
            {previewTablets.length ? (
              <div style={styles.previewGrid}>
                {previewTablets.map((tablet, index) => (
                  <div key={tablet.item_id ?? index} style={styles.previewCard}>
                    <img src={tablet.image} alt={paiweiTitleForCode(tablet.code)} style={styles.previewImage} />
                    <span style={styles.previewCaption}>{paiweiTitleForCode(tablet.code)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <button type="button" style={styles.backButton} onClick={() => setPreviewOpen(false)}>
              ← 返回摘要
            </button>
          </div>
        ) : null}

        {!previewOpen && !logsOpen && loading && !order ? <section style={styles.state}>加载中…</section> : null}
        {!previewOpen && !logsOpen && error ? <section style={styles.error}>{error}</section> : null}

        {order && !previewOpen && !logsOpen ? (
          <div style={styles.body}>
            {/* 状态 + 金额：一行搞定 */}
            <div style={styles.row}>
              <select
                value={order.order_status || "Draft"}
                disabled={busy}
                style={styles.statusSelect}
                onChange={(event) => void setStatus(event.target.value)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {ORDER_STATUS_LABELS[option] || option}
                  </option>
                ))}
              </select>
              <span style={styles.payChip}>{`付款 ${paymentStatusLabel(order.status)}`}</span>
              <span style={styles.total}>RM {Number(order.total_amount ?? 0).toFixed(2)}</span>
            </div>

            {/* 功德主 / 电话 / Email：就地编辑 */}
            <div style={styles.fieldGrid}>
              <input
                value={form.customer_name}
                placeholder="功德主"
                disabled={busy}
                style={styles.input}
                onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))}
              />
              <input
                value={form.phone}
                placeholder="联系电话 01X-XXXXXXX"
                disabled={busy}
                style={styles.input}
                onChange={(event) =>
                  setForm((current) => ({ ...current, phone: correctPhoneInputMY(event.target.value) }))
                }
              />
              <input
                value={form.email}
                placeholder="Email（可留空）"
                disabled={busy}
                style={{ ...styles.input, gridColumn: "1 / -1" }}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
              {dirty ? (
                <button type="button" style={styles.saveButton} disabled={busy} onClick={() => void saveCustomer()}>
                  保存资料
                </button>
              ) : null}
            </div>

            {/* 工具条 */}
            <div style={styles.toolRow}>
              <button type="button" style={styles.tool} disabled={busy} onClick={() => void openPreview()}>
                <i className="fa-regular fa-image" aria-hidden="true" /> 预览
              </button>
              <button type="button" style={styles.tool} disabled={busy} onClick={() => void downloadPaiwei()}>
                <i className="fa-solid fa-file-arrow-down" aria-hidden="true" /> 牌位
              </button>
              <button type="button" style={styles.tool} disabled={busy} onClick={() => void downloadReceipt()}>
                <i className="fa-regular fa-file-lines" aria-hidden="true" /> 报价单
              </button>
              <button type="button" style={styles.tool} disabled={busy} onClick={() => void copyShareLink()}>
                <i className="fa-solid fa-link" aria-hidden="true" /> 公开链接
              </button>
              <button
                type="button"
                style={{ ...styles.tool, ...styles.toolDanger }}
                disabled={busy}
                title="移入 DELETE 版本（软删除）"
                onClick={() => void removeOrder()}
              >
                <i className="fa-regular fa-trash-can" aria-hidden="true" /> 删除
              </button>
            </div>

            <div style={styles.sectionHead}>
              <span style={styles.sectionTitle}>{`付款记录（${payments.length}）`}</span>
              <button
                type="button"
                style={styles.addItem}
                disabled={busy}
                onClick={() => setPaymentModalOpen(true)}
              >
                + 新增付款
              </button>
            </div>

            {paymentsError ? <p style={styles.state}>{paymentsError}</p> : null}

            <div style={styles.itemList}>
              {payments.map((payment) => {
                const status = payment.is_approved ? "approved" : String(payment.status || "pending");
                const pending = !payment.is_approved && status.toLowerCase() === "pending";
                return (
                  <div key={payment.id} style={styles.payRow}>
                    <span style={styles.payAmount}>RM {Number(payment.total_price ?? 0).toFixed(2)}</span>
                    <span style={styles.payMeta}>
                      {payment.payment_mode || "-"}　{(payment.created_at || "").slice(0, 16)}
                    </span>
                    {/* 只要有上传凭证就能看，不分付款方式 */}
                    <PaymentProofButton payment={payment} />
                    <span
                      style={{
                        ...styles.payStatus,
                        ...(status === "approved"
                          ? styles.payStatusOk
                          : status === "rejected"
                            ? styles.payStatusBad
                            : styles.payStatusWait),
                      }}
                    >
                      {paymentStatusLabel(status)}
                    </span>
                    {pending ? (
                      <span style={styles.payActions}>
                        {canReviewPayment ? (
                          <button
                            type="button"
                            style={styles.payApprove}
                            disabled={busy}
                            onClick={() => void approveOne(payment.id)}
                          >
                            批准
                          </button>
                        ) : null}
                        <button
                          type="button"
                          style={styles.payWithdraw}
                          disabled={busy}
                          onClick={() => void withdrawOne(payment.id)}
                        >
                          撤回
                        </button>
                      </span>
                    ) : null}
                  </div>
                );
              })}
              {!payments.length && !paymentsError ? <p style={styles.state}>暂无付款记录</p> : null}
            </div>

            <div style={styles.sectionHead}>
              <span style={styles.sectionTitle}>{`牌位项目（${items.length}）`}</span>
              <button type="button" style={styles.addItem} disabled={busy} onClick={() => setItemModal({ item: null })}>
                + 添加
              </button>
            </div>

            <div style={styles.itemList}>
              {items.map((item) => {
                const grouped = item.item_form_data || {};
                const keys = [
                  ...PAIWEI_FIELD_ORDER.filter((key) => (grouped[key] || []).length),
                  ...Object.keys(grouped).filter(
                    (key) =>
                      !PAIWEI_FIELD_ORDER.includes(key) &&
                      !PAIWEI_HIDDEN_FIELDS.has(key) &&
                      (grouped[key] || []).length,
                  ),
                ];
                return (
                  <div key={item.id} style={styles.item}>
                    <div style={styles.itemHead}>
                      <span style={styles.itemCode}>{item.code || "-"}</span>
                      <span style={styles.itemName}>{item.item_name || "未命名项目"}</span>
                      <span style={styles.itemPrice}>RM {Number(item.price ?? 0).toFixed(2)}</span>
                      <button
                        type="button"
                        style={styles.iconButton}
                        title="编辑"
                        disabled={busy}
                        onClick={() => setItemModal({ item })}
                      >
                        <i className="fa-regular fa-pen-to-square" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        style={{ ...styles.iconButton, color: "var(--x-color-danger)" }}
                        title="删除"
                        disabled={busy}
                        onClick={() => void removeItem(item)}
                      >
                        <i className="fa-regular fa-trash-can" aria-hidden="true" />
                      </button>
                    </div>
                    {keys.map((key) => {
                      const values = (grouped[key] || [])
                        .map((entry) => String(entry.val || "").trim())
                        .filter(Boolean);
                      if (!values.length) return null;
                      const label = paiweiFieldLabel(key, item.code);
                      return (
                        <div key={key} style={styles.fieldRow}>
                          <span style={styles.fieldLabel}>{label}</span>
                          <span style={styles.fieldValues}>
                            {values.map((value, index) => (
                              <span key={`${key}-${index}`} style={styles.fieldChip}>
                                {value}
                              </span>
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {!items.length ? <p style={styles.state}>暂无项目内容</p> : null}
            </div>

            <p style={styles.meta}>
              {order.version || "-"}　{order.created_at || "-"}
              {order.maintainer_name ? `　维护 ${order.maintainer_name}` : ""}
            </p>
          </div>
        ) : null}
      </YlpDrawer>

      {paymentModalOpen ? (
        <YlpPaymentModal
          orderId={orderId}
          defaultAmount={Number(order?.total_amount ?? 0)}
          canApprove={canReviewPayment}
          onClose={() => setPaymentModalOpen(false)}
          onSaved={() => {
            setPaymentModalOpen(false);
            void load();
            onChanged?.();
          }}
        />
      ) : null}

      {itemModal ? (
        <YlpItemModal
          orderId={orderId}
          item={itemModal.item}
          relationOptions={relationOptions}
          onClose={() => setItemModal(null)}
          onSaved={() => {
            setItemModal(null);
            void load();
            onChanged?.();
          }}
        />
      ) : null}
    </>
  );
}

const iconOnlyButtonStyle: CSSProperties = {
  width: 30,
  height: 28,
  padding: 0,
  borderRadius: "6px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  cursor: "pointer",
};

const styles: Record<string, CSSProperties> = {
  body: { display: "flex", flexDirection: "column", gap: "8px" },
  logList: { display: "flex", flexDirection: "column", gap: "8px" },
  logRow: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px 10px",
    borderRadius: "10px",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line-soft)",
  },
  logTop: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
  logChip: {
    padding: "1px 8px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    fontSize: "11px",
    fontWeight: 800,
  },
  logTarget: { fontSize: "11.5px", fontWeight: 700, color: "var(--x-color-ink-muted)" },
  logTime: { marginLeft: "auto", fontSize: "11px", color: "var(--x-color-ink-muted)" },
  logSummary: { fontSize: "12.5px", color: "var(--x-color-ink)", overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
  logActor: { fontSize: "11px", color: "var(--x-color-ink-muted)" },
  previewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
    gap: "8px",
  },
  previewCard: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "6px",
    borderRadius: "10px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
  },
  previewImage: {
    width: "100%",
    height: "auto",
    display: "block",
    borderRadius: "6px",
    background: "#fff",
  },
  previewCaption: {
    fontSize: "11px",
    fontWeight: 600,
    textAlign: "center",
    color: "var(--x-color-ink-muted)",
  },
  backButton: {
    marginTop: "4px",
    padding: "8px 12px",
    fontSize: "12.5px",
    fontWeight: 700,
    color: "var(--x-color-ink-muted)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    borderRadius: "8px",
    cursor: "pointer",
  },
  row: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" },
  statusSelect: {
    padding: "5px 8px",
    borderRadius: "7px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12.5px",
    fontWeight: 700,
  },
  payChip: {
    padding: "3px 9px",
    borderRadius: "999px",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line-soft)",
    fontSize: "11.5px",
  },
  total: { marginLeft: "auto", fontSize: "15px", fontWeight: 800, fontFamily: "var(--x-font-mono)" },
  fieldGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "6px 8px",
    borderRadius: "7px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12.5px",
  },
  saveButton: {
    gridColumn: "1 / -1",
    padding: "6px 10px",
    borderRadius: "7px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "12.5px",
    fontWeight: 800,
    cursor: "pointer",
  },
  toolRow: { display: "flex", gap: "6px", flexWrap: "wrap" },
  tool: {
    flex: 1,
    minWidth: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "5px",
    padding: "6px 8px",
    borderRadius: "7px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  toolDanger: {
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
  },
  sectionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" },
  sectionTitle: { fontSize: "12.5px", fontWeight: 800 },
  addItem: {
    padding: "4px 10px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    fontSize: "11.5px",
    fontWeight: 800,
    cursor: "pointer",
  },
  itemList: { display: "flex", flexDirection: "column", gap: "6px" },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "7px",
    borderRadius: "9px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  },
  itemHead: { display: "flex", gap: "5px", alignItems: "center" },
  itemCode: {
    padding: "1px 6px",
    borderRadius: "6px",
    background: "var(--x-color-accent-tint)",
    color: "var(--x-color-accent-strong)",
    fontSize: "11px",
    fontWeight: 800,
  },
  itemName: { flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  itemPrice: { fontSize: "12px", fontWeight: 800, fontFamily: "var(--x-font-mono)" },
  iconButton: {
    width: 24,
    height: 24,
    padding: 0,
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontSize: "11px",
    cursor: "pointer",
    flexShrink: 0,
  },
  fieldRow: { display: "flex", gap: "6px", alignItems: "baseline" },
  fieldLabel: { width: 34, flexShrink: 0, fontSize: "11px", color: "var(--x-color-ink-muted)" },
  fieldValues: { display: "flex", gap: "4px", flexWrap: "wrap" },
  fieldChip: {
    padding: "1px 7px",
    borderRadius: "999px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
    fontSize: "11.5px",
  },
  payRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 8px",
    borderRadius: "8px",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line-soft)",
    flexWrap: "wrap",
  },
  payAmount: { fontSize: "13px", fontWeight: 800, fontFamily: "var(--x-font-mono)" },
  payMeta: { flex: 1, minWidth: 0, fontSize: "11px", color: "var(--x-color-ink-muted)" },
  payStatus: { padding: "1px 8px", borderRadius: "999px", fontSize: "10.5px", fontWeight: 800 },
  payStatusOk: { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" },
  payStatusWait: { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" },
  payStatusBad: { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" },
  payActions: { display: "flex", gap: "4px" },
  payApprove: {
    padding: "3px 9px",
    borderRadius: "6px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "11px",
    fontWeight: 800,
    cursor: "pointer",
  },
  payWithdraw: {
    padding: "3px 9px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
  },
  meta: { margin: 0, fontSize: "11px", color: "var(--x-color-ink-muted)" },
  state: { padding: "10px", textAlign: "center", fontSize: "12.5px", color: "var(--x-color-ink-muted)" },
  error: {
    padding: "8px 10px",
    borderRadius: "8px",
    background: "var(--x-color-danger-soft)",
    border: "1px solid var(--x-color-danger-border)",
    color: "var(--x-color-danger)",
    fontSize: "12.5px",
  },
};
