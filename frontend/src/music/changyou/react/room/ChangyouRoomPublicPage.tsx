import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ensureProjectionBlocks, splitBlocksForDoublePage, type LyricProjectionBlock } from "../projection";
import type { SongbookEntry } from "../types";
import { connectChangyouRoom } from "./socket";
import { fetchChangyouRoomCurrent, type ChangyouRoom } from "./api";

const FONT_SIZE_STORAGE_KEY = "xinya.changyou.room.fontSize";
const LAYOUT_MODE_STORAGE_KEY = "xinya.changyou.room.layoutMode";
const BACKGROUND_THEME_STORAGE_KEY = "xinya.changyou.room.backgroundTheme";
const OUTER_PADDING_STORAGE_KEY = "xinya.changyou.room.outerPadding";
const LINE_HEIGHT_STORAGE_KEY = "xinya.changyou.room.lineHeight";
const CONTENT_WIDTH_STORAGE_KEY = "xinya.changyou.room.contentWidth";
const COLUMN_GAP_STORAGE_KEY = "xinya.changyou.room.columnGap";
const MARGIN_TOP_STORAGE_KEY = "xinya.changyou.room.marginTop";
const TEXT_GLOW_STORAGE_KEY = "xinya.changyou.room.textGlow";
const SENTENCE_WINDOW_STORAGE_KEY = "xinya.changyou.room.v2.maxSentenceCount";

const DEFAULT_FONT_SIZE = 26;
const MIN_FONT_SIZE = 20;
const MAX_FONT_SIZE = 56;
const DEFAULT_OUTER_PADDING = 0;
const MIN_OUTER_PADDING = 0;
const MAX_OUTER_PADDING = 72;
const DEFAULT_MARGIN_TOP = 0;
const MIN_MARGIN_TOP = 0;
const MAX_MARGIN_TOP = 240;
const DEFAULT_LINE_HEIGHT = 1.85;
const MIN_LINE_HEIGHT = 1.4;
const MAX_LINE_HEIGHT = 2.3;
const DEFAULT_COLUMN_GAP = 28;
const MIN_COLUMN_GAP = 12;
const MAX_COLUMN_GAP = 80;
const NOTIFICATION_TOAST_DURATION_MS = 3000;

type LayoutMode = "single" | "double";
type BackgroundThemeKey = "midnight" | "obsidian" | "paper" | "forest" | "sunset";
type ContentWidthMode = "focus" | "balanced" | "full";
type TextGlowLevel = "off" | "soft" | "strong";
type ChangyouRoomPublicVariant = "default" | "v2";

const SENTENCE_WINDOW_OPTIONS = ["full", "3", "6", "9", "12"] as const;
type SentenceWindowMode = (typeof SENTENCE_WINDOW_OPTIONS)[number];

const SENTENCE_WINDOW_LIMITS: Record<Exclude<SentenceWindowMode, "full">, number> = {
  "3": 3,
  "6": 6,
  "9": 9,
  "12": 12,
};

const BACKGROUND_THEMES: Record<BackgroundThemeKey, { label: string; page: string; overlay: string; textColor: string }> = {
  midnight: {
    label: "深夜",
    page: "linear-gradient(180deg, #07111f 0%, #0b1528 55%, #101b31 100%)",
    overlay:
      "radial-gradient(circle at 18% 14%, rgba(45,212,191,0.16), transparent 24%), radial-gradient(circle at 82% 10%, rgba(96,165,250,0.14), transparent 20%)",
    textColor: "#f8fafc",
  },
  obsidian: {
    label: "影院",
    page: "linear-gradient(180deg, #020617 0%, #030712 52%, #000000 100%)",
    overlay:
      "radial-gradient(circle at 20% 16%, rgba(148,163,184,0.08), transparent 24%), radial-gradient(circle at 80% 12%, rgba(59,130,246,0.12), transparent 18%)",
    textColor: "#f8fafc",
  },
  paper: {
    label: "纸张",
    page: "linear-gradient(180deg, #f8f1e3 0%, #f2e8d6 56%, #ece2cf 100%)",
    overlay:
      "radial-gradient(circle at 16% 12%, rgba(217,119,6,0.10), transparent 22%), radial-gradient(circle at 84% 14%, rgba(120,53,15,0.06), transparent 18%)",
    textColor: "#1f2937",
  },
  forest: {
    label: "松林",
    page: "linear-gradient(180deg, #04140f 0%, #0b2b24 55%, #12352f 100%)",
    overlay:
      "radial-gradient(circle at 18% 14%, rgba(52,211,153,0.16), transparent 24%), radial-gradient(circle at 82% 12%, rgba(110,231,183,0.12), transparent 20%)",
    textColor: "#ecfdf5",
  },
  sunset: {
    label: "晚霞",
    page: "linear-gradient(180deg, #1f1147 0%, #5b2333 44%, #8a4b21 100%)",
    overlay:
      "radial-gradient(circle at 20% 14%, rgba(251,146,60,0.18), transparent 26%), radial-gradient(circle at 84% 10%, rgba(244,114,182,0.16), transparent 22%)",
    textColor: "#fff7ed",
  },
};

const CONTENT_WIDTH_PRESETS: Record<ContentWidthMode, { label: string; maxWidth: string }> = {
  focus: { label: "聚焦", maxWidth: "920px" },
  balanced: { label: "均衡", maxWidth: "1240px" },
  full: { label: "全宽", maxWidth: "min(1640px, calc(100vw - 24px))" },
};

const TEXT_GLOW_PRESETS: Record<TextGlowLevel, { label: string; textShadow: string }> = {
  off: { label: "关闭", textShadow: "none" },
  soft: {
    label: "柔和",
    textShadow: "0 2px 12px rgba(15,23,42,0.24)",
  },
  strong: {
    label: "增强",
    textShadow: "0 4px 18px rgba(15,23,42,0.38), 0 0 28px rgba(248,250,252,0.08)",
  },
};

type SinglePageSentenceItem = {
  text: string;
  blockIndex: number | null;
};

