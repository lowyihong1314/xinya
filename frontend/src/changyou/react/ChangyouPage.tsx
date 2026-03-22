import { useEffect, useMemo, useState } from "react";

import { useUserState } from "../../app/UserState";
import { ensureDesignTokens } from "../../theme/designTokens";
import { fetchSongbookEntries, fetchSongbookEntry } from "./api";
import type { SongbookEntry } from "./types";

export function ChangyouPage() {
  ensureDesignTokens();

  const { isAuthenticated, loadingUser, openLogin } = useUserState();
  const [query, setQuery] = useState("");
  const [variant, setVariant] = useState<"" | "C" | "G">("");
  const [entries, setEntries] = useState<SongbookEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<SongbookEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loadingUser && !isAuthenticated) {
      openLogin();
    }
  }, [loadingUser, isAuthenticated, openLogin]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchSongbookEntries(query, variant)
      .then((response) => {
        if (cancelled) return;
        setEntries(response.entries || []);
        setSelectedId((current) => current ?? response.entries?.[0]?.id ?? null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, query, variant]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedEntry(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetchSongbookEntry(selectedId)
      .then((response) => !cancelled && setSelectedEntry(response.entry))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "加载详情失败"))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const titleText = useMemo(() => {
    if (!selectedEntry) return "请选择歌曲";
    const number = selectedEntry.song_number ? `${selectedEntry.song_number}. ` : "";
    return `${number}${selectedEntry.title} · ${selectedEntry.variant}`;
  }, [selectedEntry]);

  if (loadingUser) return <div style={stateStyle}>加载中…</div>;
  if (!isAuthenticated) return <div style={stateStyle}>请先登录后再访问唱游页面。</div>;

  return (
    <div style={pageStyle}>
      <div style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>Changyou</div>
          <h1 style={titleStyle}>唱游歌簿</h1>
          <p style={subtitleStyle}>搜索歌名，快速查看歌词和 chord。当前是内部使用版本。</p>
        </div>
      </div>

      <div style={toolbarStyle}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌名 / 歌词 / chord" style={inputStyle} />
        <select value={variant} onChange={(event) => setVariant(event.target.value as "" | "C" | "G")} style={selectStyle}>
          <option value="">全部版本</option>
          <option value="C">C family</option>
          <option value="G">G family</option>
        </select>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={layoutStyle}>
        <aside style={listStyle}>
          {loading ? <div style={stateStyle}>加载歌曲中…</div> : null}
          {!loading && entries.length === 0 ? <div style={stateStyle}>没有找到歌曲。</div> : null}
          {!loading && entries.map((entry) => {
            const active = entry.id === selectedId;
            return (
              <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id)} style={listItemStyle(active)}>
                <div style={listItemTitleStyle}>{entry.song_number ? `${entry.song_number}. ` : ""}{entry.title}</div>
                <div style={listItemMetaStyle}>{entry.variant} · {entry.selected_key || "-"} · BPM {entry.bpm || "-"}</div>
              </button>
            );
          })}
        </aside>

        <section style={detailStyle}>
          {detailLoading ? <div style={stateStyle}>加载详情中…</div> : null}
          {!detailLoading && selectedEntry ? (
            <>
              <div style={detailHeaderStyle}>
                <h2 style={detailTitleStyle}>{titleText}</h2>
                <div style={detailMetaStyle}>
                  <span>原调：{selectedEntry.original_key || "-"}</span>
                  <span>选调：{selectedEntry.selected_key || "-"}</span>
                  <span>BPM：{selectedEntry.bpm || "-"}</span>
                  <span>拍号：{selectedEntry.time_signature || "-"}</span>
                </div>
              </div>
              <pre style={contentStyle}>{selectedEntry.content || ""}</pre>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const pageStyle = { minHeight: "calc(100vh - 60px)", padding: "24px", background: "radial-gradient(circle at top left, var(--x-color-accent-tint-strong), var(--x-color-canvas) 42%, var(--x-color-canvas-alt) 100%)" } as const;
const heroStyle = { padding: "22px", borderRadius: "24px", background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-accent))", color: "white", boxShadow: "0 20px 40px var(--x-color-shadow)" } as const;
const eyebrowStyle = { fontSize: "12px", letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.84 } as const;
const titleStyle = { margin: "8px 0 0", fontSize: "30px", fontWeight: 900 } as const;
const subtitleStyle = { margin: "10px 0 0", lineHeight: 1.6, fontSize: "14px", color: "rgba(255,255,255,0.84)" } as const;
const toolbarStyle = { display: "flex", gap: "12px", marginTop: "18px", marginBottom: "18px", flexWrap: "wrap" } as const;
const inputStyle = { flex: 1, minWidth: "240px", padding: "13px 16px", borderRadius: "14px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-strongest)" } as const;
const selectStyle = { padding: "13px 16px", borderRadius: "14px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-strongest)" } as const;
const layoutStyle = { display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", gap: "16px" } as const;
const listStyle = { display: "grid", gap: "10px", alignContent: "start" } as const;
const listItemStyle = (active: boolean) => ({ padding: "14px", borderRadius: "16px", border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line-soft)", background: active ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel-strong)", textAlign: "left" as const, cursor: "pointer", boxShadow: "0 10px 24px var(--x-color-shadow-soft)" });
const listItemTitleStyle = { fontWeight: 800, color: "var(--x-color-ink)" } as const;
const listItemMetaStyle = { marginTop: "6px", fontSize: "12px", color: "var(--x-color-ink-muted)" } as const;
const detailStyle = { minHeight: "60vh", padding: "20px", borderRadius: "20px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 16px 36px var(--x-color-shadow-soft)" } as const;
const detailHeaderStyle = { marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--x-color-line-soft)" } as const;
const detailTitleStyle = { margin: 0, fontSize: "26px", fontWeight: 900, color: "var(--x-color-ink)" } as const;
const detailMetaStyle = { display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "10px", fontSize: "13px", color: "var(--x-color-ink-muted)" } as const;
const contentStyle = { margin: 0, whiteSpace: "pre-wrap", fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace', lineHeight: 1.75, fontSize: "14px", color: "var(--x-color-ink)", overflowX: "auto" } as const;
const stateStyle = { minHeight: "120px", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)" } as const;
const errorStyle = { marginBottom: "12px", padding: "12px 14px", borderRadius: "14px", background: "rgba(220,38,38,0.08)", color: "var(--x-color-danger)", border: "1px solid rgba(220,38,38,0.16)" } as const;
