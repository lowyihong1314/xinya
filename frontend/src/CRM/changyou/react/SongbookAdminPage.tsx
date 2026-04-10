import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../../app/UserState";
import { showConfirmDialog } from "../../../js/dialogs";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import {
  deleteSongbookEntry,
  fetchSongbookEntriesForAdmin,
  fetchSongbookEntry,
  importSongbookDocx,
  saveSongbookEntry,
} from "../../../music/changyou/react/api";
import type { SongbookEntry } from "../../../music/changyou/react/types";

const DEFAULT_IMPORT_PATH = "/home/yukang/flaskapp/xinya/tmp/songbook_import/songbook.docx";
const PAGE_SIZE = 12;

export function SongbookAdminPage() {
  useEnsureDesignTokens();

  const { isMobile } = useUserState();
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
  const [page, setPage] = useState(1);

  async function loadEntries() {
    setLoading(true);
    setError("");
    try {
      const response = await fetchSongbookEntriesForAdmin(query, variant);
      setEntries(response.entries || []);
      setSelectedId((current) => response.entries?.some((item) => item.id === current) ? current : response.entries?.[0]?.id ?? null);
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
    setPage(1);
  }, [query, variant]);

  useEffect(() => {
    const selected = entries.find((item) => item.id === selectedId);
    if (!selected) {
      return;
    }
    let cancelled = false;
    fetchSongbookEntry(selected.id, { includeUnpublished: true })
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

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedEntries = useMemo(
    () => entries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [entries, safePage],
  );

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const selectedIndex = entries.findIndex((item) => item.id === selectedId);
    if (selectedIndex === -1) {
      return;
    }
    const nextPage = Math.floor(selectedIndex / PAGE_SIZE) + 1;
    setPage((current) => current === nextPage ? current : nextPage);
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
    if (!(await showConfirmDialog({ message: `确认删除《${draft.title || "未命名歌曲"}》？`, tone: "danger" }))) return;
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
      <div style={pageInnerStyle}>
        <div style={heroStyle(isMobile)}>
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
        <div style={toolbarStyle(isMobile)}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌名 / 内容" style={inputStyle} />
          <select value={variant} onChange={(event) => setVariant(event.target.value as "" | "C" | "G")} style={inputStyle}>
            <option value="">全部版本</option>
            <option value="C">C</option>
            <option value="G">G</option>
          </select>
          <div style={summaryStyle}>共 {entries.length} 首，当前第 {safePage}/{totalPages} 页</div>
        </div>
        {toast ? <div style={toastStyle}>{toast}</div> : null}
        {error ? <div style={errorStyle}>{error}</div> : null}
        <div style={layoutStyle(isMobile)}>
          <aside style={listPanelStyle}>
            <div style={panelHeaderStyle}>
              <div style={panelTitleStyle}>搜索结果</div>
              <div style={panelCaptionStyle}>点击条目切换编辑对象</div>
            </div>
            {!loading && entries.length > 0 ? (
              <div style={paginationStyle}>
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1} style={pageButtonStyle(safePage <= 1)}>上一页</button>
                {Array.from({ length: totalPages }, (_, index) => index + 1)
                  .filter((pageNumber) => totalPages <= 7 || Math.abs(pageNumber - safePage) <= 2 || pageNumber === 1 || pageNumber === totalPages)
                  .filter((pageNumber, index, array) => array.indexOf(pageNumber) === index)
                  .map((pageNumber) => (
                    <button key={pageNumber} type="button" onClick={() => setPage(pageNumber)} style={numberButtonStyle(pageNumber === safePage)}>{pageNumber}</button>
                  ))}
                <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages} style={pageButtonStyle(safePage >= totalPages)}>下一页</button>
              </div>
            ) : null}
            <div style={listStyle}>
              {loading ? <div style={fullWidthStateStyle}>加载中…</div> : null}
              {!loading && entries.length === 0 ? <div style={fullWidthStateStyle}>没有找到歌曲。</div> : null}
              {!loading && pagedEntries.map((entry) => (
                <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id)} style={listItemStyle(entry.id === selectedId, isMobile)}>
                  <div style={listRowStyle(isMobile)}>
                    <div style={listIdentityStyle}>
                      <div style={listBadgeRowStyle}>
                        <div style={variantBadgeStyle}>{entry.variant}</div>
                        <div style={publishBadgeStyle(Boolean(entry.published))}>{entry.published ? "已发布" : "隐藏"}</div>
                      </div>
                      <div style={listTitleStyle}>{entry.song_number ? `${entry.song_number}. ` : ""}{entry.title}</div>
                    </div>
                    <div style={listMetaWrapStyle(isMobile)}>
                      <div style={listMetaPillStyle}>Key {entry.selected_key || "-"}</div>
                      <div style={listMetaPillStyle}>BPM {entry.bpm || "-"}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </aside>
          <section style={editorStyle}>
            <div style={editorHeaderStyle}>{selectedTitle}</div>
            <div style={gridStyle(isMobile)}>
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
            <div style={actionsStyle(isMobile)}>
              {draft.id ? <button type="button" style={dangerButtonStyle} onClick={() => void handleDelete()}>删除</button> : null}
              <button type="button" style={primaryButtonStyle} onClick={() => void handleSave()} disabled={saving}>{saving ? "保存中..." : "保存"}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const pageStyle = { display: "grid", gap: "16px" } as const;
const pageInnerStyle = { width: "100%", maxWidth: "1480px", margin: "0 auto", display: "grid", gap: "16px" } as const;
const heroStyle = (isMobile: boolean): CSSProperties => ({ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexDirection: isMobile ? "column" : "row", padding: "20px", borderRadius: "24px", background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-accent))", color: "white" });
const eyebrowStyle = { fontSize: "12px", letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.82 } as const;
const titleStyle = { margin: "8px 0 0", fontSize: "28px", fontWeight: 900 } as const;
const subtitleStyle = { margin: "8px 0 0", fontSize: "14px", opacity: 0.88 } as const;
const heroActionsStyle = { display: "flex", gap: "10px", flexWrap: "wrap" } as const;
const toolbarStyle = (isMobile: boolean): CSSProperties => ({ display: "flex", gap: "12px", flexWrap: "wrap", flexDirection: isMobile ? "column" : "row" });
const summaryStyle = { padding: "12px 14px", borderRadius: "14px", background: "var(--x-color-panel-glass)", border: "1px solid var(--x-color-line-soft)", color: "var(--x-color-ink-muted)", fontSize: "13px", whiteSpace: "nowrap" as const } as const;
const layoutStyle = (isMobile: boolean) => ({ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(420px, 42vw) minmax(0,1fr)", gap: "16px", alignItems: "start" as const });
const listPanelStyle = { padding: "18px", borderRadius: "20px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", display: "grid", gap: "14px", alignContent: "start" } as const;
const panelHeaderStyle = { display: "grid", gap: "6px" } as const;
const panelTitleStyle = { fontSize: "20px", fontWeight: 900, color: "var(--x-color-ink)" } as const;
const panelCaptionStyle = { fontSize: "13px", color: "var(--x-color-ink-muted)" } as const;
const paginationStyle = { display: "flex", gap: "8px", flexWrap: "wrap" as const } as const;
const pageButtonStyle = (disabled: boolean) => ({ padding: "10px 14px", borderRadius: "10px", border: "1px solid var(--x-color-line)", background: disabled ? "var(--x-color-panel-alt)" : "var(--x-color-panel)", color: disabled ? "var(--x-color-ink-muted)" : "var(--x-color-ink)", cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700 });
const numberButtonStyle = (active: boolean) => ({ minWidth: "40px", padding: "10px 12px", borderRadius: "10px", border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)", background: active ? "var(--x-color-accent)" : "var(--x-color-panel)", color: active ? "white" : "var(--x-color-ink)", cursor: "pointer", fontWeight: 700 });
const listStyle = { display: "grid", gap: "10px" } as const;
const listItemStyle = (active: boolean, isMobile: boolean) => ({
  width: "100%",
  padding: isMobile ? "14px" : "15px 16px",
  borderRadius: "16px",
  border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line-soft)",
  background: active ? "linear-gradient(180deg, var(--x-color-accent-tint-strong), var(--x-color-panel))" : "linear-gradient(180deg, var(--x-color-panel-strong), var(--x-color-panel))",
  textAlign: "left" as const,
  cursor: "pointer",
  display: "block",
  boxShadow: "0 10px 24px var(--x-color-shadow-soft)",
});
const listRowStyle = (isMobile: boolean) => ({ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) auto", gap: "12px", alignItems: "center" as const });
const listIdentityStyle = { display: "grid", gap: "8px" } as const;
const listBadgeRowStyle = { display: "flex", flexWrap: "wrap" as const, gap: "8px", alignItems: "center" } as const;
const variantBadgeStyle = { padding: "6px 10px", borderRadius: "999px", background: "rgba(15,118,110,0.1)", color: "var(--x-color-accent-strong)", fontSize: "12px", fontWeight: 800, letterSpacing: "0.04em" } as const;
const publishBadgeStyle = (published: boolean) => ({ padding: "6px 10px", borderRadius: "999px", background: published ? "rgba(22,163,74,0.12)" : "rgba(217,119,6,0.12)", color: published ? "var(--x-color-success)" : "var(--x-color-warning)", fontSize: "12px", fontWeight: 800 });
const listTitleStyle = { fontWeight: 800, color: "var(--x-color-ink)", lineHeight: 1.45 } as const;
const listMetaWrapStyle = (isMobile: boolean) => ({ display: "flex", flexWrap: "wrap" as const, gap: "8px", justifyContent: isMobile ? "flex-start" : "flex-end" as const });
const listMetaPillStyle = { padding: "7px 10px", borderRadius: "999px", background: "var(--x-color-panel-glass)", border: "1px solid var(--x-color-line-soft)", fontSize: "12px", color: "var(--x-color-ink-muted)", fontWeight: 700 } as const;
const editorStyle = { padding: "18px", borderRadius: "20px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", display: "grid", gap: "14px" } as const;
const editorHeaderStyle = { fontSize: "22px", fontWeight: 900, color: "var(--x-color-ink)" } as const;
const gridStyle = (isMobile: boolean) => ({ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0,1fr))", gap: "12px" });
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: "12px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)" } as const;
const textareaStyle = { width: "100%", minHeight: "480px", padding: "14px", borderRadius: "14px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", fontFamily: '"SFMono-Regular",Consolas,monospace', lineHeight: 1.7 } as const;
const checkboxRowStyle = { display: "flex", alignItems: "center", gap: "8px", color: "var(--x-color-ink-muted)" } as const;
const actionsStyle = (isMobile: boolean) => ({ display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" as const });
const primaryButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))", color: "white", fontWeight: 800, cursor: "pointer" } as const;
const secondaryButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.12)", color: "white", fontWeight: 800, cursor: "pointer" } as const;
const dangerButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "var(--x-color-danger)", color: "white", fontWeight: 800, cursor: "pointer" } as const;
const toastStyle = { padding: "12px 14px", borderRadius: "14px", background: "var(--x-color-success-soft)", color: "var(--x-color-success)" } as const;
const errorStyle = { padding: "12px 14px", borderRadius: "14px", background: "rgba(220,38,38,0.08)", color: "var(--x-color-danger)" } as const;
const stateStyle = { minHeight: "120px", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)" } as const;
const fullWidthStateStyle = { ...stateStyle, width: "100%" } as const;