function buildSinglePageSentenceItems(blocks: LyricProjectionBlock[], fallbackContent: string): SinglePageSentenceItem[] {
  const lyricSentences = blocks
    .map((block, blockIndex) => {
      const text = block.text.trim();
      if (!text) return null;
      return {
        text,
        blockIndex,
      } satisfies SinglePageSentenceItem;
    })
    .filter((item): item is SinglePageSentenceItem => Boolean(item));
  if (lyricSentences.length) return lyricSentences;

  return splitIntoBlocks(fallbackContent)
    .map((lines) => lines.join("\n").trim())
    .filter(Boolean)
    .map((text) => ({ text, blockIndex: null }));
}

function readStoredChoice<T extends string>(storageKey: string, options: readonly T[], fallback: T) {
  if (typeof window === "undefined") return fallback;
  const saved = window.localStorage.getItem(storageKey);
  return saved && options.includes(saved as T) ? (saved as T) : fallback;
}

function readStoredNumber(storageKey: string, fallback: number, min: number, max: number) {
  if (typeof window === "undefined") return fallback;
  const saved = Number(window.localStorage.getItem(storageKey));
  if (!Number.isFinite(saved)) return fallback;
  return Math.min(max, Math.max(min, saved));
}

function isWideChar(char: string) {
  return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char);
}

function isSectionBoundary(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith(":")) return true;
  if (/^[A-Z][A-Z0-9 /+#&().-]*\^?$/.test(trimmed) && trimmed === trimmed.toUpperCase()) {
    return true;
  }
  return false;
}

function normalizeLineForWeight(line: string) {
  return line.replace(/\t+/g, " ").replace(/ {2,}/g, " ").trim();
}

function estimateLineWeight(line: string) {
  const normalized = normalizeLineForWeight(line);
  if (!normalized) return 0.6;
  let width = 0;
  for (const char of normalized) {
    width += isWideChar(char) ? 2 : 1;
  }
  return Math.max(1, Math.ceil(width / 24));
}

function splitIntoBlocks(content: string) {
  const lines = content.split(/\r?\n/);
  const blocks: string[][] = [];
  let current: string[] = [];

  const pushCurrent = () => {
    if (!current.length) return;
    blocks.push(current);
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      current.push(line);
      pushCurrent();
      continue;
    }
    if (isSectionBoundary(line) && current.length) {
      pushCurrent();
    }
    current.push(line);
  }

  pushCurrent();
  return blocks.filter((block) => block.some((line) => line.trim()));
}

