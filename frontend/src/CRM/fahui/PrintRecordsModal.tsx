import { useEffect, useState, type CSSProperties } from "react";

import { listYlpPrintRecords, type YlpPrintRecord } from "./api";
import type { YlpPagination } from "./types";

const PER_PAGE = 20;

function uniqueOrderIds(record: YlpPrintRecord): number[] {
  const seen: number[] = [];
  for (const entry of record.orders || []) {
    if (entry?.order_id && !seen.includes(entry.order_id)) {
      seen.push(entry.order_id);
    }
  }
  return seen;
}

function ownerNames(record: YlpPrintRecord): string {
  const names: string[] = [];
  for (const entry of record.orders || []) {
    const name = (entry?.owner_or_deceased || entry?.customer_name || "").trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names.join("、");
}

export function PrintRecordsModal({
  version,
  onClose,
  onOpenOrder,
}: {
  version: string;
  onClose: () => void;
  onOpenOrder?: (orderId: number) => void;
}) {
  const [records, setRecords] = useState<YlpPrintRecord[]>([]);
  const [pagination, setPagination] = useState<YlpPagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await listYlpPrintRecords(version, page, PER_PAGE);
        if (cancelled) {
          return;
        }
        setRecords(res.items || []);
        setPagination(res.pagination || null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载打印记录失败");
        }
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
  }, [version, page]);

  useEffect(() => {
    setPage(1);
  }, [version]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const totalPages = Math.max(1, pagination?.pages || 1);
  const total = pagination?.total || 0;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <header style={styles.header}>
          <div>
            <h3 style={styles.title}>牌位打印记录</h3>
            <p style={styles.subtitle}>
              {`${version} · 共 ${total} 张已注册二维码的牌位单`}
            </p>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div style={styles.body}>
          <p style={styles.hint}>
            这里就是看板用的那份打印号(Barcode)记录，不是另一份日志。在看板「一键清空未上板」或「重置年度条码」删掉的，这里同步消失；打印号也会被下一次打印复用。
          </p>

          {error ? <div style={styles.errorBox}>{error}</div> : null}
          {loading ? <p style={styles.muted}>加载中…</p> : null}

          {!loading && !error && !records.length ? (
            <p style={styles.muted}>这个版本还没有注册过二维码的牌位单。</p>
          ) : null}

          {!loading && records.length ? (
            <ul style={styles.list}>
              {records.map((record) => {
                const orderIds = uniqueOrderIds(record);
                const owners = ownerNames(record);
                const boards = record.boards || [];

                return (
                  <li key={record.id} style={styles.listItem}>
                    <div style={styles.rowTop}>
                      <span style={styles.pdfId}>{`打印号(Barcode) #${record.id}`}</span>
                      <span style={styles.time}>{record.created_at || "-"}</span>
                    </div>

                    <div style={styles.orderRow}>
                      <span style={styles.label}>订单</span>
                      {orderIds.length ? (
                        orderIds.map((orderId) =>
                          onOpenOrder ? (
                            <button
                              key={orderId}
                              type="button"
                              style={styles.orderChipButton}
                              onClick={() => onOpenOrder(orderId)}
                            >
                              {`#${orderId}`}
                            </button>
                          ) : (
                            <span key={orderId} style={styles.orderChip}>{`#${orderId}`}</span>
                          ),
                        )
                      ) : (
                        <span style={styles.muted}>订单已删除</span>
                      )}
                    </div>

                    {owners ? <p style={styles.owners}>{owners}</p> : null}

                    <div style={styles.boardRow}>
                      {boards.length ? (
                        boards.map((board) => (
                          <span key={`${board.board_id}-${board.location}`} style={styles.boardChip}>
                            {`${board.board_name || "板"} #${board.location ?? "-"}`}
                          </span>
                        ))
                      ) : (
                        <span style={styles.unplacedChip}>未上板</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <footer style={styles.footer}>
          <button
            type="button"
            style={{ ...styles.pageButton, ...(page <= 1 || loading ? styles.disabled : null) }}
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <span style={styles.pageIndicator}>{`${Math.min(page, totalPages)} / ${totalPages}`}</span>
          <button
            type="button"
            style={{ ...styles.pageButton, ...(page >= totalPages || loading ? styles.disabled : null) }}
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            下一页
          </button>
        </footer>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 4000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.55)",
    padding: "16px",
  },
  panel: {
    width: "min(600px, 100%)",
    maxHeight: "88vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--x-color-panel)",
    borderRadius: "var(--x-radius-lg)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "16px 18px",
    borderBottom: "1px solid var(--x-color-line-soft)",
  },
  title: { margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--x-color-ink)" },
  subtitle: { margin: "3px 0 0", fontSize: "12px", color: "var(--x-color-ink-muted)" },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
    cursor: "pointer",
    fontSize: "14px",
    flexShrink: 0,
  },
  body: { padding: "16px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" },
  errorBox: {
    padding: "10px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    border: "1px solid var(--x-color-danger-border)",
    fontSize: "13px",
  },
  hint: { margin: 0, fontSize: "12px", lineHeight: 1.6, color: "var(--x-color-ink-muted)" },
  muted: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" },
  listItem: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px 12px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  },
  rowTop: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" },
  pdfId: { fontSize: "14px", fontWeight: 800, color: "var(--x-color-ink)" },
  time: { fontSize: "12px", fontFamily: "var(--x-font-mono)", color: "var(--x-color-ink-muted)" },
  orderRow: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
  label: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  orderChip: {
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    background: "var(--x-color-canvas-alt)",
    color: "var(--x-color-ink)",
  },
  orderChipButton: {
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-canvas-alt)",
    color: "var(--x-color-accent-strong)",
    cursor: "pointer",
  },
  owners: { margin: 0, fontSize: "12px", color: "var(--x-color-ink)" },
  boardRow: { display: "flex", gap: "6px", flexWrap: "wrap" },
  boardChip: {
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    background: "var(--x-color-accent-tint)",
    color: "var(--x-color-accent-strong)",
  },
  unplacedChip: {
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    background: "var(--x-color-canvas-alt)",
    color: "var(--x-color-ink-muted)",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "12px 18px",
    borderTop: "1px solid var(--x-color-line-soft)",
  },
  pageButton: {
    padding: "6px 14px",
    fontSize: "13px",
    fontWeight: 700,
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    cursor: "pointer",
  },
  pageIndicator: { fontSize: "13px", color: "var(--x-color-ink-muted)" },
  disabled: { opacity: 0.55, cursor: "not-allowed" },
};
