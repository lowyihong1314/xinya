import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { ensureDesignTokens } from "../../theme/designTokens";
import { fetchSongbookEntries, fetchSongbookEntry } from "./api";
import type { SongbookEntry } from "./types";

const FONT_SIZE_STORAGE_KEY = "xinya.changyou.fontSize";
const HIDE_NAV_STORAGE_KEY = "xinya.changyou.hideNav";
const DEFAULT_FONT_SIZE = 18;
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 30;

export function ChangyouDetailPage() {
  ensureDesignTokens();

  const navigate = useNavigate();
  const { entryId } = useParams();
  const { isAuthenticated, loadingUser, openLogin, isMobile } = useUserState();
  const [entry, setEntry] = useState<SongbookEntry | null>(null);
  const [siblings, setSiblings] = useState<SongbookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_FONT_SIZE;
    const saved = Number(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_FONT_SIZE && saved <= MAX_FONT_SIZE ? saved : DEFAULT_FONT_SIZE;
  });
  const [hideNav, setHideNav] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(HIDE_NAV_STORAGE_KEY) === "1";
  });
  const settingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loadingUser && !isAuthenticated) {
      openLogin();
    }
  }, [loadingUser, isAuthenticated, openLogin]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
    }
  }, [fontSize]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HIDE_NAV_STORAGE_KEY, hideNav ? "1" : "0");
    }
    const navbar = document.getElementById("base_navbar");
    if (navbar) {
      navbar.style.display = hideNav ? "none" : "flex";
    }
    return () => {
      const currentNavbar = document.getElementById("base_navbar");
      if (currentNavbar) {
        currentNavbar.style.display = "flex";
      }
    };
  }, [hideNav]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!isAuthenticated || !entryId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchSongbookEntry(Number(entryId))
      .then((response) => {
        if (cancelled) return;
        setEntry(response.entry);
        return response.entry;
      })
      .then((loadedEntry) => {
        if (!loadedEntry || cancelled) return;
        return fetchSongbookEntries(String(loadedEntry.song_number || loadedEntry.title || ""), "").then((response) => {
          if (cancelled) return;
          const normalizedTitle = loadedEntry.title.trim();
          const related = (response.entries || []).filter((item) => {
            if (loadedEntry.song_number && item.song_number === loadedEntry.song_number) {
              return true;
            }
            return item.title.trim() === normalizedTitle;
          });
          setSiblings(related);
        });
      })
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

  const availableVariants = useMemo(() => {
    const map = new Map<string, SongbookEntry>();
    siblings.forEach((item) => {
      if (!map.has(item.variant)) {
        map.set(item.variant, item);
      }
    });
    if (entry && !map.has(entry.variant)) {
      map.set(entry.variant, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.variant.localeCompare(b.variant));
  }, [entry, siblings]);

  function switchVariant(variant: "C" | "G") {
    const target = availableVariants.find((item) => item.variant === variant);
    if (target && target.id !== entry?.id) {
      navigate(`/changyou/${target.id}`);
      setSettingsOpen(false);
    }
  }

  if (loadingUser) return <div style={stateStyle}>加载中…</div>;
  if (!isAuthenticated) return <div style={stateStyle}>请先登录后再访问唱游页面。</div>;

  return (
    <div style={pageStyle(hideNav)}>
      <div style={topBarStyle(isMobile)}>
        <button type="button" onClick={() => navigate("/changyou")} style={backButtonStyle}>← 返回歌单</button>
        <div style={topRightStyle} ref={settingsRef}>
          {entry ? <div style={versionPillStyle}>{entry.variant} 版本</div> : null}
          <button type="button" onClick={() => setSettingsOpen((open) => !open)} style={settingsButtonStyle}>⚙️ 设置</button>
          {settingsOpen ? (
            <div style={settingsPopupStyle}>
              <div style={settingsSectionStyle}>
                <div style={settingsLabelStyle}>显示</div>
                <label style={toggleRowStyle}>
                  <input type="checkbox" checked={hideNav} onChange={(event) => setHideNav(event.target.checked)} />
                  <span>隐藏导航栏</span>
                </label>
              </div>
              <div style={settingsSectionStyle}>
                <div style={settingsLabelStyle}>版本切换</div>
                <div style={chipRowStyle}>
                  {availableVariants.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => switchVariant(item.variant)}
                      style={variantChipStyle(item.id === entry?.id)}
                    >
                      {item.variant}
                    </button>
                  ))}
                </div>
              </div>
              <div style={settingsSectionStyle}>
                <div style={settingsLabelStyle}>字体大小</div>
                <div style={fontControlRowStyle}>
                  <button type="button" onClick={() => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 1))} style={fontButtonStyle}>A-</button>
                  <div style={fontValueStyle}>{fontSize}px</div>
                  <button type="button" onClick={() => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 1))} style={fontButtonStyle}>A+</button>
                </div>
                <input
                  type="range"
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
                  value={fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value))}
                  style={sliderStyle}
                />
              </div>
            </div>
          ) : null}
        </div>
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
          <pre style={contentStyle(fontSize)}>{entry.content || ""}</pre>
        </div>
      ) : null}
    </div>
  );
}