function buildDoublePageContent(content: string) {
  const blocks = splitIntoBlocks(content);
  if (blocks.length <= 1) {
    return { left: content, right: "" };
  }

  const weights = blocks.map((block) => block.reduce((sum, line) => sum + estimateLineWeight(line), 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  let bestIndex = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = 1; index < blocks.length; index += 1) {
    cumulative += weights[index - 1];
    const leftWeight = cumulative;
    const rightWeight = totalWeight - cumulative;
    if (leftWeight <= 0 || rightWeight <= 0) continue;

    const imbalance = Math.abs(leftWeight - rightWeight);
    const blockBalancePenalty = Math.abs(index - blocks.length / 2) * 0.35;
    const score = imbalance + blockBalancePenalty;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return {
    left: blocks.slice(0, bestIndex).map((block) => block.join("\n")).join("\n"),
    right: blocks.slice(bestIndex).map((block) => block.join("\n")).join("\n"),
  };
}

function buildTextBlockStyle(options: {
  fontSize: number;
  lineHeight: number;
  textColor: string;
  textShadow: string;
}) {
  return {
    margin: 0,
    minWidth: 0,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    fontSize: `${options.fontSize}px`,
    lineHeight: options.lineHeight,
    color: options.textColor,
    tabSize: 8,
    MozTabSize: 8,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    overflowWrap: "anywhere" as const,
    overflowX: "auto" as const,
    boxSizing: "border-box" as const,
    textAlign: "left" as const,
    textShadow: options.textShadow,
  };
}

export function ChangyouRoomPublicPage({
  roomId,
  variant = "default",
}: {
  roomId: string;
  variant?: ChangyouRoomPublicVariant;
}) {
  const [room, setRoom] = useState<ChangyouRoom | null>(null);
  const [entry, setEntry] = useState<SongbookEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHintVisible, setSettingsHintVisible] = useState(false);
  const [notificationToast, setNotificationToast] = useState<{ message: string; updatedAt: number } | null>(null);
  const [songTitleCollapsed, setSongTitleCollapsed] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
    readStoredChoice(LAYOUT_MODE_STORAGE_KEY, ["single", "double"], "single"),
  );
  const [backgroundThemeKey, setBackgroundThemeKey] = useState<BackgroundThemeKey>(() =>
    readStoredChoice(BACKGROUND_THEME_STORAGE_KEY, ["midnight", "obsidian", "paper", "forest", "sunset"], "midnight"),
  );
  const [contentWidthMode, setContentWidthMode] = useState<ContentWidthMode>(() =>
    readStoredChoice(CONTENT_WIDTH_STORAGE_KEY, ["focus", "balanced", "full"], "balanced"),
  );
  const [fontSize, setFontSize] = useState<number>(() =>
    readStoredNumber(FONT_SIZE_STORAGE_KEY, DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE),
  );
  const [outerPadding, setOuterPadding] = useState<number>(() =>
    readStoredNumber(OUTER_PADDING_STORAGE_KEY, DEFAULT_OUTER_PADDING, MIN_OUTER_PADDING, MAX_OUTER_PADDING),
  );
  const [marginTop, setMarginTop] = useState<number>(() =>
    readStoredNumber(MARGIN_TOP_STORAGE_KEY, DEFAULT_MARGIN_TOP, MIN_MARGIN_TOP, MAX_MARGIN_TOP),
  );
  const [lineHeight, setLineHeight] = useState<number>(() =>
    readStoredNumber(LINE_HEIGHT_STORAGE_KEY, DEFAULT_LINE_HEIGHT, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT),
  );
  const [columnGap, setColumnGap] = useState<number>(() =>
    readStoredNumber(COLUMN_GAP_STORAGE_KEY, DEFAULT_COLUMN_GAP, MIN_COLUMN_GAP, MAX_COLUMN_GAP),
  );
  const [textGlowLevel, setTextGlowLevel] = useState<TextGlowLevel>(() =>
    readStoredChoice(TEXT_GLOW_STORAGE_KEY, ["off", "soft", "strong"], "soft"),
  );
  const [sentenceWindowMode, setSentenceWindowMode] = useState<SentenceWindowMode>(() =>
    readStoredChoice(SENTENCE_WINDOW_STORAGE_KEY, SENTENCE_WINDOW_OPTIONS, "full"),
  );
  const anchoredSentenceRef = useRef<HTMLDivElement | null>(null);
  const [anchoredSentenceHeight, setAnchoredSentenceHeight] = useState(0);
  const previousAnchoredSentenceIndexRef = useRef<number | null>(null);
  const [windowMotionOffset, setWindowMotionOffset] = useState(0);
  const [windowMotionReady, setWindowMotionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchChangyouRoomCurrent(roomId)
      .then((response) => {
        if (cancelled) return;
        setRoom(response.room);
        setEntry(response.entry || null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载房间失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    const socket = connectChangyouRoom(roomId);
    socket.on("changyou_room_update", (payload) => {
      setRoom((current) => (current ? { ...current, ...payload.room } : payload.room || current));
      setEntry(payload.entry || null);
    });
    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    document.title = "唱游房间";
    return () => {
      document.title = "唱游房间";
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, layoutMode);
  }, [layoutMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BACKGROUND_THEME_STORAGE_KEY, backgroundThemeKey);
  }, [backgroundThemeKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OUTER_PADDING_STORAGE_KEY, String(outerPadding));
  }, [outerPadding]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MARGIN_TOP_STORAGE_KEY, String(marginTop));
  }, [marginTop]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LINE_HEIGHT_STORAGE_KEY, String(lineHeight));
  }, [lineHeight]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CONTENT_WIDTH_STORAGE_KEY, contentWidthMode);
  }, [contentWidthMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLUMN_GAP_STORAGE_KEY, String(columnGap));
  }, [columnGap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TEXT_GLOW_STORAGE_KEY, textGlowLevel);
  }, [textGlowLevel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SENTENCE_WINDOW_STORAGE_KEY, sentenceWindowMode);
  }, [sentenceWindowMode]);

  useEffect(() => {
    if (loading || error) return;
    setSettingsHintVisible(true);
    const timer = window.setTimeout(() => {
      setSettingsHintVisible(false);
    }, 4200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loading, error, roomId]);

  useEffect(() => {
    if (!settingsOpen) return;
    setSettingsHintVisible(false);
  }, [settingsOpen]);

  useEffect(() => {
    const nextNotification = room?.notification;
    if (!nextNotification?.message || !nextNotification.updated_at) return;
    setNotificationToast({
      message: nextNotification.message,
      updatedAt: nextNotification.updated_at,
    });
    const timer = window.setTimeout(() => {
      setNotificationToast((current) =>
        current?.updatedAt === nextNotification.updated_at ? null : current,
      );
    }, NOTIFICATION_TOAST_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [room?.notification?.message, room?.notification?.updated_at]);

  const backgroundTheme = BACKGROUND_THEMES[backgroundThemeKey];
  const widthPreset = CONTENT_WIDTH_PRESETS[contentWidthMode];
  const textColor = backgroundTheme.textColor;
  const textGlow = TEXT_GLOW_PRESETS[textGlowLevel].textShadow;
  const projectionSourceContent = room?.projection?.content || entry?.content || "";
  const songTitle = useMemo(() => {
    if (!entry) return "";
    return `${entry.song_number ? `${entry.song_number}. ` : ""}${entry.title}`;
  }, [entry]);
  
  useEffect(() => {
    if (!songTitle) return;
    setSongTitleCollapsed(false);
  }, [entry?.id, songTitle]);

  const projectionBlocks = useMemo<LyricProjectionBlock[]>(
    () => ensureProjectionBlocks((room?.projection?.blocks as LyricProjectionBlock[] | undefined) || [], projectionSourceContent),
    [room?.projection?.blocks, projectionSourceContent],
  );
  const doubleProjectionBlocks = useMemo(
    () => splitBlocksForDoublePage(projectionBlocks),
    [projectionBlocks],
  );
  const activeMarkerIndex = room?.projection?.marker_index ?? null;
  const singlePageSentenceItems = useMemo(
    () => buildSinglePageSentenceItems(projectionBlocks, projectionSourceContent),
    [projectionBlocks, projectionSourceContent],
  );
  const anchoredSentenceIndex = useMemo(() => {
    if (!singlePageSentenceItems.length) return -1;
    if (activeMarkerIndex == null) return 0;
    const firstMatchedSentenceIndex = singlePageSentenceItems.findIndex((item) => item.blockIndex === activeMarkerIndex);
    return firstMatchedSentenceIndex >= 0 ? firstMatchedSentenceIndex : 0;
  }, [activeMarkerIndex, singlePageSentenceItems]);
  const windowedSentenceGroups = useMemo(() => {
    if (anchoredSentenceIndex < 0 || !singlePageSentenceItems.length) {
      return {
        leading: [] as string[],
        anchored: "",
        trailing: [] as string[],
      };
    }
    if (sentenceWindowMode === "full") {
      return {
        leading: [] as string[],
        anchored: singlePageSentenceItems[anchoredSentenceIndex]?.text || "",
        trailing: singlePageSentenceItems.slice(anchoredSentenceIndex + 1).map((item) => item.text),
      };
    }

    const limit = SENTENCE_WINDOW_LIMITS[sentenceWindowMode];
    const anchored = singlePageSentenceItems[anchoredSentenceIndex]?.text || "";
    const contextSlots = Math.max(limit - (anchored ? 1 : 0), 0);
    let leadingCount = anchoredSentenceIndex > 0 && contextSlots > 0 ? 1 : 0;
    const nextCount = Math.max(singlePageSentenceItems.length - anchoredSentenceIndex - 1, 0);
    const trailingCount = Math.min(nextCount, Math.max(contextSlots - leadingCount, 0));
    const remainingContextSlots = contextSlots - leadingCount - trailingCount;
    if (remainingContextSlots > 0) {
      leadingCount += Math.min(Math.max(anchoredSentenceIndex - leadingCount, 0), remainingContextSlots);
    }
    const leading = singlePageSentenceItems
      .slice(Math.max(0, anchoredSentenceIndex - leadingCount), anchoredSentenceIndex)
      .map((item) => item.text);
    const trailing = singlePageSentenceItems
      .slice(anchoredSentenceIndex + 1, anchoredSentenceIndex + 1 + trailingCount)
      .map((item) => item.text);

    return {
      leading,
      anchored,
      trailing,
    };
  }, [anchoredSentenceIndex, sentenceWindowMode, singlePageSentenceItems]);
  const useSentenceWindowMode = variant === "v2" && layoutMode === "single" && sentenceWindowMode !== "full" && anchoredSentenceIndex >= 0;
  const leadingSentences = windowedSentenceGroups.leading;
  const anchoredSentence = windowedSentenceGroups.anchored;
  const trailingSentences = windowedSentenceGroups.trailing;

  const singleBlockStyle = buildTextBlockStyle({
    fontSize,
    lineHeight,
    textColor,
    textShadow: textGlow,
  });
  const doubleBlockStyle = buildTextBlockStyle({
    fontSize,
    lineHeight,
    textColor,
    textShadow: textGlow,
  });

  useEffect(() => {
    if (!useSentenceWindowMode) {
      setAnchoredSentenceHeight(0);
      return;
    }
    const node = anchoredSentenceRef.current;
    if (!node) return;

    const updateHeight = () => {
      setAnchoredSentenceHeight(node.getBoundingClientRect().height || 0);
    };

    updateHeight();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateHeight) : null;
    resizeObserver?.observe(node);
    window.addEventListener("resize", updateHeight);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [anchoredSentence, fontSize, lineHeight, useSentenceWindowMode, widthPreset.maxWidth]);

  useLayoutEffect(() => {
    if (!useSentenceWindowMode || anchoredSentenceIndex < 0) {
      previousAnchoredSentenceIndexRef.current = anchoredSentenceIndex;
      setWindowMotionOffset(0);
      setWindowMotionReady(false);
      return;
    }

    const previousIndex = previousAnchoredSentenceIndexRef.current;
    previousAnchoredSentenceIndexRef.current = anchoredSentenceIndex;
    if (previousIndex == null || previousIndex < 0 || previousIndex === anchoredSentenceIndex) {
      setWindowMotionOffset(0);
      setWindowMotionReady(false);
      return;
    }

    const nextOffset = anchoredSentenceIndex > previousIndex ? 42 : -42;
    let frameA = 0;
    let frameB = 0;
    setWindowMotionReady(false);
    setWindowMotionOffset(nextOffset);
    frameA = window.requestAnimationFrame(() => {
      frameB = window.requestAnimationFrame(() => {
        setWindowMotionReady(true);
        setWindowMotionOffset(0);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
    };
  }, [anchoredSentenceIndex, useSentenceWindowMode]);

  function renderProjectionColumn(blocks: LyricProjectionBlock[], baseStyle: ReturnType<typeof buildTextBlockStyle>) {
    return (
      <div style={projectionColumnStyle}>
        {blocks.map((block, index) => {
          const globalIndex = projectionBlocks.findIndex((item) => item.id === block.id);
          const active = block.highlightable && activeMarkerIndex === globalIndex;
          return (
            <div
              key={block.id || `${block.label}-${index}`}
              style={projectionBlockShellStyle(active, backgroundThemeKey)}
            >
              <pre style={projectionTextStyle(baseStyle)}>{block.text}</pre>
            </div>
          );
        })}
      </div>
    );
  }

  function resetDisplaySettings() {
    setLayoutMode("single");
    setBackgroundThemeKey("midnight");
    setContentWidthMode("balanced");
    setFontSize(DEFAULT_FONT_SIZE);
    setOuterPadding(DEFAULT_OUTER_PADDING);
    setMarginTop(DEFAULT_MARGIN_TOP);
    setLineHeight(DEFAULT_LINE_HEIGHT);
    setColumnGap(DEFAULT_COLUMN_GAP);
    setTextGlowLevel("soft");
    setSentenceWindowMode("full");
  }

  if (loading) {
    return <div style={stateShellStyle(backgroundTheme.page, textColor)}>加载中…</div>;
  }

  if (error) {
    return <div style={stateShellStyle(backgroundTheme.page, textColor)}>{error}</div>;
  }

  return (
    <div style={pageStyle(backgroundTheme.page)}>
      <style>{`
        @keyframes changyou-room-setting-burst {
          0% { transform: scale(1) rotate(0deg); box-shadow: 0 18px 40px rgba(2,6,23,0.34); }
          12% { transform: scale(1.22) rotate(-14deg); box-shadow: 0 0 0 0 rgba(45,212,191,0.42), 0 18px 40px rgba(2,6,23,0.34); }
          24% { transform: scale(0.96) rotate(12deg); box-shadow: 0 0 0 16px rgba(45,212,191,0.18), 0 20px 48px rgba(2,6,23,0.4); }
          38% { transform: scale(1.16) rotate(-9deg); box-shadow: 0 0 0 28px rgba(96,165,250,0.12), 0 24px 54px rgba(2,6,23,0.46); }
          52% { transform: scale(1) rotate(7deg); box-shadow: 0 0 0 12px rgba(45,212,191,0.1), 0 20px 44px rgba(2,6,23,0.38); }
          68% { transform: scale(1.12) rotate(-5deg); box-shadow: 0 0 0 0 rgba(45,212,191,0), 0 24px 54px rgba(2,6,23,0.44); }
          100% { transform: scale(1) rotate(0deg); box-shadow: 0 18px 40px rgba(2,6,23,0.34); }
        }
        @keyframes changyou-room-setting-label {
          0% { opacity: 0; transform: translateX(18px) scale(0.92); }
          18% { opacity: 1; transform: translateX(0) scale(1); }
          82% { opacity: 1; transform: translateX(0) scale(1); }
          100% { opacity: 0; transform: translateX(12px) scale(0.96); }
        }
        @keyframes changyou-room-notification-pop {
          0% { opacity: 0; transform: translate3d(-18px, -14px, 0) scale(0.92); }
          12% { opacity: 1; transform: translate3d(0, 0, 0) scale(1.03); }
          20% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
          78% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
          100% { opacity: 0; transform: translate3d(0, -14px, 0) scale(0.97); }
        }
        @keyframes changyou-room-marker-enter {
          0% { transform: scale(0.96); opacity: 0.6; }
          60% { transform: scale(1.032); opacity: 1; }
          100% { transform: scale(1.024); opacity: 1; }
        }
        @keyframes changyou-room-sentence-switch {
          0% { opacity: 0; transform: scale(0.988); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes changyou-room-sentence-focus {
          0%, 100% { filter: brightness(1) saturate(1); }
          50% { filter: brightness(1.08) saturate(1.18); }
        }
      `}</style>
      <div style={ambientGlowStyle(backgroundTheme.overlay)} />
      {notificationToast ? (
        <div style={notificationToastWrapStyle}>
          <div key={notificationToast.updatedAt} style={notificationToastStyle(backgroundThemeKey)}>
            {notificationToast.message}
          </div>
        </div>
      ) : null}
      {songTitle ? (
        <div style={songTitleDockWrapStyle}>
          {songTitleCollapsed ? (
            <button
              type="button"
              onClick={() => setSongTitleCollapsed(false)}
              style={songTitleCollapsedButtonStyle(backgroundThemeKey)}
            >
              歌名
            </button>
          ) : (
            <div style={songTitleDockStyle(backgroundThemeKey)}>
              <div style={songTitleLabelStyle}>当前歌曲</div>
              <div style={songTitleValueStyle}>{songTitle}</div>
              <button
                type="button"
                onClick={() => setSongTitleCollapsed(true)}
                style={songTitleCloseButtonStyle(backgroundThemeKey)}
              >
                收起
              </button>
            </div>
          )}
        </div>
      ) : null}
      <div style={settingsWrapStyle}>
        {settingsHintVisible ? <div style={settingsHintStyle}>设置在这里</div> : null}
        <button
          type="button"
          aria-label="显示字体设置"
          onClick={() => setSettingsOpen((open) => !open)}
          style={settingsButtonStyle(settingsHintVisible)}
        >
          <svg viewBox="0 0 24 24" style={settingsIconStyle} aria-hidden="true">
            <path
              d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.28 7.28 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.43 7.43 0 0 0-.05.94c0 .32.02.63.05.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              fill="currentColor"
            />
          </svg>
        </button>
        {settingsOpen ? (
          <div style={settingsPanelStyle}>
            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle}>显示模式</div>
              <div style={twoColumnButtonGridStyle}>
                <button type="button" onClick={() => setLayoutMode("single")} style={modeButtonStyle(layoutMode === "single")}>
                  单页模式
                </button>
                <button type="button" onClick={() => setLayoutMode("double")} style={modeButtonStyle(layoutMode === "double")}>
                  双页模式
                </button>
              </div>
            </div>

            {variant === "v2" && layoutMode === "single" ? (
              <div style={settingsGroupStyle}>
                <div style={settingsTitleStyle}>窗口卡片数</div>
                <div style={settingsCaptionStyle}>焦点卡片固定在中线，并跟随当前标记段同步切换</div>
                <div style={sentenceWindowGridStyle}>
                  {SENTENCE_WINDOW_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSentenceWindowMode(option)}
                      style={modeButtonStyle(sentenceWindowMode === option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle}>背景主题</div>
              <div style={settingsCaptionStyle}>文字会自动切成适合这个背景的反差色</div>
              <div style={swatchGridStyle}>
                {(Object.entries(BACKGROUND_THEMES) as Array<[BackgroundThemeKey, (typeof BACKGROUND_THEMES)[BackgroundThemeKey]]>).map(([key, theme]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBackgroundThemeKey(key)}
                    style={swatchButtonStyle(backgroundThemeKey === key)}
                  >
                    <span style={themePreviewStyle(theme.page)} />
                    <span>{theme.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle}>内容宽度</div>
              <div style={threeColumnButtonGridStyle}>
                {(Object.entries(CONTENT_WIDTH_PRESETS) as Array<[ContentWidthMode, (typeof CONTENT_WIDTH_PRESETS)[ContentWidthMode]]>).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setContentWidthMode(key)}
                    style={modeButtonStyle(contentWidthMode === key)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle}>文字光效</div>
              <div style={threeColumnButtonGridStyle}>
                {(Object.entries(TEXT_GLOW_PRESETS) as Array<[TextGlowLevel, (typeof TEXT_GLOW_PRESETS)[TextGlowLevel]]>).map(([key, preset]) => (
                  <button key={key} type="button" onClick={() => setTextGlowLevel(key)} style={modeButtonStyle(textGlowLevel === key)}>
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <SettingSlider
              title="字体大小"
              valueLabel={`${fontSize}px`}
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              step={1}
              value={fontSize}
              onChange={(value) => setFontSize(value)}
              onDecrease={() => setFontSize((value) => Math.max(MIN_FONT_SIZE, value - 2))}
              onIncrease={() => setFontSize((value) => Math.min(MAX_FONT_SIZE, value + 2))}
            />

            <SettingSlider
              title="行距"
              valueLabel={lineHeight.toFixed(2)}
              min={MIN_LINE_HEIGHT}
              max={MAX_LINE_HEIGHT}
              step={0.05}
              value={lineHeight}
              onChange={(value) => setLineHeight(Number(value.toFixed(2)))}
            />

            <SettingSlider
              title="外围留白"
              valueLabel={`${outerPadding}px`}
              min={MIN_OUTER_PADDING}
              max={MAX_OUTER_PADDING}
              step={1}
              value={outerPadding}
              onChange={(value) => setOuterPadding(value)}
            />

            <SettingSlider
              title="顶部距离"
              valueLabel={`${marginTop}px`}
              min={MIN_MARGIN_TOP}
              max={MAX_MARGIN_TOP}
              step={1}
              value={marginTop}
              onChange={(value) => setMarginTop(value)}
            />

            <SettingSlider
              title="双页间距"
              valueLabel={`${columnGap}px`}
              min={MIN_COLUMN_GAP}
              max={MAX_COLUMN_GAP}
              step={1}
              value={columnGap}
              onChange={(value) => setColumnGap(value)}
            />

            <div style={settingsFooterStyle}>
              <button type="button" onClick={resetDisplaySettings} style={resetButtonStyle}>
                重置 UI
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {!entry ? (
        <div style={stateShellStyle(backgroundTheme.page, textColor)}>等待歌词…</div>
      ) : layoutMode === "double" ? (
        <div style={contentShellStyle(widthPreset.maxWidth, outerPadding, marginTop)}>
          <div style={doublePageStyle(columnGap, outerPadding, marginTop)}>
            {renderProjectionColumn(doubleProjectionBlocks.left, doubleBlockStyle)}
            {renderProjectionColumn(doubleProjectionBlocks.right, doubleBlockStyle)}
          </div>
        </div>
      ) : useSentenceWindowMode ? (
        <div style={contentShellStyle(widthPreset.maxWidth, outerPadding, marginTop)}>
          <div style={sentenceWindowShellStyle(outerPadding, marginTop)}>
            <div style={sentenceMotionLayerStyle(windowMotionOffset, windowMotionReady)}>
              {leadingSentences.length ? (
                <div style={sentenceLeadWrapStyle(anchoredSentenceHeight)}>
                  <div style={sentenceLeadListStyle}>
                    {leadingSentences.map((sentence, index) => (
                      <div
                        key={`${sentence}-${index}-lead`}
                        style={sentenceTrailCardStyle(backgroundThemeKey, singleBlockStyle)}
                      >
                        {sentence}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div style={sentenceAnchorWrapStyle}>
                <div
                  key={anchoredSentence}
                  ref={anchoredSentenceRef}
                  style={sentenceAnchorCardStyle(backgroundThemeKey, singleBlockStyle)}
                >
                  {anchoredSentence}
                </div>
              </div>
              {trailingSentences.length ? (
                <div style={sentenceTrailWrapStyle(anchoredSentenceHeight)}>
                  <div style={sentenceTrailListStyle}>
                    {trailingSentences.map((sentence, index) => (
                      <div
                        key={`${sentence}-${index}`}
                        style={sentenceTrailCardStyle(backgroundThemeKey, singleBlockStyle)}
                      >
                        {sentence}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div style={contentShellStyle(widthPreset.maxWidth, outerPadding, marginTop)}>
          <div style={singlePageStyle(outerPadding, marginTop, singleBlockStyle)}>
            {renderProjectionColumn(projectionBlocks, singleBlockStyle)}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingSlider(props: {
  title: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  onDecrease?: () => void;
  onIncrease?: () => void;
}) {
  return (
    <div style={settingsGroupStyle}>
      <div style={settingsTitleStyle}>{props.title}</div>
      <div style={sliderValueStyle}>{props.valueLabel}</div>
      {props.onDecrease || props.onIncrease ? (
        <div style={twoColumnButtonGridStyle}>
          <button type="button" onClick={props.onDecrease} style={adjustButtonStyle} disabled={!props.onDecrease}>
            A-
          </button>
          <button type="button" onClick={props.onIncrease} style={adjustButtonStyle} disabled={!props.onIncrease}>
            A+
          </button>
        </div>
      ) : null}
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        style={sliderStyle}
      />
    </div>
  );
}

const pageStyle = (background: string) => ({
  minHeight: "100vh",
  background,
  color: "#f8fafc",
  position: "relative" as const,
  overflow: "hidden",
});

const ambientGlowStyle = (overlay: string) => ({
  position: "absolute" as const,
  inset: "0",
  background: overlay,
  pointerEvents: "none" as const,
});

const settingsWrapStyle = {
  position: "fixed" as const,
  top: "16px",
  right: "16px",
  zIndex: 5,
  display: "grid",
  justifyItems: "end" as const,
  gap: "10px",
};

const notificationToastWrapStyle = {
  position: "fixed" as const,
  top: "16px",
  left: "16px",
  zIndex: 5,
  pointerEvents: "none" as const,
};

const notificationToastStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  minWidth: "220px",
  maxWidth: "min(420px, calc(100vw - 92px))",
  padding: "14px 18px",
  borderRadius: "18px",
  background:
    backgroundThemeKey === "paper"
      ? "rgba(255,251,235,0.96)"
      : "rgba(15,23,42,0.92)",
  color: backgroundThemeKey === "paper" ? "#111827" : "#f8fafc",
  border:
    backgroundThemeKey === "paper"
      ? "1px solid rgba(217,119,6,0.16)"
      : "1px solid rgba(45,212,191,0.22)",
  boxShadow: "0 20px 44px rgba(2,6,23,0.28)",
  fontSize: "16px",
  fontWeight: 900,
  lineHeight: 1.6,
  animation: `changyou-room-notification-pop ${NOTIFICATION_TOAST_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
  willChange: "transform, opacity",
});

const songTitleDockWrapStyle = {
  position: "fixed" as const,
  right: "16px",
  bottom: "16px",
  zIndex: 5,
  display: "grid",
  justifyItems: "end" as const,
};

const songTitleDockStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  display: "grid",
  gap: "8px",
  minWidth: "220px",
  maxWidth: "min(420px, calc(100vw - 32px))",
  padding: "12px 14px",
  borderRadius: "16px",
  background:
    backgroundThemeKey === "paper"
      ? "rgba(255,251,235,0.94)"
      : "rgba(15,23,42,0.84)",
  color: backgroundThemeKey === "paper" ? "#111827" : "#f8fafc",
  border:
    backgroundThemeKey === "paper"
      ? "1px solid rgba(217,119,6,0.14)"
      : "1px solid rgba(148,163,184,0.16)",
  boxShadow: "0 18px 36px rgba(2,6,23,0.22)",
  backdropFilter: "blur(12px)",
});

const songTitleLabelStyle = {
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "rgba(148,163,184,0.92)",
  fontWeight: 800,
};

const songTitleValueStyle = {
  fontSize: "16px",
  lineHeight: 1.5,
  fontWeight: 900,
};

const songTitleCloseButtonStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  justifySelf: "end" as const,
  padding: "7px 10px",
  borderRadius: "999px",
  border:
    backgroundThemeKey === "paper"
      ? "1px solid rgba(217,119,6,0.14)"
      : "1px solid rgba(148,163,184,0.18)",
  background:
    backgroundThemeKey === "paper"
      ? "rgba(255,255,255,0.72)"
      : "rgba(255,255,255,0.08)",
  color: "inherit",
  fontSize: "12px",
  fontWeight: 800,
  cursor: "pointer",
});

const songTitleCollapsedButtonStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  padding: "10px 12px",
  borderRadius: "999px",
  border:
    backgroundThemeKey === "paper"
      ? "1px solid rgba(217,119,6,0.14)"
      : "1px solid rgba(148,163,184,0.18)",
  background:
    backgroundThemeKey === "paper"
      ? "rgba(255,251,235,0.92)"
      : "rgba(15,23,42,0.8)",
  color: backgroundThemeKey === "paper" ? "#111827" : "#f8fafc",
  fontSize: "12px",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 14px 28px rgba(2,6,23,0.18)",
  backdropFilter: "blur(12px)",
});

const settingsHintStyle = {
  padding: "12px 16px",
  borderRadius: "999px",
  background: "rgba(15,23,42,0.92)",
  color: "#f8fafc",
  border: "1px solid rgba(45,212,191,0.28)",
  boxShadow: "0 20px 44px rgba(2,6,23,0.38)",
  fontSize: "14px",
  fontWeight: 900,
  letterSpacing: "0.04em",
  animation: "changyou-room-setting-label 4.2s ease forwards",
  pointerEvents: "none" as const,
};

const settingsButtonStyle = (highlighted: boolean) => ({
  width: "52px",
  height: "52px",
  display: "grid",
  placeItems: "center",
  borderRadius: "999px",
  border: "1px solid rgba(148,163,184,0.28)",
  background: "rgba(15,23,42,0.78)",
  color: "#f8fafc",
  boxShadow: "0 18px 40px rgba(2,6,23,0.34)",
  backdropFilter: "blur(14px)",
  cursor: "pointer",
  animation: highlighted ? "changyou-room-setting-burst 1.05s ease-in-out 3" : undefined,
});

const settingsIconStyle = {
  width: "24px",
  height: "24px",
};

const settingsPanelStyle = {
  width: "min(320px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 100px)",
  overflowY: "auto" as const,
  padding: "16px",
  borderRadius: "24px",
  border: "1px solid rgba(148,163,184,0.22)",
  background: "rgba(15,23,42,0.92)",
  color: "#f8fafc",
  boxShadow: "0 22px 48px rgba(2,6,23,0.38)",
  backdropFilter: "blur(16px)",
  display: "grid",
  gap: "14px",
};

const settingsGroupStyle = {
  display: "grid",
  gap: "10px",
};

const settingsTitleStyle = {
  fontSize: "13px",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "rgba(191,219,254,0.78)",
};

const sliderValueStyle = {
  fontSize: "22px",
  fontWeight: 900,
  color: "#f8fafc",
};

const settingsCaptionStyle = {
  fontSize: "12px",
  lineHeight: 1.5,
  color: "rgba(226,232,240,0.72)",
};

const twoColumnButtonGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
};

const threeColumnButtonGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "10px",
};

const sentenceWindowGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: "8px",
};

const swatchGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
};

const modeButtonStyle = (active: boolean) => ({
  padding: "12px 10px",
  borderRadius: "14px",
  border: active ? "1px solid rgba(45,212,191,0.34)" : "1px solid rgba(148,163,184,0.24)",
  background: active ? "rgba(20,184,166,0.18)" : "rgba(30,41,59,0.92)",
  color: "#f8fafc",
  fontWeight: 800,
  cursor: "pointer",
});

const swatchButtonStyle = (active: boolean) => ({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "12px",
  borderRadius: "14px",
  border: active ? "1px solid rgba(45,212,191,0.34)" : "1px solid rgba(148,163,184,0.24)",
  background: active ? "rgba(20,184,166,0.18)" : "rgba(30,41,59,0.92)",
  color: "#f8fafc",
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left" as const,
});

const themePreviewStyle = (background: string) => ({
  width: "18px",
  height: "18px",
  borderRadius: "999px",
  background,
  border: "1px solid rgba(255,255,255,0.18)",
  flexShrink: 0,
});

const adjustButtonStyle = {
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(148,163,184,0.24)",
  background: "rgba(30,41,59,0.92)",
  color: "#f8fafc",
  fontWeight: 800,
  cursor: "pointer",
};

const sliderStyle = {
  width: "100%",
};

const settingsFooterStyle = {
  display: "flex",
  justifyContent: "flex-end",
};

const resetButtonStyle = {
  padding: "12px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(251,113,133,0.3)",
  background: "rgba(159,18,57,0.16)",
  color: "#ffe4e6",
  fontWeight: 800,
  cursor: "pointer",
};

const contentShellStyle = (maxWidth: string, outerPadding: number, marginTop: number) => ({
  position: "relative" as const,
  zIndex: 1,
  minHeight: "100vh",
  width: "100%",
  maxWidth,
  margin: "0 auto",
  padding: `${outerPadding}px`,
  paddingTop: `${outerPadding + marginTop}px`,
  boxSizing: "border-box" as const,
});

const singlePageStyle = (outerPadding: number, marginTop: number, _baseStyle: ReturnType<typeof buildTextBlockStyle>) => ({
  minHeight: `calc(100vh - ${(outerPadding * 2) + marginTop}px)`,
  width: "100%",
  maxWidth: "100%",
});

const sentenceWindowShellStyle = (outerPadding: number, marginTop: number) => ({
  position: "relative" as const,
  minHeight: `calc(100vh - ${(outerPadding * 2) + marginTop}px)`,
  width: "100%",
  maxWidth: "100%",
  overflow: "hidden" as const,
});

const sentenceAnchorWrapStyle = {
  position: "absolute" as const,
  left: 0,
  right: 0,
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 2,
  transition: "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
};

const sentenceMotionLayerStyle = (windowMotionOffset: number, windowMotionReady: boolean) => ({
  position: "absolute" as const,
  inset: 0,
  transform: `translate3d(0, ${windowMotionOffset}px, 0)`,
  opacity: windowMotionOffset === 0 ? 1 : 0.985,
  transition: windowMotionReady
    ? "transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 420ms cubic-bezier(0.22, 1, 0.36, 1)"
    : "none",
  willChange: "transform, opacity",
});

const sentenceLeadWrapStyle = (anchoredSentenceHeight: number) => ({
  position: "absolute" as const,
  left: 0,
  right: 0,
  bottom: `calc(50% + ${Math.max((anchoredSentenceHeight / 2) + 22, 30)}px)`,
  zIndex: 1,
  transition: "bottom 420ms cubic-bezier(0.22, 1, 0.36, 1)",
});

const sentenceAnchorCardStyle = (
  backgroundThemeKey: BackgroundThemeKey,
  baseStyle: ReturnType<typeof buildTextBlockStyle>,
) => {
  const baseFontSize = Number.parseFloat(baseStyle.fontSize) || DEFAULT_FONT_SIZE;
  const emphasizedFontSize = Math.max(baseFontSize + 10, Math.round(baseFontSize * 1.34));
  const emphasizedLineHeight = typeof baseStyle.lineHeight === "number" ? Math.max(1.22, baseStyle.lineHeight - 0.32) : 1.4;
  const inheritedTextShadow = baseStyle.textShadow && baseStyle.textShadow !== "none" ? `${baseStyle.textShadow}, ` : "";

  return {
    ...projectionTextStyle(baseStyle),
    fontSize: `${emphasizedFontSize}px`,
    lineHeight: emphasizedLineHeight,
    tabSize: 4,
    MozTabSize: 4,
    wordBreak: "normal" as const,
    overflowWrap: "normal" as const,
    letterSpacing: baseFontSize >= 34 ? "0.01em" : "0.018em",
    padding: "22px 26px",
    borderRadius: "28px",
    background:
      backgroundThemeKey === "paper"
        ? "linear-gradient(135deg, rgba(255,251,235,0.98) 0%, rgba(255,247,237,0.94) 100%)"
        : "linear-gradient(135deg, rgba(250,204,21,0.18) 0%, rgba(15,23,42,0.82) 22%, rgba(8,47,73,0.76) 100%)",
    border:
      backgroundThemeKey === "paper"
        ? "1px solid rgba(217,119,6,0.34)"
        : "1px solid rgba(250,204,21,0.34)",
    boxShadow:
      backgroundThemeKey === "paper"
        ? "0 22px 52px rgba(120,53,15,0.14), 0 0 0 1px rgba(251,191,36,0.16) inset"
        : "0 26px 60px rgba(2,6,23,0.44), 0 0 0 1px rgba(250,204,21,0.18) inset, 0 0 34px rgba(250,204,21,0.22)",
    textShadow:
      backgroundThemeKey === "paper"
        ? `${inheritedTextShadow}0 1px 0 rgba(255,255,255,0.9), 0 0 16px rgba(245,158,11,0.2)`
        : `${inheritedTextShadow}0 0 16px rgba(250,204,21,0.26), 0 0 34px rgba(250,204,21,0.16), 0 6px 20px rgba(15,23,42,0.46)`,
    backdropFilter: "blur(14px)",
    fontWeight: 900,
    animation:
      "changyou-room-sentence-switch 0.32s cubic-bezier(0.22, 1, 0.36, 1), changyou-room-sentence-focus 2.6s ease-in-out infinite",
    willChange: "filter, transform",
  };
};

const sentenceTrailWrapStyle = (anchoredSentenceHeight: number) => ({
  position: "absolute" as const,
  left: 0,
  right: 0,
  top: "50%",
  transform: `translateY(${Math.max((anchoredSentenceHeight / 2) + 22, 30)}px)`,
  zIndex: 1,
  transition: "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)",
});

const sentenceLeadListStyle = {
  display: "grid",
  gap: "12px",
  paddingTop: "28px",
};

const sentenceTrailListStyle = {
  display: "grid",
  gap: "12px",
  paddingBottom: "28px",
};

const sentenceTrailCardStyle = (
  backgroundThemeKey: BackgroundThemeKey,
  baseStyle: ReturnType<typeof buildTextBlockStyle>,
) => ({
  ...projectionTextStyle(baseStyle),
  tabSize: 4,
  MozTabSize: 4,
  wordBreak: "normal" as const,
  overflowWrap: "normal" as const,
  padding: "10px 14px",
  borderRadius: "18px",
  background:
    backgroundThemeKey === "paper"
      ? "rgba(255,255,255,0.78)"
      : "rgba(15,23,42,0.2)",
  border:
    backgroundThemeKey === "paper"
      ? "1px solid rgba(217,119,6,0.1)"
      : "1px solid rgba(148,163,184,0.16)",
  opacity: 0.74,
  filter: "saturate(0.88)",
});

const doublePageStyle = (columnGap: number, outerPadding: number, marginTop: number) => ({
  minHeight: `calc(100vh - ${(outerPadding * 2) + marginTop}px)`,
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: `${columnGap}px`,
  alignItems: "start",
});

const projectionColumnStyle = {
  display: "grid",
  gap: "6px",
  alignContent: "start" as const,
};

const projectionBlockShellStyle = (active: boolean, backgroundThemeKey: BackgroundThemeKey) => ({
  borderRadius: "12px",
  padding: "0",
  border: "none",
  background:
    backgroundThemeKey === "paper"
      ? active
        ? "rgba(255,247,237,0.52)"
        : "transparent"
      : active
        ? "rgba(250,204,21,0.1)"
        : "transparent",
  boxShadow:
    backgroundThemeKey === "paper"
      ? active
        ? "0 0 24px rgba(217,119,6,0.14)"
        : "none"
      : active
        ? "0 0 28px rgba(250,204,21,0.22)"
        : "none",
  animation: active ? "changyou-room-marker-enter 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" : undefined,
  transition: "background 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease",
  transformOrigin: "left center",
  willChange: active ? "transform" : undefined,
});

const projectionTextStyle = (baseStyle: ReturnType<typeof buildTextBlockStyle>) => ({
  ...baseStyle,
  margin: 0,
  width: "100%",
  maxWidth: "100%",
});

const stateShellStyle = (background: string, textColor: string) => ({
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background,
  color: textColor,
  fontSize: "18px",
});
