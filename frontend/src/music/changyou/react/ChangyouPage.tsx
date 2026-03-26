import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useUserState } from "../../../app/UserState";
import { ensureDesignTokens } from "../../../theme/designTokens";
import { CHANGYOU_ROOM_PATH, getChangyouDetailPath } from "../../router/paths";
import { fetchSongbookEntries } from "./api";
import type { SongbookEntry } from "./types";

const PAGE_SIZE = 20;

export function ChangyouPage() {
  ensureDesignTokens();

  const navigate = useNavigate();
  const { isAuthenticated, loadingUser, openLogin, isMobile } = useUserState();
  const [query, setQuery] = useState("");
  const [variant, setVariant] = useState<"" | "C" | "G">("");
  const [entries, setEntries] = useState<SongbookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!loadingUser && !isAuthenticated) {
      openLogin();
    }
  }, [loadingUser, isAuthenticated, openLogin]);

  useEffect(() => {
    setPage(1);
  }, [query, variant]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchSongbookEntries(query, variant)
      .then((response) => {
        if (!cancelled) {
          setEntries(response.entries || []);
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, query, variant]);

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

  if (loadingUser) return <div style={stateStyle}>加载中…</div>;
  if (!isAuthenticated) return <div style={stateStyle}>请先登录后再访问唱游页面。</div>;

  return (
    <div style={pageStyle}>
      <div style={pageInnerStyle}>
        <div style={heroStyle}>
          <div>
            <div style={eyebrowStyle}>Changyou</div>
            <h1 style={titleStyle}>唱游歌簿</h1>
            <p style={subtitleStyle}>搜索歌名，点进去单独查看歌词和 chord。</p>
          </div>
        </div>

        <div style={{ ...toolbarStyle, flexDirection: isMobile ? "column" : "row" }}>
          <button type="button" onClick={() => navigate(CHANGYOU_ROOM_PATH)} style={roomButtonStyle}>房间</button>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌名 / 歌词 / chord" style={inputStyle} />
          <select value={variant} onChange={(event) => setVariant(event.target.value as "" | "C" | "G")} style={selectStyle}>
            <option value="">全部版本</option>
            <option value="C">C family</option>
            <option value="G">G family</option>
          </select>
          <div style={summaryStyle}>共 {entries.length} 首，当前第 {safePage}/{totalPages} 页</div>
        </div>

        {error ? <div style={errorStyle}>{error}</div> : null}

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

        <div style={listStyle(isMobile)}>
          {loading ? <div style={fullWidthStateStyle}>加载歌曲中…</div> : null}
          {!loading && entries.length === 0 ? <div style={fullWidthStateStyle}>没有找到歌曲。</div> : null}
          {!loading && pagedEntries.map((entry) => (
            <button key={entry.id} type="button" onClick={() => navigate(getChangyouDetailPath(entry.id))} style={listItemStyle(isMobile)}>
              <div style={listItemTopStyle}>
                <div style={songBadgeStyle}>{entry.variant}</div>
                <div style={listItemTitleStyle}>{entry.song_number ? `${entry.song_number}. ` : ""}{entry.title}</div>
              </div>
              <div style={listItemMetaWrapStyle}>
                <div style={listMetaPillStyle}>Key {entry.selected_key || "-"}</div>
                <div style={listMetaPillStyle}>BPM {entry.bpm || "-"}</div>
                <div style={listMetaPillStyle}>{entry.active_version_label || "原版"}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const pageStyle = { minHeight: "calc(100vh - 60px)", padding: "24px", background: "radial-gradient(circle at top left, var(--x-color-accent-tint-strong), var(--x-color-canvas) 42%, var(--x-color-canvas-alt) 100%)" } as const;
const pageInnerStyle = { width: "100%", maxWidth: "1360px", margin: "0 auto" } as const;
const heroStyle = { padding: "22px", borderRadius: "24px", background: "linear-gradient(135deg, var(--x-color-nav-start), var(--x-color-accent))", color: "white", boxShadow: "0 20px 40px var(--x-color-shadow)" } as const;
const eyebrowStyle = { fontSize: "12px", letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.84 } as const;
const titleStyle = { margin: "8px 0 0", fontSize: "30px", fontWeight: 900 } as const;
const subtitleStyle = { margin: "10px 0 0", lineHeight: 1.6, fontSize: "14px", color: "rgba(255,255,255,0.84)" } as const;
const toolbarStyle = { display: "flex", gap: "12px", marginTop: "18px", marginBottom: "18px" } as const;
const inputStyle = { flex: 1, minWidth: "240px", padding: "13px 16px", borderRadius: "14px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-strongest)" } as const;
const selectStyle = { padding: "13px 16px", borderRadius: "14px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-strongest)" } as const;
const roomButtonStyle = { padding: "13px 18px", borderRadius: "14px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel-strongest)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const summaryStyle = { padding: "12px 14px", borderRadius: "14px", background: "var(--x-color-panel-glass)", border: "1px solid var(--x-color-line-soft)", color: "var(--x-color-ink-muted)", fontSize: "13px", whiteSpace: "nowrap" as const };
const paginationStyle = { display: "flex", gap: "8px", flexWrap: "wrap" as const, marginBottom: "14px" } as const;
const pageButtonStyle = (disabled: boolean) => ({ padding: "10px 14px", borderRadius: "10px", border: "1px solid var(--x-color-line)", background: disabled ? "var(--x-color-panel-alt)" : "var(--x-color-panel)", color: disabled ? "var(--x-color-ink-muted)" : "var(--x-color-ink)", cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700 });
const numberButtonStyle = (active: boolean) => ({ minWidth: "40px", padding: "10px 12px", borderRadius: "10px", border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)", background: active ? "var(--x-color-accent)" : "var(--x-color-panel)", color: active ? "white" : "var(--x-color-ink)", cursor: "pointer", fontWeight: 700 });
const listStyle = (isMobile: boolean) => ({
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "14px",
  alignItems: "stretch",
  alignContent: "flex-start",
});
const listItemStyle = (isMobile: boolean) => ({
  flex: isMobile ? "1 1 100%" : "1 1 280px",
  minWidth: isMobile ? "100%" : "280px",
  maxWidth: isMobile ? "100%" : "calc(33.333% - 10px)",
  minHeight: isMobile ? "auto" : "154px",
  padding: isMobile ? "16px" : "18px",
  borderRadius: "18px",
  border: "1px solid var(--x-color-line-soft)",
  background: "linear-gradient(180deg, var(--x-color-panel-strong), var(--x-color-panel))",
  textAlign: "left" as const,
  cursor: "pointer",
  boxShadow: "0 10px 24px var(--x-color-shadow-soft)",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  gap: "14px",
});
const listItemTopStyle = { display: "grid", gap: "10px" } as const;
const songBadgeStyle = {
  width: "fit-content",
  padding: "6px 10px",
  borderRadius: "999px",
  background: "rgba(15,118,110,0.1)",
  color: "var(--x-color-accent-strong)",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.04em",
} as const;
const listItemTitleStyle = { fontWeight: 800, color: "var(--x-color-ink)", fontSize: "16px" } as const;
const listItemMetaWrapStyle = { display: "flex", flexWrap: "wrap" as const, gap: "8px" } as const;
const listMetaPillStyle = {
  padding: "7px 10px",
  borderRadius: "999px",
  background: "var(--x-color-panel-glass)",
  border: "1px solid var(--x-color-line-soft)",
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
} as const;
const stateStyle = { minHeight: "120px", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)" } as const;
const fullWidthStateStyle = { ...stateStyle, width: "100%", flex: "1 1 100%" } as const;
const errorStyle = { marginBottom: "12px", padding: "12px 14px", borderRadius: "14px", background: "rgba(220,38,38,0.08)", color: "var(--x-color-danger)", border: "1px solid rgba(220,38,38,0.16)" } as const;