const pageStyle = (hideNav: boolean) => ({ minHeight: hideNav ? "100vh" : "calc(100vh - 60px)", padding: "20px", background: "linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))", boxSizing: "border-box" as const, overflowX: "hidden" as const });
const topBarStyle = (isMobile: boolean) => ({ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", flexDirection: isMobile ? "column" : "row", gap: "12px", marginBottom: "16px" });
const topRightStyle = { position: "relative" as const, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" as const };
const backButtonStyle = { alignSelf: "flex-start", padding: "12px 16px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const settingsButtonStyle = { padding: "10px 14px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const versionPillStyle = { padding: "10px 14px", borderRadius: "999px", background: "var(--x-color-accent-tint-strong)", color: "var(--x-color-accent-strong)", fontWeight: 800 } as const;
const settingsPopupStyle = { position: "absolute" as const, top: "calc(100% + 8px)", right: 0, zIndex: 20, width: "min(320px, calc(100vw - 40px))", padding: "14px", borderRadius: "18px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 18px 40px var(--x-color-shadow-soft)" } as const;
const settingsSectionStyle = { display: "grid", gap: "10px", marginBottom: "14px" } as const;
const settingsLabelStyle = { fontSize: "13px", fontWeight: 800, color: "var(--x-color-ink-muted)" } as const;
const toggleRowStyle = { display: "flex", alignItems: "center", gap: "10px", color: "var(--x-color-ink)" } as const;
const chipRowStyle = { display: "flex", gap: "8px", flexWrap: "wrap" as const };
const variantChipStyle = (active: boolean) => ({ padding: "10px 14px", borderRadius: "999px", border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)", background: active ? "var(--x-color-accent)" : "var(--x-color-panel)", color: active ? "white" : "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" });
const fontControlRowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } as const;
const fontButtonStyle = { padding: "10px 14px", borderRadius: "12px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const fontValueStyle = { minWidth: "64px", textAlign: "center" as const, fontWeight: 800, color: "var(--x-color-ink)" } as const;
const sliderStyle = { width: "100%" } as const;
const readerStyle = (isMobile: boolean) => ({ width: "100%", maxWidth: "980px", minWidth: 0, margin: "0 auto", padding: isMobile ? "18px" : "28px", borderRadius: "24px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 20px 50px var(--x-color-shadow-soft)", boxSizing: "border-box" as const, overflowX: "hidden" as const });
const headerStyle = { paddingBottom: "16px", marginBottom: "16px", borderBottom: "1px solid var(--x-color-line-soft)" } as const;
const eyebrowStyle = { fontSize: "12px", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" } as const;
const titleStyle = { margin: "8px 0 0", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 900, color: "var(--x-color-ink)" } as const;
const metaStyle = { display: "flex", gap: "10px", flexWrap: "wrap" as const, marginTop: "12px", fontSize: "13px", color: "var(--x-color-ink-muted)" } as const;
const contentStyle = (fontSize: number) => ({ margin: 0, width: "100%", maxWidth: "100%", minWidth: 0, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, overflowWrap: "anywhere" as const, boxSizing: "border-box" as const, fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace', lineHeight: 1.85, fontSize: `${fontSize}px`, color: "var(--x-color-ink)", overflowX: "auto" as const });
const stateStyle = { minHeight: "240px", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)" } as const;
const errorStyle = { padding: "12px 14px", borderRadius: "14px", background: "rgba(220,38,38,0.08)", color: "var(--x-color-danger)", border: "1px solid rgba(220,38,38,0.16)" } as const;
