import { useEffect, useState, type CSSProperties } from "react";

import { show_alert } from "../../js/show_alert";
import {
  createFahuiOpenWindow,
  deleteFahuiOpenWindow,
  fetchFahuiOpenWindows,
  type FahuiOpenWindowStatus,
} from "./api";

const FAHUI_LABELS: Record<string, string> = {
  ylp: "盂兰盆法会 · 牌位登记",
  lamp: "点灯法会 · 供灯登记",
};

function formatMd(md: string) {
  const [month, day] = md.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

export function OpenWindowModal({ fahuiKey, onClose }: { fahuiKey: "ylp" | "lamp"; onClose: () => void }) {
  const [status, setStatus] = useState<FahuiOpenWindowStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [draftNote, setDraftNote] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchFahuiOpenWindows(fahuiKey);
      setStatus(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fahuiKey]);

  async function handleAdd() {
    if (!draftStart.trim() || !draftEnd.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createFahuiOpenWindow({
        fahui_key: fahuiKey,
        start_md: draftStart.trim(),
        end_md: draftEnd.trim(),
        note: draftNote.trim() || undefined,
      });
      setDraftStart("");
      setDraftEnd("");
      setDraftNote("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(windowId: number) {
    try {
      await deleteFahuiOpenWindow(windowId);
      await reload();
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <header style={styles.header}>
          <div>
            <h3 style={styles.title}>开放时间设置</h3>
            <p style={styles.subtitle}>{FAHUI_LABELS[fahuiKey] || fahuiKey} · 每年循环，按月-日匹配</p>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div style={styles.body}>
          {error ? <div style={styles.errorBox}>{error}</div> : null}

          {status ? (
            <div style={status.is_open ? styles.statusOpen : styles.statusClosed}>
              {status.is_open ? "● 现在开放中" : "● 现在未开放"}
              <span style={styles.statusToday}>今天：{formatMd(status.today_md)}</span>
            </div>
          ) : null}

          <div style={styles.addRow}>
            <input
              style={styles.mdInput}
              placeholder="开始 07-01"
              value={draftStart}
              onChange={(event) => setDraftStart(event.target.value)}
            />
            <span style={styles.rangeDash}>至</span>
            <input
              style={styles.mdInput}
              placeholder="结束 09-01"
              value={draftEnd}
              onChange={(event) => setDraftEnd(event.target.value)}
            />
            <input
              style={styles.noteInput}
              placeholder="备注（可空）"
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleAdd();
              }}
            />
            <button
              type="button"
              style={{ ...styles.addButton, ...(saving || !draftStart.trim() || !draftEnd.trim() ? styles.disabled : {}) }}
              onClick={() => void handleAdd()}
              disabled={saving || !draftStart.trim() || !draftEnd.trim()}
            >
              添加
            </button>
          </div>
          <p style={styles.hint}>格式 MM-DD（每年重复）。开始晚于结束表示跨年，例如 12-15 至 01-15。</p>

          {loading ? (
            <p style={styles.muted}>加载中…</p>
          ) : status && status.windows.length ? (
            <ul style={styles.list}>
              {status.windows.map((window) => (
                <li key={window.id} style={styles.listItem}>
                  <span style={styles.listRange}>
                    每年 {formatMd(window.start_md)} – {formatMd(window.end_md)}
                  </span>
                  {window.note ? <span style={styles.listNote}>{window.note}</span> : null}
                  <button type="button" style={styles.deleteButton} onClick={() => void handleDelete(window.id)}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={styles.muted}>还没有开放时间段——未配置时公开报名一律关闭。</p>
          )}
        </div>
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
    width: "min(560px, 100%)",
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
  statusOpen: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "9px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-success-soft, #dcfce7)",
    color: "var(--x-color-success, #15803d)",
    fontSize: "13px",
    fontWeight: 700,
  },
  statusClosed: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "9px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontSize: "13px",
    fontWeight: 700,
  },
  statusToday: { fontWeight: 500, opacity: 0.85 },
  addRow: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  mdInput: {
    width: "96px",
    boxSizing: "border-box",
    padding: "9px 10px",
    fontSize: "13px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    outline: "none",
  },
  rangeDash: { fontSize: "13px", color: "var(--x-color-ink-muted)" },
  noteInput: {
    flex: 1,
    minWidth: "120px",
    boxSizing: "border-box",
    padding: "9px 10px",
    fontSize: "13px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    outline: "none",
  },
  addButton: {
    padding: "9px 16px",
    fontSize: "13px",
    fontWeight: 700,
    color: "#fff",
    background: "var(--x-color-accent)",
    border: "none",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  disabled: { opacity: 0.55, cursor: "not-allowed" },
  hint: { margin: 0, fontSize: "12px", color: "var(--x-color-ink-muted)" },
  muted: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" },
  listItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "9px 12px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  },
  listRange: { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink)" },
  listNote: { flex: 1, fontSize: "12px", color: "var(--x-color-ink-muted)" },
  deleteButton: {
    marginLeft: "auto",
    padding: "5px 10px",
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--x-color-danger)",
    background: "transparent",
    border: "1px solid var(--x-color-danger-border)",
    borderRadius: "999px",
    cursor: "pointer",
  },
};
