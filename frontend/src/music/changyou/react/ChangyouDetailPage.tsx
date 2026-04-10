import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useUserState } from "../../../app/UserState";
import { useBaseNavbarVisibility } from "../../../router/AppChromeContext";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { CHANGYOU_PATH } from "../../router/paths";
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
const FAMILY_OFFSETS: Record<Exclude<ChordFamily, "original">, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX: Record<string, number> = {
  C: 0,
  "B#": 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  "E#": 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

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
  return content
    .split("\n")
    .map((line) => (isChordLine(line) ? transposeChordLine(line, targetFamily) : line))
    .join("\n");
}

function buildVersionHelperText(entry: SongbookEntry | null) {
  if (!entry) return "当前显示原版内容。";
  if (entry.active_version === "user") {
    return `当前显示 ${entry.active_editor_name || "个人"} 版本，可继续另存为自己的编辑版。`;
  }
  return "当前显示原版内容，可以切换到其他成员共享的编辑版。";
}

function formatVersionMeta(option: SongbookVersionOption) {
  if (option.kind === "base") return "默认原版";
  if (option.is_me) return "我的编辑版";
  return option.editor_name || "成员版本";
}

export function ChangyouDetailPage() {
  useEnsureDesignTokens();

  const navigate = useNavigate();
  const { entryId } = useParams();
  const { isMobile } = useUserState();
  const [entry, setEntry] = useState<SongbookEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [editorValue, setEditorValue] = useState("");
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_FONT_SIZE;
    const saved = Number(window.localStorage.getItem(FONT_SIZE_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_FONT_SIZE && saved <= MAX_FONT_SIZE
      ? saved
      : DEFAULT_FONT_SIZE;
  });
  const [hideNav, setHideNav] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem(HIDE_NAV_STORAGE_KEY) === "1",
  );
  const [chordFamily, setChordFamily] = useState<ChordFamily>(() => {
    if (typeof window === "undefined") return "original";
    const saved = window.localStorage.getItem(CHORD_FAMILY_STORAGE_KEY) as ChordFamily | null;
    return saved && CHORD_FAMILY_OPTIONS.includes(saved) ? saved : "original";
  });

  useBaseNavbarVisibility(!hideNav);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
    }
  }, [fontSize]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CHORD_FAMILY_STORAGE_KEY, chordFamily);
    }
  }, [chordFamily]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HIDE_NAV_STORAGE_KEY, hideNav ? "1" : "0");
    }
  }, [hideNav]);

  async function loadEntry(editorUserId?: number | null) {
    if (!entryId) return;
    const response = await fetchSongbookEntry(
      Number(entryId),
      editorUserId
        ? { versionKind: "user", editorUserId }
        : { versionKind: "base" },
    );
    setEntry(response.entry);
    setEditorValue(response.entry.content || "");
  }

  useEffect(() => {
    if (!entryId) return;
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
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const renderedContent = useMemo(() => {
    const source = editing ? editorValue : entry?.content || "";
    return transformChordContent(source, chordFamily);
  }, [editing, editorValue, entry, chordFamily]);

  const titleText = useMemo(
    () => (entry ? `${entry.song_number ? `${entry.song_number}. ` : ""}${entry.title}` : "歌曲详情"),
    [entry],
  );
  const versionOptions = useMemo(() => entry?.versions || [], [entry]);
  const lineCount = useMemo(
    () => renderedContent.split("\n").filter((line) => line.trim()).length,
    [renderedContent],
  );
  const activeVersionNote = useMemo(() => buildVersionHelperText(entry), [entry]);

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
      await loadEntry(version.kind === "user" ? version.user_id ?? undefined : null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换版本失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={pageStyle(hideNav)}>
      <div style={pageInnerStyle}>
        <div style={topBarStyle(isMobile)}>
          <button type="button" onClick={() => navigate(CHANGYOU_PATH)} style={backButtonStyle(isMobile)}>
            ← 返回歌单
          </button>
          {entry ? (
            <div style={topSummaryStyle}>
              <span style={topSummaryPillStyle}>{entry.variant} family</span>
              <span style={topSummaryPillStyle}>Key {entry.selected_key || "-"}</span>
              <span style={topSummaryPillStyle}>{entry.active_version_label || "原版"}</span>
            </div>
          ) : null}
        </div>

        {loading ? <div style={stateStyle}>加载歌曲中…</div> : null}
        {!loading && error ? <div style={errorStyle}>{error}</div> : null}

        {!loading && entry ? (
          <div style={detailLayoutStyle(isMobile)}>
            <aside style={controlColumnStyle(isMobile)}>
              <section style={sideCardStyle}>
                <div style={sideEyebrowStyle}>当前歌曲</div>
                <div style={sideTitleStyle}>{titleText}</div>
                <div style={sideCopyStyle}>{activeVersionNote}</div>
                <div style={miniStatGridStyle}>
                  <MiniStat label="字号" value={`${fontSize}px`} />
                  <MiniStat
                    label="Chord"
                    value={chordFamily === "original" ? "原始" : `${chordFamily} family`}
                  />
                  <MiniStat label="歌词行" value={String(lineCount)} />
                  <MiniStat label="我的编辑" value={entry.has_user_override ? "已保存" : "未保存"} />
                </div>
              </section>

              <section style={sideCardStyle}>
                <div style={sectionLabelStyle}>阅读设置</div>
                <label style={toggleRowStyle}>
                  <input
                    type="checkbox"
                    checked={hideNav}
                    onChange={(event) => setHideNav(event.target.checked)}
                  />
                  <span>隐藏导航栏，专注阅读</span>
                </label>

                <div style={settingsBlockStyle}>
                  <div style={settingsLabelStyle}>Chord family</div>
                  <div style={chipRowStyle}>
                    {CHORD_FAMILY_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setChordFamily(option)}
                        style={variantChipStyle(chordFamily === option)}
                      >
                        {option === "original" ? "原始" : `${option} family`}
                      </button>
                    ))}
                  </div>
                  <div style={hintStyle}>
                    {chordFamily === "original"
                      ? "当前直接显示你选中的版本内容。"
                      : "当前在不改动原文的情况下实时转调。"}
                  </div>
                </div>

                <div style={settingsBlockStyle}>
                  <div style={settingsLabelStyle}>字体大小</div>
                  <div style={fontControlRowStyle}>
                    <button
                      type="button"
                      onClick={() => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 1))}
                      style={fontButtonStyle}
                    >
                      A-
                    </button>
                    <div style={fontValueStyle}>{fontSize}px</div>
                    <button
                      type="button"
                      onClick={() => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 1))}
                      style={fontButtonStyle}
                    >
                      A+
                    </button>
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
              </section>

              <section style={sideCardStyle}>
                <div style={sectionLabelStyle}>版本切换</div>
                <div style={versionListStyle}>
                  {versionOptions.map((option, index) => {
                    const active =
                      option.kind === entry.active_version &&
                      (option.kind === "base" || option.user_id === entry.active_editor_user_id);
                    return (
                      <button
                        key={`${option.kind}-${option.user_id ?? "base"}-${index}`}
                        type="button"
                        onClick={() => void handlePickVersion(option)}
                        style={versionItemStyle(active)}
                      >
                        <div style={versionItemTitleStyle}>
                          {index === 0 ? "原版" : option.label}
                        </div>
                        <div style={versionItemMetaStyle}>{formatVersionMeta(option)}</div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section style={sideCardStyle}>
                <div style={sectionLabelStyle}>我的编辑</div>
                <div style={actionStackStyle}>
                  <button
                    type="button"
                    onClick={() => setEditing((value) => !value)}
                    style={secondaryButtonStyle}
                  >
                    {editing ? "取消编辑" : "开始编辑"}
                  </button>
                  {editing ? (
                    <button
                      type="button"
                      onClick={() => void handleSaveEdit()}
                      style={primaryButtonStyle}
                      disabled={saving}
                    >
                      {saving ? "保存中..." : "保存我的编辑版"}
                    </button>
                  ) : null}
                  {entry.has_user_override ? (
                    <button
                      type="button"
                      onClick={() => void handleResetMyEdit()}
                      style={dangerButtonStyle}
                      disabled={saving}
                    >
                      {saving ? "处理中..." : "恢复默认版"}
                    </button>
                  ) : null}
                </div>
                <div style={hintStyle}>
                  你的编辑版只影响自己的阅读体验，不会直接覆盖原版内容。
                </div>
              </section>
            </aside>

            <main style={readerPanelStyle(isMobile)}>
              <section style={readerHeroStyle(isMobile)}>
                <div style={readerEyebrowStyle}>Changyou Reader</div>
                <h1 style={readerTitleStyle(isMobile)}>{titleText}</h1>
                <p style={readerCopyStyle}>{activeVersionNote}</p>
                <div style={metaWrapStyle}>
                  <span style={metaPillStyle}>原调：{entry.original_key || "-"}</span>
                  <span style={metaPillStyle}>选调：{entry.selected_key || "-"}</span>
                  <span style={metaPillStyle}>BPM：{entry.bpm || "-"}</span>
                  <span style={metaPillStyle}>拍号：{entry.time_signature || "-"}</span>
                  <span style={metaPillStyle}>版本：{entry.active_version_label || "原版"}</span>
                </div>
              </section>

              {editing ? (
                <div style={editorWrapStyle}>
                  <textarea
                    value={editorValue}
                    onChange={(event) => setEditorValue(event.target.value)}
                    style={editorStyle(fontSize)}
                  />
                  <div style={editorHintStyle}>
                    编辑区会保留原本的换行和 chord 排版；保存后会切回只读阅读模式。
                  </div>
                </div>
              ) : (
                <pre style={contentStyle(fontSize)}>{renderedContent}</pre>
              )}
            </main>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={miniStatStyle}>
      <div style={miniStatLabelStyle}>{label}</div>
      <div style={miniStatValueStyle}>{value}</div>
    </div>
  );
}

const pageStyle = (hideNav: boolean): CSSProperties => ({
  minHeight: hideNav ? "100vh" : "calc(100vh - 60px)",
  padding: "20px",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 24%), linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
  boxSizing: "border-box",
  overflowX: "hidden",
});

const pageInnerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "1440px",
  margin: "0 auto",
  display: "grid",
  gap: "16px",
};

const topBarStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: isMobile ? "flex-start" : "center",
  flexDirection: isMobile ? "column" : "row",
  gap: "12px",
});

const backButtonStyle = (isMobile: boolean): CSSProperties => ({
  alignSelf: "flex-start",
  padding: "12px 16px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
  width: isMobile ? "100%" : undefined,
});

const topSummaryStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const topSummaryPillStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "999px",
  background: "var(--x-color-panel-glass)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 800,
};

const detailLayoutStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 360px",
  gridTemplateAreas: isMobile ? `"sidebar" "reader"` : `"reader sidebar"`,
  alignItems: "start",
  gap: "18px",
});

const controlColumnStyle = (isMobile: boolean): CSSProperties => ({
  gridArea: "sidebar",
  display: "grid",
  gap: "14px",
  position: isMobile ? "static" : "sticky",
  top: isMobile ? undefined : "18px",
});

const sideCardStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "22px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "12px",
};

const sideEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const sideTitleStyle: CSSProperties = {
  fontSize: "22px",
  lineHeight: 1.2,
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const sideCopyStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const miniStatGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
};

const miniStatStyle: CSSProperties = {
  padding: "12px",
  borderRadius: "16px",
  background: "var(--x-color-panel-glass)",
  border: "1px solid var(--x-color-line-soft)",
  display: "grid",
  gap: "4px",
};

const miniStatLabelStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const miniStatValueStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const sectionLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const toggleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  color: "var(--x-color-ink)",
};

const settingsBlockStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const settingsLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const variantChipStyle = (active: boolean): CSSProperties => ({
  padding: "10px 14px",
  borderRadius: "999px",
  border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: active ? "var(--x-color-accent)" : "var(--x-color-panel)",
  color: active ? "white" : "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
});

const hintStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const fontControlRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
};

const fontButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "12px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};

const fontValueStyle: CSSProperties = {
  minWidth: "64px",
  textAlign: "center",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const sliderStyle: CSSProperties = {
  width: "100%",
};

const versionListStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const versionItemStyle = (active: boolean): CSSProperties => ({
  width: "100%",
  padding: "12px 14px",
  borderRadius: "16px",
  border: active ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line-soft)",
  background: active ? "var(--x-color-accent-tint-strong)" : "var(--x-color-panel)",
  textAlign: "left",
  cursor: "pointer",
  display: "grid",
  gap: "4px",
});

const versionItemTitleStyle: CSSProperties = {
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const versionItemMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const actionStackStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "16px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "16px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const dangerButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "16px",
  border: "1px solid rgba(220,38,38,0.18)",
  background: "rgba(220,38,38,0.08)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
  cursor: "pointer",
};

const readerPanelStyle = (isMobile: boolean): CSSProperties => ({
  gridArea: "reader",
  padding: isMobile ? "18px" : "28px",
  borderRadius: "28px",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 20px 50px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "18px",
  minWidth: 0,
  overflowX: "hidden",
});

const readerHeroStyle = (isMobile: boolean): CSSProperties => ({
  padding: isMobile ? "18px 16px" : "22px",
  borderRadius: "22px",
  background:
    "linear-gradient(145deg, rgba(8,28,36,0.04), rgba(15,118,110,0.1), rgba(249,115,22,0.08))",
  border: "1px solid rgba(15,118,110,0.12)",
  display: "grid",
  gap: "12px",
});

const readerEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
};

const readerTitleStyle = (isMobile: boolean): CSSProperties => ({
  margin: 0,
  fontSize: isMobile ? "30px" : "42px",
  lineHeight: 1.04,
  fontWeight: 900,
  color: "var(--x-color-ink)",
});

const readerCopyStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const metaWrapStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const metaPillStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.78)",
  border: "1px solid var(--x-color-line-soft)",
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const contentStyle = (fontSize: number): CSSProperties => ({
  margin: 0,
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
  boxSizing: "border-box",
  tabSize: 8,
  MozTabSize: 8,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  lineHeight: 1.85,
  fontSize: `${fontSize}px`,
  color: "var(--x-color-ink)",
  overflowX: "auto",
  padding: "2px",
});

const editorWrapStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const editorStyle = (fontSize: number): CSSProperties => ({
  width: "100%",
  minHeight: "60vh",
  padding: "16px",
  borderRadius: "18px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxSizing: "border-box",
  whiteSpace: "pre-wrap",
  tabSize: 8,
  MozTabSize: 8,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  lineHeight: 1.85,
  fontSize: `${fontSize}px`,
  color: "var(--x-color-ink)",
});

const editorHintStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const stateStyle: CSSProperties = {
  minHeight: "240px",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
};

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(220,38,38,0.08)",
  color: "var(--x-color-danger)",
  border: "1px solid rgba(220,38,38,0.16)",
};
