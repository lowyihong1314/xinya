import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import type { Socket } from "socket.io-client";

import { downloadBlobOrShare } from "../../js/browserActions";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { downloadYlpReceiptImage, fetchYlpSharedOrder } from "./api";
import { PaiweiPreviewGrid } from "./PaiweiPreview";
import { getTemplate, summarizeItem, type PaiweiCode } from "./intake/paiwei";
import { PAIWEI_TEMPLATES } from "./intake/paiwei";
import { connectFahuiSocket, fahuiOrderRoom } from "./socket";
import type { YlpOrderDetail, YlpOrderItem } from "./types";

type ItemBoard = { board_id?: number | null; board_name?: string | null; position_label?: string | null };

/** 这个牌位项目现在贴在哪几块板的哪个位置。
 *
 *  一个项目可能印成多张牌位单，同一张单也可能在多块板上出现，所以全部摊平后
 *  按「板 + 位号」去重。公开页只给板名和位号，打印号那类内部编号不露出去。 */
function itemBoards(item: YlpOrderItem): ItemBoard[] {
  const seen = new Set<string>();
  const out: ItemBoard[] = [];
  for (const location of item.item_location || []) {
    for (const board of location.boards || []) {
      if (!board || board.board_id == null) continue;
      const key = `${board.board_id}:${board.position_label ?? "x"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(board);
    }
  }
  return out;
}

function itemTitle(item: YlpOrderItem): string {
  if (item.item_name) {
    return item.item_name;
  }
  const known = PAIWEI_TEMPLATES.some((tpl) => tpl.code === item.code);
  return known ? getTemplate(item.code as PaiweiCode).title : item.code || "牌位";
}

function statusLabel(status?: string | null): { text: string; tone: "ok" | "warn" | "muted" } {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "paid" || normalized === "approved") return { text: "已付款", tone: "ok" };
  if (normalized === "pending") return { text: "付款审核中", tone: "warn" };
  return { text: "未付款", tone: "muted" };
}

export function SharedOrderPage() {
  useEnsureDesignTokens();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token") || "";

  const [order, setOrder] = useState<YlpOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("链接不完整，请联系工作人员重新获取");
      setLoading(false);
      return;
    }
    try {
      const res = await fetchYlpSharedOrder(token);
      if (res.data) {
        setOrder(res.data);
        setError("");
        setRefreshedAt(new Date().toLocaleTimeString());
      } else {
        setError(res.message || "链接不存在或已过期，请联系工作人员重新获取");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // 订单被工作人员调整时实时刷新（socket 房间 fahui:order:<id>）。
  const orderId = order?.id;
  useEffect(() => {
    if (!orderId) {
      return;
    }
    const socket = connectFahuiSocket();
    socketRef.current = socket;
    const joinRoom = () => socket.emit("join_room", { room: fahuiOrderRoom(orderId) });
    socket.on("connect", joinRoom);
    if (socket.connected) {
      joinRoom();
    }
    socket.on("fahui:order_updated", (payload: { order_id?: number }) => {
      if (!payload || payload.order_id === orderId) {
        void load();
      }
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [orderId, load]);

  async function handleDownloadReceipt() {
    if (!orderId) {
      return;
    }
    setReceiptLoading(true);
    try {
      const blob = await downloadYlpReceiptImage(orderId);
      await downloadBlobOrShare(blob, `收据_订单${orderId}.png`, { isMobile: true });
    } catch (receiptError) {
      setError(receiptError instanceof Error ? receiptError.message : "下载收据失败");
    } finally {
      setReceiptLoading(false);
    }
  }


  const status = statusLabel(order?.status);
  const items = order?.order_items || [];

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <p style={styles.eyebrow}>盂兰盆法会 · 订单查看</p>
          <h1 style={styles.title}>{order ? `订单 #${order.id}` : "订单查看"}</h1>
          {order ? (
            <p style={styles.subTitle}>
              此页面为只读，工作人员调整后会自动更新
              {refreshedAt ? `（更新于 ${refreshedAt}）` : ""}
            </p>
          ) : null}
        </header>

        {loading ? <div style={styles.card}>加载中…</div> : null}
        {!loading && error && !order ? <div style={{ ...styles.card, ...styles.errorCard }}>{error}</div> : null}

        {order ? (
          <>
            {error ? <div style={{ ...styles.card, ...styles.errorCard }}>{error}</div> : null}
            <section style={styles.card}>
              <div style={styles.rowBetween}>
                <p style={styles.cardTitle}>订单资料</p>
                <span style={{ ...styles.statusChip, ...styles[`chip_${status.tone}`] }}>{status.text}</span>
              </div>
              <dl style={styles.summaryList}>
                <SummaryRow label="功德主" value={order.customer_name || order.name || "-"} />
                <SummaryRow label="联络人" value={order.name || "-"} />
                <SummaryRow label="电话" value={order.phone || "-"} />
                <SummaryRow label="版本" value={order.version || "-"} />
              </dl>
            </section>

            <section style={styles.card}>
              <div style={styles.rowBetween}>
                <p style={styles.cardTitle}>牌位（{items.length}）</p>
                <span style={styles.total}>合计 RM {order.total_amount ?? 0}</span>
              </div>
              {items.length ? (
                <div style={styles.itemList}>
                  {items.map((item) => {
                    const boards = itemBoards(item);
                    return (
                      <div key={item.id} style={styles.itemCard}>
                        <div style={styles.rowBetween}>
                          <span style={styles.itemName}>{itemTitle(item)}</span>
                          <span style={styles.itemPrice}>RM {item.price ?? 0}</span>
                        </div>
                        <p style={styles.itemSummary}>{summarizeItem(item) || "—"}</p>
                        {/* 板位：功德主到了现场靠这行去板上找自己那张牌位。
                            还没贴上去的说清楚是「还没安排」，别让人白找一趟。 */}
                        {boards.length ? (
                          <div style={styles.boardRow}>
                            {boards.map((board, index) => (
                              <span key={`${board.board_id}-${index}`} style={styles.boardChip}>
                                <i className="fa-solid fa-thumbtack" aria-hidden="true" />{" "}
                                {board.board_name || `板 #${board.board_id}`}
                                {board.position_label ? ` · ${board.position_label}` : ""}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p style={styles.boardPending}>板位尚未安排</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={styles.emptyHint}>暂无牌位内容</p>
              )}
            </section>

            <button type="button" style={styles.primaryButton} onClick={() => setPreviewOpen(true)}>
              预览牌位
            </button>
            {status.tone === "ok" ? (
              <button
                type="button"
                style={{ ...styles.secondaryButton, ...(receiptLoading ? styles.buttonDisabled : {}) }}
                disabled={receiptLoading}
                onClick={() => void handleDownloadReceipt()}
              >
                {receiptLoading ? "生成中…" : "下载收据"}
              </button>
            ) : null}
            <p style={styles.footNote}>如需修改内容，请联系庙方工作人员，调整会即时显示在本页。</p>
          </>
        ) : null}
      </div>

      {previewOpen && orderId ? (
        <div style={styles.previewOverlay} onClick={() => setPreviewOpen(false)}>
          <div style={styles.previewPanel} onClick={(event) => event.stopPropagation()}>
            <div style={styles.previewHead}>
              <span style={styles.cardTitle}>牌位预览</span>
              <div style={styles.previewActions}>
                <button type="button" style={styles.ghostButton} onClick={() => setPreviewOpen(false)}>
                  关闭
                </button>
              </div>
            </div>
            <div style={styles.previewBody}>
              <PaiweiPreviewGrid orderIds={[orderId]} showOrderId={false} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.summaryRow}>
      <dt style={styles.summaryKey}>{label}</dt>
      <dd style={styles.summaryVal}>{value}</dd>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background: "var(--x-color-bg)",
    color: "var(--x-color-ink)",
    padding: "20px 14px 48px",
    boxSizing: "border-box",
  },
  shell: {
    maxWidth: "560px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  header: {
    padding: "8px 4px 0",
  },
  eyebrow: {
    margin: 0,
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--x-color-accent-strong)",
  },
  title: {
    margin: "4px 0 0",
    fontSize: "24px",
    fontWeight: 800,
  },
  subTitle: {
    margin: "6px 0 0",
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  },
  card: {
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
    borderRadius: "var(--x-radius-md)",
    padding: "14px 16px",
    boxShadow: "0 8px 24px var(--x-color-shadow)",
  },
  errorCard: {
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontWeight: 600,
  },
  cardTitle: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 800,
  },
  rowBetween: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
  },
  statusChip: {
    padding: "4px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
  },
  chip_ok: {
    background: "var(--x-color-success-soft, rgba(5,150,105,0.12))",
    color: "var(--x-color-success, #059669)",
  },
  chip_warn: {
    background: "var(--x-color-warning-soft, rgba(217,119,6,0.12))",
    color: "var(--x-color-warning, #d97706)",
  },
  chip_muted: {
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
  },
  summaryList: {
    margin: "12px 0 0",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
  },
  summaryKey: {
    margin: 0,
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
  },
  summaryVal: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 600,
    textAlign: "right",
  },
  total: {
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--x-color-accent-strong)",
  },
  itemList: {
    marginTop: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  itemCard: {
    padding: "10px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line-soft)",
  },
  itemName: {
    fontSize: "14px",
    fontWeight: 700,
  },
  itemPrice: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
  },
  itemSummary: {
    margin: "6px 0 0",
    fontSize: "12px",
    lineHeight: 1.6,
    color: "var(--x-color-ink-muted)",
    whiteSpace: "pre-wrap",
  },
  boardRow: {
    marginTop: "8px",
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "6px",
  },
  boardChip: {
    padding: "2px 9px",
    borderRadius: "999px",
    background: "var(--x-color-panel)",
    border: "1px solid rgba(21, 128, 61, 0.28)",
    color: "var(--x-color-success)",
    fontSize: "12px",
    fontWeight: 700,
  },
  boardPending: {
    margin: "8px 0 0",
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  },
  emptyHint: {
    margin: "12px 0 0",
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
  },
  primaryButton: {
    width: "100%",
    padding: "13px",
    fontSize: "15px",
    fontWeight: 700,
    color: "#fff",
    background: "var(--x-color-accent)",
    border: "none",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: "default",
  },
  secondaryButton: {
    width: "100%",
    padding: "12px",
    fontSize: "14px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    background: "var(--x-color-accent-soft)",
    border: "1px solid var(--x-color-accent-border)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
  },
  ghostButton: {
    padding: "8px 14px",
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--x-color-ink)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
    textDecoration: "none",
  },
  footNote: {
    margin: 0,
    textAlign: "center",
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  },
  previewOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.6)",
    padding: "16px",
  },
  previewPanel: {
    width: "min(720px, 100%)",
    height: "min(86vh, 900px)",
    display: "flex",
    flexDirection: "column",
    background: "var(--x-color-panel)",
    borderRadius: "var(--x-radius-md)",
    overflow: "hidden",
    boxShadow: "0 20px 60px var(--x-color-shadow)",
  },
  previewHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid var(--x-color-line-soft)",
  },
  previewActions: {
    display: "flex",
    gap: "8px",
  },
  previewBody: {
    overflowY: "auto" as const,
    padding: "4px",
  },
};
