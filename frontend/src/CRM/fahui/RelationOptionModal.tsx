import { useEffect, useState, type CSSProperties } from "react";

import { show_alert } from "../../js/show_alert";
import {
  createYlpRelationOption,
  deleteYlpRelationOption,
  importYlpRelationOptions,
  listYlpRelationOptions,
} from "./api";
import type { YlpRelationOption } from "./types";

export function RelationOptionModal({ onClose }: { onClose: () => void }) {
  const [options, setOptions] = useState<YlpRelationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const res = await listYlpRelationOptions();
      setOptions(res.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleAdd() {
    const label = draft.trim();
    if (!label) return;
    setSaving(true);
    setError("");
    try {
      await createYlpRelationOption(label);
      setDraft("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(option: YlpRelationOption) {
    try {
      await deleteYlpRelationOption(option.id);
      setOptions((current) => current.filter((item) => item.id !== option.id));
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handleImport() {
    setSaving(true);
    setError("");
    try {
      const res = await importYlpRelationOptions();
      setOptions(res.data || []);
      show_alert("success", res.message || "已导入历史关系");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <header style={styles.header}>
          <div>
            <h3 style={styles.title}>超度亡灵关系配置</h3>
            <p style={styles.subtitle}>填写牌位时「关系」将从这里的选项中选择</p>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div style={styles.body}>
          {error ? <div style={styles.errorBox}>{error}</div> : null}

          <div style={styles.addRow}>
            <input
              style={styles.input}
              placeholder="新增关系，例如：先父"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleAdd();
              }}
            />
            <button
              type="button"
              style={{ ...styles.addButton, ...(saving || !draft.trim() ? styles.disabled : {}) }}
              onClick={() => void handleAdd()}
              disabled={saving || !draft.trim()}
            >
              添加
            </button>
          </div>

          <div style={styles.toolbar}>
            <span style={styles.muted}>共 {options.length} 个关系</span>
            <button type="button" style={styles.importButton} onClick={() => void handleImport()} disabled={saving}>
              从历史数据导入
            </button>
          </div>

          {loading ? (
            <p style={styles.muted}>加载中…</p>
          ) : options.length ? (
            <div style={styles.chips}>
              {options.map((option) => (
                <span key={option.id} style={styles.chip}>
                  {option.label}
                  <button
                    type="button"
                    style={styles.chipRemove}
                    onClick={() => void handleDelete(option)}
                    aria-label="移除"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p style={styles.emptyHint}>还没有关系选项，点「从历史数据导入」或手动添加。</p>
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
    zIndex: 1200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.55)",
    padding: "16px",
  },
  panel: {
    width: "min(520px, 100%)",
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
  body: { padding: "16px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" },
  errorBox: {
    padding: "10px 12px",
    borderRadius: "var(--x-radius-sm)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    border: "1px solid var(--x-color-danger-border)",
    fontSize: "13px",
  },
  addRow: { display: "flex", gap: "8px" },
  input: {
    flex: 1,
    boxSizing: "border-box",
    padding: "10px 12px",
    fontSize: "14px",
    borderRadius: "var(--x-radius-sm)",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    outline: "none",
  },
  addButton: {
    padding: "10px 18px",
    fontSize: "14px",
    fontWeight: 700,
    color: "#fff",
    background: "var(--x-color-accent)",
    border: "none",
    borderRadius: "var(--x-radius-sm)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  disabled: { opacity: 0.55, cursor: "not-allowed" },
  toolbar: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  muted: { fontSize: "12px", color: "var(--x-color-ink-muted)" },
  importButton: {
    padding: "7px 12px",
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    background: "var(--x-color-accent-soft)",
    border: "1px solid var(--x-color-accent-border)",
    borderRadius: "999px",
    cursor: "pointer",
  },
  chips: { display: "flex", flexWrap: "wrap", gap: "8px" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 8px 6px 12px",
    borderRadius: "999px",
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--x-color-ink)",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line)",
  },
  chipRemove: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "none",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    cursor: "pointer",
    fontSize: "11px",
    lineHeight: 1,
  },
  emptyHint: {
    margin: 0,
    padding: "16px",
    textAlign: "center",
    fontSize: "13px",
    color: "var(--x-color-ink-muted)",
    background: "var(--x-color-panel-alt)",
    borderRadius: "var(--x-radius-sm)",
    border: "1px dashed var(--x-color-line)",
  },
};
