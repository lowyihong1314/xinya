import { useEffect, useMemo, useState } from "react";

import { ensureDesignTokens } from "../../../theme/designTokens";
import {
  deleteSongbookEntry,
  fetchSongbookEntriesForAdmin,
  fetchSongbookEntry,
  importSongbookDocx,
  saveSongbookEntry,
} from "../../../changyou/react/api";
import type { SongbookEntry } from "../../../changyou/react/types";

const DEFAULT_IMPORT_PATH = "/home/yukang/flaskapp/xinya/tmp/songbook_import/songbook.docx";

export function SongbookAdminPage() {
  ensureDesignTokens();

  const [query, setQuery] = useState("");
  const [variant, setVariant] = useState<"" | "C" | "G">("");
  const [entries, setEntries] = useState<SongbookEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<SongbookEntry>>({ variant: "C", published: true, content: "", title: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  async function loadEntries() {
    setLoading(true);
    setError("");
    try {
      const response = await fetchSongbookEntriesForAdmin(query, variant);
      setEntries(response.entries || []);
      setSelectedId((current) => current ?? response.entries?.[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
  }, [query, variant]);

  useEffect(() => {
    const selected = entries.find((item) => item.id === selectedId);
    if (!selected) {
      return;
    }
    let cancelled = false;
    fetchSongbookEntry(selected.id)
      .then((response) => {
        if (!cancelled) {
          setDraft({ ...response.entry, content: response.entry.content || "" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDraft({ ...selected, content: selected.content || "" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, entries]);

  const selectedTitle = useMemo(() => {
    if (!draft.title) return "新歌曲";
    return `${draft.song_number ? `${draft.song_number}. ` : ""}${draft.title}`;
  }, [draft.song_number, draft.title]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const response = await saveSongbookEntry({
        id: draft.id,
        song_number: draft.song_number,
        title: String(draft.title || ""),
        variant: (draft.variant as "C" | "G") || "C",
        heading_text: draft.heading_text,
        original_key: draft.original_key,
        selected_key: draft.selected_key,
        bpm: draft.bpm,
        time_signature: draft.time_signature,
        content: String(draft.content || ""),
        source_doc: draft.source_doc,
        published: Boolean(draft.published),
        sort_order: draft.sort_order,
      });
      setToast("保存成功");
      await loadEntries();
      setSelectedId(response.entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft.id) return;
    if (!window.confirm(`确认删除《${draft.title || "未命名歌曲"}》？`)) return;
    try {
      await deleteSongbookEntry(draft.id);
      setToast("已删除");
      setDraft({ variant: "C", published: true, content: "", title: "" });
      setSelectedId(null);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handleImport() {
    setImporting(true);
    setError("");
    try {
      const result = await importSongbookDocx(DEFAULT_IMPORT_PATH, true);
      setToast(`导入完成：新增 ${result.saved}，更新 ${result.updated}`);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>CRM · Changyou</div>
          <h1 style={titleStyle}>唱游歌簿后台</h1>
          <p style={subtitleStyle}>管理歌名、歌词、chord 与 docx 导入。</p>
        </div>
        <div style={heroActionsStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={() => { setDraft({ variant: "C", published: true, content: "", title: "" }); setSelectedId(null); }}>新建</button>
          <button type="button" style={primaryButtonStyle} onClick={() => void handleImport()} disabled={importing}>{importing ? "导入中..." : "从 DOCX 导入"}</button>
        </div>
      </div>
      <div style={toolbarStyle}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌名 / 内容" style={inputStyle} />
        <select value={variant} onChange={(event) => setVariant(event.target.value as "" | "C" | "G")} style={inputStyle}>
          <option value="">全部版本</option>
          <option value="C">C</option>
          <option value="G">G</option>
        </select>
      </div>
      {toast ? <div style={toastStyle}>{toast}</div> : null}
      {error ? <div style={errorStyle}>{error}</div> : null}
      <div style={layoutStyle}>
        <aside style={listStyle}>
          {loading ? <div style={stateStyle}>加载中…</div> : entries.map((entry) => (
            <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id)} style={listItemStyle(entry.id === selectedId)}>
              <div style={listTitleStyle}>{entry.song_number ? `${entry.song_number}. ` : ""}{entry.title}</div>
              <div style={listMetaStyle}>{entry.variant} · {entry.published ? "已发布" : "隐藏"}</div>
            </button>
          ))}
        </aside>
        <section style={editorStyle}>
          <div style={editorHeaderStyle}>{selectedTitle}</div>
          <div style={gridStyle}>
            <input value={draft.song_number ?? ""} onChange={(event) => setDraft((current) => ({ ...current, song_number: event.target.value ? Number(event.target.value) : undefined }))} placeholder="序号" style={inputStyle} />
            <select value={(draft.variant as string) || "C"} onChange={(event) => setDraft((current) => ({ ...current, variant: event.target.value as "C" | "G" }))} style={inputStyle}>
              <option value="C">C</option>
              <option value="G">G</option>
            </select>
            <input value={draft.title ?? ""} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="歌名" style={inputStyle} />
            <input value={draft.heading_text ?? ""} onChange={(event) => setDraft((current) => ({ ...current, heading_text: event.target.value }))} placeholder="标题行" style={inputStyle} />
            <input value={draft.original_key ?? ""} onChange={(event) => setDraft((current) => ({ ...current, original_key: event.target.value }))} placeholder="原调" style={inputStyle} />
            <input value={draft.selected_key ?? ""} onChange={(event) => setDraft((current) => ({ ...current, selected_key: event.target.value }))} placeholder="选调" style={inputStyle} />
            <input value={draft.bpm ?? ""} onChange={(event) => setDraft((current) => ({ ...current, bpm: event.target.value }))} placeholder="BPM" style={inputStyle} />
            <input value={draft.time_signature ?? ""} onChange={(event) => setDraft((current) => ({ ...current, time_signature: event.target.value }))} placeholder="拍号" style={inputStyle} />
          </div>
          <label style={checkboxRowStyle}><input type="checkbox" checked={Boolean(draft.published)} onChange={(event) => setDraft((current) => ({ ...current, published: event.target.checked }))} /> 发布到唱游前端</label>
          <textarea value={draft.content ?? ""} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} style={textareaStyle} placeholder="歌词 / chord 内容" />
          <div style={actionsStyle}>
            {draft.id ? <button type="button" style={dangerButtonStyle} onClick={() => void handleDelete()}>删除</button> : null}
            <button type="button" style={primaryButtonStyle} onClick={() => void handleSave()} disabled={saving}>{saving ? "保存中..." : "保存"}</button>
          </div>
        </section>
      </div>
    </div>
  );
}

const pageStyle = { display: "grid", gap: "16px" } as const;
const heroStyle = { display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", padding: "20px", borderRadius: "24px", background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-accent))", color: "white" } as const;
const eyebrowStyle = { fontSize: "12px", letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.82 } as const;
const titleStyle = { margin: "8px 0 0", fontSize: "28px", fontWeight: 900 } as const;
const subtitleStyle = { margin: "8px 0 0", fontSize: "14px", opacity: 0.88 } as const;
const heroActionsStyle = { display: "flex", gap: "10px", flexWrap: "wrap" } as const;
const toolbarStyle = { display: "flex", gap: "12px", flexWrap: "wrap" } as const;
const layoutStyle = { display: "grid", gridTemplateColumns: "280px minmax(0,1fr)", gap: "16px" } as const;
const listStyle = { display: "grid", gap: "10px", alignContent: "start" } as const;
const listItemStyle = (active: boolean) => ({ padding: "14px", borderRadius: "16px", border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line-soft)", background: active ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel-strong)", textAlign: "left" as const, cursor: "pointer" });
const listTitleStyle = { fontWeight: 800 } as const;
const listMetaStyle = { marginTop: "6px", fontSize: "12px", color: "var(--x-color-ink-muted)" } as const;
const editorStyle = { padding: "18px", borderRadius: "20px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", display: "grid", gap: "14px" } as const;
const editorHeaderStyle = { fontSize: "22px", fontWeight: 900, color: "var(--x-color-ink)" } as const;
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "12px" } as const;
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: "12px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)" } as const;
const textareaStyle = { width: "100%", minHeight: "480px", padding: "14px", borderRadius: "14px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", fontFamily: '"SFMono-Regular",Consolas,monospace', lineHeight: 1.7 } as const;
const checkboxRowStyle = { display: "flex", alignItems: "center", gap: "8px", color: "var(--x-color-ink-muted)" } as const;
const actionsStyle = { display: "flex", justifyContent: "flex-end", gap: "10px" } as const;
const primaryButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))", color: "white", fontWeight: 800, cursor: "pointer" } as const;
const secondaryButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.12)", color: "white", fontWeight: 800, cursor: "pointer" } as const;
const dangerButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "var(--x-color-danger)", color: "white", fontWeight: 800, cursor: "pointer" } as const;
const toastStyle = { padding: "12px 14px", borderRadius: "14px", background: "var(--x-color-success-soft)", color: "var(--x-color-success)" } as const;
const errorStyle = { padding: "12px 14px", borderRadius: "14px", background: "rgba(220,38,38,0.08)", color: "var(--x-color-danger)" } as const;
const stateStyle = { minHeight: "120px", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)" } as const;
