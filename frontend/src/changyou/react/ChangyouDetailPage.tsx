import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { ensureDesignTokens } from "../../theme/designTokens";
import { fetchSongbookEntry } from "./api";
import type { SongbookEntry } from "./types";

export function ChangyouDetailPage() {
  ensureDesignTokens();

  const navigate = useNavigate();
  const { entryId } = useParams();
  const { isAuthenticated, loadingUser, openLogin, isMobile } = useUserState();
  const [entry, setEntry] = useState<SongbookEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loadingUser && !isAuthenticated) {
      openLogin();
    }
  }, [loadingUser, isAuthenticated, openLogin]);

  useEffect(() => {
    if (!isAuthenticated || !entryId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchSongbookEntry(Number(entryId))
      .then((response) => !cancelled && setEntry(response.entry))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [entryId, isAuthenticated]);

  const titleText = useMemo(() => {
    if (!entry) return "歌曲详情";
    return `${entry.song_number ? `${entry.song_number}. ` : ""}${entry.title} · ${entry.variant}`;
  }, [entry]);

  if (loadingUser) return <div style={stateStyle}>加载中…</div>;
  if (!isAuthenticated) return <div style={stateStyle}>请先登录后再访问唱游页面。</div>;

  return (
    <div style={pageStyle}>
      <div style={topBarStyle(isMobile)}>
        <button type="button" onClick={() => navigate("/changyou")} style={backButtonStyle}>← 返回歌单</button>
        {entry ? <div style={versionPillStyle}>{entry.variant} 版本</div> : null}
      </div>

      {loading ? <div style={stateStyle}>加载歌曲中…</div> : null}
      {!loading && error ? <div style={errorStyle}>{error}</div> : null}

      {!loading && entry ? (
        <div style={readerStyle(isMobile)}>
          <div style={headerStyle}>
            <div style={eyebrowStyle}>Changyou Reader</div>
            <h1 style={titleStyle}>{titleText}</h1>
            <div style={metaStyle}>
              <span>原调：{entry.original_key || "-"}</span>
              <span>选调：{entry.selected_key || "-"}</span>
              <span>BPM：{entry.bpm || "-"}</span>
              <span>拍号：{entry.time_signature || "-"}</span>
            </div>
          </div>
          <pre style={contentStyle(isMobile)}>{entry.content || ""}</pre>
        </div>
      ) : null}
    </div>
  );
}

const pageStyle = { minHeight: "calc(100vh - 60px)", padding: "20px", background: "linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))", boxSizing: "border-box" as const, overflowX: "hidden" as const } as const;
const topBarStyle = (isMobile: boolean) => ({ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", flexDirection: isMobile ? "column" : "row", gap: "12px", marginBottom: "16px" });
const backButtonStyle = { alignSelf: "flex-start", padding: "12px 16px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const versionPillStyle = { padding: "10px 14px", borderRadius: "999px", background: "var(--x-color-accent-tint-strong)", color: "var(--x-color-accent-strong)", fontWeight: 800 } as const;
const readerStyle = (isMobile: boolean) => ({ width: "100%", maxWidth: "980px", minWidth: 0, margin: "0 auto", padding: isMobile ? "18px" : "28px", borderRadius: "24px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 20px 50px var(--x-color-shadow-soft)", boxSizing: "border-box" as const, overflowX: "hidden" as const });
const headerStyle = { paddingBottom: "16px", marginBottom: "16px", borderBottom: "1px solid var(--x-color-line-soft)" } as const;
const eyebrowStyle = { fontSize: "12px", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" } as const;
const titleStyle = { margin: "8px 0 0", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 900, color: "var(--x-color-ink)" } as const;
const metaStyle = { display: "flex", gap: "10px", flexWrap: "wrap" as const, marginTop: "12px", fontSize: "13px", color: "var(--x-color-ink-muted)" } as const;
const contentStyle = (isMobile: boolean) => ({ margin: 0, width: "100%", maxWidth: "100%", minWidth: 0, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, overflowWrap: "anywhere" as const, boxSizing: "border-box" as const, fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace', lineHeight: 1.85, fontSize: isMobile ? "16px" : "18px", color: "var(--x-color-ink)", overflowX: "auto" as const });
const stateStyle = { minHeight: "240px", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)" } as const;
const errorStyle = { padding: "12px 14px", borderRadius: "14px", background: "rgba(220,38,38,0.08)", color: "var(--x-color-danger)", border: "1px solid rgba(220,38,38,0.16)" } as const;
