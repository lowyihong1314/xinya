import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useUserState } from "../../app/UserState";
import { ensureDesignTokens } from "../../theme/designTokens";
import { deleteMySongbookEdit, fetchSongbookEntry, saveMySongbookEdit } from "./api";
import type { SongbookEntry, SongbookVersionOption } from "./types";

const FONT_SIZE_STORAGE_KEY = "xinya.changyou.fontSize";
const HIDE_NAV_STORAGE_KEY = "xinya.changyou.hideNav";
const CHORD_FAMILY_STORAGE_KEY = "xinya.changyou.chordFamily";
const DEFAULT_FONT_SIZE = 18;
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 30;
type ChordFamily = "original" | "C" | "D" | "E" | "F" | "G" | "A" | "B";
const CHORD_FAMILY_OPTIONS: ChordFamily[] = ["original", "C", "D", "E", "F", "G", "A", "B"];
const FAMILY_OFFSETS: Record<Exclude<ChordFamily, "original">, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX: Record<string, number> = { C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, F: 5, "E#": 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11 };

function getPreferredNoteName(index: number, family: Exclude<ChordFamily, "original">) {
  if (family === "F") return FLAT_NAMES[index];
  return SHARP_NAMES[index];
}
function transposeRoot(root: string, offset: number, family: Exclude<ChordFamily, "original">) {
  const noteIndex = NOTE_INDEX[root.trim()];
  if (noteIndex == null) return root;
  return getPreferredNoteName((noteIndex + offset + 12) % 12, family);
}
function transposeChordToken(token: string, targetFamily: Exclude<ChordFamily, "original">) {
  const trimmed = token.trim();
  if (!trimmed || trimmed === "|" || trimmed === "/") return token;
  const match = trimmed.match(/^([A-G](?:#|b)?)([^/]*?)(?:\/([A-G](?:#|b)?))?$/);
  if (!match) return token;
  const [, root, suffix = "", bass] = match;
  const offset = FAMILY_OFFSETS[targetFamily];
  const nextRoot = transposeRoot(root, offset, targetFamily);
  const nextBass = bass ? transposeRoot(bass, offset, targetFamily) : null;
  return `${nextRoot}${suffix}${nextBass ? `/${nextBass}` : ""}`;
}
function isChordLikeToken(token: string) {
  return /^([A-G](?:#|b)?)([^/]*?)(?:\/([A-G](?:#|b)?))?$/.test(token.trim());
}
function isChordLine(line: string) {
  const pieces = line.split(/(\s+|\|)/).filter(Boolean);
  const meaningful = pieces.filter((piece) => piece.trim() && piece !== "|");
  if (!meaningful.length) return false;
  return meaningful.every(isChordLikeToken);
}
function transposeChordLine(line: string, targetFamily: Exclude<ChordFamily, "original">) {
  let result = "";
  let token = "";
  const flush = () => {
    if (!token) return;
    result += isChordLikeToken(token) ? transposeChordToken(token, targetFamily) : token;
    token = "";
  };
  for (const char of line) {
    if (char === "|" || char === " " || char === "\t") {
      flush();
      result += char;
    } else {
      token += char;
    }
  }
  flush();
  return result;
}
function transformChordContent(content: string, targetFamily: ChordFamily) {
  if (targetFamily === "original") return content;
  return content.split("\n").map((line) => (isChordLine(line) ? transposeChordLine(line, targetFamily) : line)).join("\n");
}

export function ChangyouDetailPage() {
  ensureDesignTokens();
  const navigate = useNavigate();
  const { entryId } = useParams();
  const { isAuthenticated, loadingUser, openLogin, isMobile } = useUserState();
  const [entry, setEntry] = useState<SongbookEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorValue, setEditorValue] = useState("");
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_FONT_SIZE;
    const saved = Number(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_FONT_SIZE && saved <= MAX_FONT_SIZE ? saved : DEFAULT_FONT_SIZE;
  });
  const [hideNav, setHideNav] = useState<boolean>(() => typeof window !== "undefined" && window.localStorage.getItem(HIDE_NAV_STORAGE_KEY) === "1");
  const [chordFamily, setChordFamily] = useState<ChordFamily>(() => {
    if (typeof window === "undefined") return "original";
    const saved = window.localStorage.getItem(CHORD_FAMILY_STORAGE_KEY) as ChordFamily | null;
    return saved && CHORD_FAMILY_OPTIONS.includes(saved) ? saved : "original";
  });
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const versionPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loadingUser && !isAuthenticated) openLogin();
  }, [loadingUser, isAuthenticated, openLogin]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(CHORD_FAMILY_STORAGE_KEY, chordFamily);
  }, [chordFamily]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(HIDE_NAV_STORAGE_KEY, hideNav ? "1" : "0");
    const navbar = document.getElementById("base_navbar");
    if (navbar) navbar.style.display = hideNav ? "none" : "flex";
    return () => {
      const currentNavbar = document.getElementById("base_navbar");
      if (currentNavbar) currentNavbar.style.display = "flex";
    };
  }, [hideNav]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (settingsOpen && settingsRef.current && !settingsRef.current.contains(event.target as Node)) setSettingsOpen(false);
      if (versionPickerOpen && versionPickerRef.current && !versionPickerRef.current.contains(event.target as Node)) setVersionPickerOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setVersionPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [settingsOpen, versionPickerOpen]);

  async function loadEntry(editorUserId?: number | null) {
    if (!entryId) return;
    const response = await fetchSongbookEntry(Number(entryId), editorUserId);
    setEntry(response.entry);
    setEditorValue(response.entry.content || "");
  }

  useEffect(() => {
    if (!isAuthenticated || !entryId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setEditing(false);
    fetchSongbookEntry(Number(entryId))
      .then((response) => {
        if (!cancelled) {
          setEntry(response.entry);
          setEditorValue(response.entry.content || "");
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [entryId, isAuthenticated]);

  const renderedContent = useMemo(() => {
    const source = editing ? editorValue : (entry?.content || "");
    return transformChordContent(source, chordFamily);
  }, [entry, chordFamily, editing, editorValue]);
  const titleText = useMemo(() => entry ? `${entry.song_number ? `${entry.song_number}. ` : ""}${entry.title}` : "歌曲详情", [entry]);
  const versionOptions = useMemo(() => entry?.versions || [], [entry]);

  async function handleSaveEdit() {
    if (!entry) return;
    setSaving(true);
    setError("");
    try {
      const response = await saveMySongbookEdit(entry.id, editorValue);
      setEntry(response.entry);
      setEditorValue(response.entry.content || "");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetMyEdit() {
    if (!entry) return;
    setSaving(true);
    setError("");
    try {
      const response = await deleteMySongbookEdit(entry.id);
      setEntry(response.entry);
      setEditorValue(response.entry.content || "");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复默认失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePickVersion(version: SongbookVersionOption) {
    if (!entry) return;
    setLoading(true);
    setError("");
    try {
      await loadEntry(version.kind === "user" ? version.user_id ?? undefined : undefined);
      setEditing(false);
      setVersionPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换版本失败");
    } finally {
      setLoading(false);
    }
  }

  if (loadingUser) return <div style={stateStyle}>加载中…</div>;
  if (!isAuthenticated) return <div style={stateStyle}>请先登录后再访问唱游页面。</div>;

  return (
    <div style={pageStyle(hideNav)}>
      <div style={topBarStyle(isMobile)}>
        <button type="button" onClick={() => navigate("/changyou")} style={backButtonStyle}>← 返回歌单</button>
        <div style={topRightStyle}>
          <div style={versionPickerWrapStyle} ref={versionPickerRef}>
            <button type="button" onClick={() => setVersionPickerOpen((open) => !open)} style={versionButtonStyle}>
              {entry?.active_version_label || "原版"} ▾
            </button>
            {versionPickerOpen ? (
              <div style={versionPopupStyle}>
                {versionOptions.map((option, index) => {
                  const active = option.kind === entry?.active_version && (option.kind === "base" || option.user_id === entry?.active_editor_user_id);
                  return (
                    <button key={`${option.kind}-${option.user_id ?? "base"}-${index}`} type="button" onClick={() => void handlePickVersion(option)} style={versionItemStyle(active)}>
                      <div style={versionItemTitleStyle}>{index === 0 ? "原版" : option.label}</div>
                      <div style={versionItemMetaStyle}>{option.is_me ? "我" : option.editor_name || "默认"}</div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={() => setEditing((value) => !value)} style={editButtonStyle}>{editing ? "取消编辑" : "✏️ 编辑"}</button>
          <div ref={settingsRef} style={{ position: "relative" }}>
            <button type="button" onClick={() => setSettingsOpen((open) => !open)} style={settingsButtonStyle}>⚙️ 设置</button>
            {settingsOpen ? (
              <div style={settingsPopupStyle}>
                <div style={settingsSectionStyle}>
                  <div style={settingsLabelStyle}>显示</div>
                  <label style={toggleRowStyle}><input type="checkbox" checked={hideNav} onChange={(event) => setHideNav(event.target.checked)} /><span>隐藏导航栏</span></label>
                </div>
                <div style={settingsSectionStyle}>
                  <div style={settingsLabelStyle}>智能调整 chord family</div>
                  <div style={chipRowStyle}>
                    {CHORD_FAMILY_OPTIONS.map((option) => (
                      <button key={option} type="button" onClick={() => setChordFamily(option)} style={variantChipStyle(chordFamily === option)}>
                        {option === "original" ? "原始" : `${option} family`}
                      </button>
                    ))}
                  </div>
                  {chordFamily !== "original" ? <div style={hintStyle}>所有转调都基于当前载入内容实时生成。</div> : <div style={hintStyle}>当前显示你选中的版本内容。</div>}
                </div>
                <div style={settingsSectionStyle}>
                  <div style={settingsLabelStyle}>字体大小</div>
                  <div style={fontControlRowStyle}>
                    <button type="button" onClick={() => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 1))} style={fontButtonStyle}>A-</button>
                    <div style={fontValueStyle}>{fontSize}px</div>
                    <button type="button" onClick={() => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 1))} style={fontButtonStyle}>A+</button>
                  </div>
                  <input type="range" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} style={sliderStyle} />
                </div>
              </div>
            ) : null}
          </div>
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
              <span>当前版本：{entry.active_version_label || "原版"}</span>
            </div>
          </div>
          {editing ? (
            <div style={editorWrapStyle}>
              <textarea value={editorValue} onChange={(event) => setEditorValue(event.target.value)} style={editorStyle(fontSize)} />
              <div style={editorActionsStyle}>
                {entry.has_user_override ? <button type="button" onClick={() => void handleResetMyEdit()} style={secondaryDangerButtonStyle} disabled={saving}>{saving ? "处理中..." : "恢复默认版"}</button> : null}
                <button type="button" onClick={() => void handleSaveEdit()} style={primaryButtonStyle} disabled={saving}>{saving ? "保存中..." : "保存我的编辑版"}</button>
              </div>
            </div>
          ) : (
            <pre style={contentStyle(fontSize)}>{renderedContent}</pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

const pageStyle = (hideNav: boolean) => ({ minHeight: hideNav ? "100vh" : "calc(100vh - 60px)", padding: "20px", background: "linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))", boxSizing: "border-box" as const, overflowX: "hidden" as const });
const topBarStyle = (isMobile: boolean) => ({ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", flexDirection: isMobile ? "column" : "row", gap: "12px", marginBottom: "16px" });
const topRightStyle = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" as const };
const backButtonStyle = { alignSelf: "flex-start", padding: "12px 16px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const settingsButtonStyle = { padding: "10px 14px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const editButtonStyle = { padding: "10px 14px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const versionPickerWrapStyle = { position: "relative" as const };
const versionButtonStyle = { padding: "10px 14px", borderRadius: "999px", border: "1px solid var(--x-color-line)", background: "var(--x-color-accent-tint-strong)", color: "var(--x-color-accent-strong)", fontWeight: 800, cursor: "pointer" } as const;
const versionPopupStyle = { position: "absolute" as const, top: "calc(100% + 8px)", left: 0, zIndex: 20, width: "min(320px, calc(100vw - 40px))", maxHeight: "70vh", overflowY: "auto" as const, padding: "10px", borderRadius: "18px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 18px 40px var(--x-color-shadow-soft)" } as const;
const versionItemStyle = (active: boolean) => ({ width: "100%", padding: "12px 14px", borderRadius: "14px", border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line-soft)", background: active ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel)", textAlign: "left" as const, marginBottom: "8px", cursor: "pointer" });
const versionItemTitleStyle = { fontWeight: 800, color: "var(--x-color-ink)" } as const;
const versionItemMetaStyle = { marginTop: "4px", fontSize: "12px", color: "var(--x-color-ink-muted)" } as const;
const settingsPopupStyle = { position: "absolute" as const, top: "calc(100% + 8px)", right: 0, zIndex: 20, width: "min(340px, calc(100vw - 40px))", maxHeight: "70vh", overflowY: "auto" as const, padding: "14px", borderRadius: "18px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 18px 40px var(--x-color-shadow-soft)" } as const;
const settingsSectionStyle = { display: "grid", gap: "10px", marginBottom: "14px" } as const;
const settingsLabelStyle = { fontSize: "13px", fontWeight: 800, color: "var(--x-color-ink-muted)" } as const;
const toggleRowStyle = { display: "flex", alignItems: "center", gap: "10px", color: "var(--x-color-ink)" } as const;
const chipRowStyle = { display: "flex", gap: "8px", flexWrap: "wrap" as const };
const variantChipStyle = (active: boolean) => ({ padding: "10px 14px", borderRadius: "999px", border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)", background: active ? "var(--x-color-accent)" : "var(--x-color-panel)", color: active ? "white" : "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" });
const hintStyle = { fontSize: "12px", lineHeight: 1.6, color: "var(--x-color-ink-muted)" } as const;
const fontControlRowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } as const;
const fontButtonStyle = { padding: "10px 14px", borderRadius: "12px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" } as const;
const fontValueStyle = { minWidth: "64px", textAlign: "center" as const, fontWeight: 800, color: "var(--x-color-ink)" } as const;
const sliderStyle = { width: "100%" } as const;
const readerStyle = (isMobile: boolean) => ({ width: "100%", maxWidth: "980px", minWidth: 0, margin: "0 auto", padding: isMobile ? "18px" : "28px", borderRadius: "24px", background: "var(--x-color-panel-strongest)", border: "1px solid var(--x-color-line-soft)", boxShadow: "0 20px 50px var(--x-color-shadow-soft)", boxSizing: "border-box" as const, overflowX: "hidden" as const });
const headerStyle = { paddingBottom: "16px", marginBottom: "16px", borderBottom: "1px solid var(--x-color-line-soft)" } as const;
const eyebrowStyle = { fontSize: "12px", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" } as const;
const titleStyle = { margin: "8px 0 0", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 900, color: "var(--x-color-ink)" } as const;
const metaStyle = { display: "flex", gap: "10px", flexWrap: "wrap" as const, marginTop: "12px", fontSize: "13px", color: "var(--x-color-ink-muted)" } as const;
const contentStyle = (fontSize: number) => ({ margin: 0, width: "100%", maxWidth: "100%", minWidth: 0, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, overflowWrap: "anywhere" as const, boxSizing: "border-box" as const, tabSize: 8 as const, MozTabSize: 8 as const, fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace', lineHeight: 1.85, fontSize: `${fontSize}px`, color: "var(--x-color-ink)", overflowX: "auto" as const });
const editorWrapStyle = { display: "grid", gap: "14px" } as const;
const editorStyle = (fontSize: number) => ({ width: "100%", minHeight: "60vh", padding: "16px", borderRadius: "16px", border: "1px solid var(--x-color-line)", background: "var(--x-color-panel)", boxSizing: "border-box" as const, whiteSpace: "pre-wrap" as const, tabSize: 8 as const, MozTabSize: 8 as const, fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace', lineHeight: 1.85, fontSize: `${fontSize}px`, color: "var(--x-color-ink)" });
const editorActionsStyle = { display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" as const };
const primaryButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))", color: "white", fontWeight: 800, cursor: "pointer" } as const;
const secondaryDangerButtonStyle = { padding: "12px 18px", borderRadius: "999px", border: "1px solid rgba(220,38,38,0.2)", background: "rgba(220,38,38,0.08)", color: "var(--x-color-danger)", fontWeight: 800, cursor: "pointer" } as const;
const stateStyle = { minHeight: "240px", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)" } as const;
const errorStyle = { padding: "12px 14px", borderRadius: "14px", background: "rgba(220,38,38,0.08)", color: "var(--x-color-danger)", border: "1px solid rgba(220,38,38,0.16)" } as const;
