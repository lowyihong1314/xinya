import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useNavigate, useParams } from "react-router-dom";

import { useBaseNavbarVisibility } from "../../../../router/AppChromeContext";
import { CHANGYOU_ROOM_PATH } from "../../../router/paths";
import { ensureProjectionBlocks, isChordLine, splitBlocksForDoublePage, type LyricProjectionBlock } from "../projection";
import type { SongbookEntry } from "../types";
import { connectChangyouRoom } from "./socket";
import { fetchChangyouRoomCurrent, type ChangyouRoom, type ChangyouRoomNotification } from "./api";

const FONT_SIZE_STORAGE_KEY = "xinya.changyou.room.fontSize";
const LAYOUT_MODE_STORAGE_KEY = "xinya.changyou.room.layoutMode";
const BACKGROUND_THEME_STORAGE_KEY = "xinya.changyou.room.backgroundTheme";
const OUTER_PADDING_STORAGE_KEY = "xinya.changyou.room.outerPadding";
const LINE_HEIGHT_STORAGE_KEY = "xinya.changyou.room.lineHeight";
const CONTENT_WIDTH_STORAGE_KEY = "xinya.changyou.room.contentWidth";
const COLUMN_GAP_STORAGE_KEY = "xinya.changyou.room.columnGap";
const MARGIN_TOP_STORAGE_KEY = "xinya.changyou.room.marginTop";
const TEXT_GLOW_STORAGE_KEY = "xinya.changyou.room.textGlow";
const SHOW_CHORD_STORAGE_KEY = "xinya.changyou.room.showChord";

const DEFAULT_FONT_SIZE = 26;
const MIN_FONT_SIZE = 4;
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
const TEXT_NOTIFICATION_DURATION_MS = 5000;
const QR_NOTIFICATION_DURATION_MS = 12000;

type LayoutMode = "single" | "double";
type BackgroundThemeKey = "midnight" | "obsidian" | "paper" | "forest" | "sunset";
type ContentWidthMode = "focus" | "balanced" | "full";
type TextGlowLevel = "off" | "soft" | "strong";

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

function readStoredBoolean(storageKey: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const saved = window.localStorage.getItem(storageKey);
  if (saved === "true") return true;
  if (saved === "false") return false;
  return fallback;
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

function buildVisibleProjectionBlocks(blocks: LyricProjectionBlock[], showChord: boolean) {
  if (showChord) return blocks;

  return blocks.flatMap((block) => {
    const lines = block.lines.filter((line) => !isChordLine(line));
    if (!lines.some((line) => line.trim())) return [];

    return [
      {
        ...block,
        lines,
        text: lines.join("\n"),
        highlightable: lines.some((line) => line.trim() && !isSectionBoundary(line)),
        weight: Math.max(1, lines.reduce((sum, line) => sum + estimateLineWeight(line), 0)),
      },
    ];
  });
}

function getSettingsChrome(backgroundThemeKey: BackgroundThemeKey) {
  switch (backgroundThemeKey) {
    case "obsidian":
      return {
        surface: "rgba(2,6,23,0.86)",
        surfaceStrong: "rgba(3,7,18,0.92)",
        border: "rgba(96,165,250,0.24)",
        softBorder: "rgba(148,163,184,0.24)",
        text: "#f8fafc",
        mutedText: "rgba(226,232,240,0.74)",
        label: "rgba(191,219,254,0.82)",
        buttonBg: "rgba(15,23,42,0.86)",
        accentBg: "rgba(59,130,246,0.18)",
        accentBorder: "rgba(96,165,250,0.34)",
        shadow: "0 24px 60px rgba(2,6,23,0.4)",
      };
    case "paper":
      return {
        surface: "rgba(255,251,235,0.9)",
        surfaceStrong: "rgba(255,247,237,0.96)",
        border: "rgba(217,119,6,0.22)",
        softBorder: "rgba(180,83,9,0.18)",
        text: "#1f2937",
        mutedText: "rgba(120,53,15,0.76)",
        label: "rgba(146,64,14,0.86)",
        buttonBg: "rgba(255,255,255,0.76)",
        accentBg: "rgba(245,158,11,0.18)",
        accentBorder: "rgba(217,119,6,0.34)",
        shadow: "0 24px 54px rgba(120,53,15,0.18)",
      };
    case "forest":
      return {
        surface: "rgba(6,24,20,0.84)",
        surfaceStrong: "rgba(4,20,15,0.92)",
        border: "rgba(52,211,153,0.24)",
        softBorder: "rgba(110,231,183,0.2)",
        text: "#ecfdf5",
        mutedText: "rgba(209,250,229,0.72)",
        label: "rgba(167,243,208,0.82)",
        buttonBg: "rgba(11,43,36,0.88)",
        accentBg: "rgba(16,185,129,0.18)",
        accentBorder: "rgba(52,211,153,0.34)",
        shadow: "0 24px 60px rgba(4,20,15,0.42)",
      };
    case "sunset":
      return {
        surface: "rgba(49,18,55,0.84)",
        surfaceStrong: "rgba(31,17,71,0.92)",
        border: "rgba(251,146,60,0.28)",
        softBorder: "rgba(244,114,182,0.2)",
        text: "#fff7ed",
        mutedText: "rgba(254,215,170,0.78)",
        label: "rgba(253,186,116,0.84)",
        buttonBg: "rgba(91,35,51,0.88)",
        accentBg: "rgba(251,146,60,0.2)",
        accentBorder: "rgba(251,146,60,0.36)",
        shadow: "0 24px 60px rgba(49,18,55,0.4)",
      };
    case "midnight":
    default:
      return {
        surface: "rgba(7,17,31,0.84)",
        surfaceStrong: "rgba(11,21,40,0.92)",
        border: "rgba(45,212,191,0.24)",
        softBorder: "rgba(148,163,184,0.22)",
        text: "#f8fafc",
        mutedText: "rgba(226,232,240,0.72)",
        label: "rgba(191,219,254,0.8)",
        buttonBg: "rgba(15,23,42,0.86)",
        accentBg: "rgba(20,184,166,0.18)",
        accentBorder: "rgba(45,212,191,0.34)",
        shadow: "0 24px 60px rgba(2,6,23,0.38)",
      };
  }
}

function ProjectionColumn(props: {
  blocks: LyricProjectionBlock[];
  projectionBlocks: LyricProjectionBlock[];
  activeMarkerIndex: number | null;
  backgroundThemeKey: BackgroundThemeKey;
  baseStyle: ReturnType<typeof buildTextBlockStyle>;
  activeProjectionBlockRef?: { current: HTMLDivElement | null };
}) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const activeBlockRef = useRef<HTMLDivElement | null>(null);
  const [haloFrame, setHaloFrame] = useState({ top: 0, height: 0, visible: false });

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const columnNode = columnRef.current;
    if (!columnNode) return;

    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;

    const updateHalo = () => {
      const activeNode = activeBlockRef.current;
      if (!activeNode) {
        setHaloFrame((current) => (current.visible ? { ...current, visible: false } : current));
        return;
      }

      const columnRect = columnNode.getBoundingClientRect();
      const activeRect = activeNode.getBoundingClientRect();
      const nextTop = Math.max(activeRect.top - columnRect.top - 18, 0);
      const nextHeight = activeRect.height + 36;
      setHaloFrame({ top: nextTop, height: nextHeight, visible: true });
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateHalo);
    };

    scheduleUpdate();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(columnNode);
      const activeNode = activeBlockRef.current;
      if (activeNode) {
        resizeObserver.observe(activeNode);
      }
    }
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [props.activeMarkerIndex, props.baseStyle.fontSize, props.baseStyle.lineHeight, props.blocks]);

  return (
    <div ref={columnRef} style={projectionColumnStyle}>
      <div style={projectionCursorHaloStyle(haloFrame.top, haloFrame.height, haloFrame.visible, props.backgroundThemeKey)} />
      {props.blocks.map((block, index) => {
        const globalIndex = props.projectionBlocks.findIndex((item) => item.id === block.id);
        const active = block.highlightable && props.activeMarkerIndex === globalIndex;
        return (
          <div
            key={block.id || `${block.label}-${index}`}
            ref={
              active
                ? (node) => {
                    activeBlockRef.current = node;
                    if (props.activeProjectionBlockRef) {
                      props.activeProjectionBlockRef.current = node;
                    }
                  }
                : undefined
            }
            data-projection-active={active ? "true" : undefined}
            style={projectionBlockShellStyle(active, props.backgroundThemeKey)}
          >
            <pre style={projectionTextStyle(props.baseStyle, active)}>{block.text}</pre>
          </div>
        );
      })}
    </div>
  );
}

type ChangyouRoomPublicPageProps = {
  roomId: string;
  embeddedInApp?: boolean;
  showBackButton?: boolean;
  onBack?: () => void;
};

export function ChangyouRoomPublicAppPage() {
  const navigate = useNavigate();
  const { roomId } = useParams();

  if (!roomId) {
    const fallbackTheme = BACKGROUND_THEMES.midnight;
    return <div style={stateShellStyle(fallbackTheme.page, fallbackTheme.textColor)}>房间不存在。</div>;
  }

  return (
    <ChangyouRoomPublicPage
      roomId={roomId}
      embeddedInApp
      showBackButton
      onBack={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          navigate(-1);
          return;
        }
        navigate(CHANGYOU_ROOM_PATH);
      }}
    />
  );
}

export function ChangyouRoomPublicPage({
  roomId,
  embeddedInApp = false,
  showBackButton = false,
  onBack,
}: ChangyouRoomPublicPageProps) {
  useBaseNavbarVisibility(!embeddedInApp);

  const [room, setRoom] = useState<ChangyouRoom | null>(null);
  const [entry, setEntry] = useState<SongbookEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHintVisible, setSettingsHintVisible] = useState(false);
  const [activeNotification, setActiveNotification] = useState<ChangyouRoomNotification | null>(null);
  const [notificationQrDataUrl, setNotificationQrDataUrl] = useState("");
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
  const [showChord, setShowChord] = useState<boolean>(() =>
    readStoredBoolean(SHOW_CHORD_STORAGE_KEY, false),
  );
  const [roomUpdateTick, setRoomUpdateTick] = useState(0);
  const activeProjectionBlockRef = useRef<HTMLDivElement | null>(null);

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
      setRoomUpdateTick((value) => value + 1);
    });
    socket.on("changyou_room_notification", (payload) => {
      const nextNotification = payload?.notification as ChangyouRoomNotification | undefined;
      if (!nextNotification?.content) return;
      setActiveNotification(nextNotification);
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
    window.localStorage.setItem(SHOW_CHORD_STORAGE_KEY, String(showChord));
  }, [showChord]);

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
    if (!activeNotification) {
      setNotificationQrDataUrl("");
      return;
    }
    if (activeNotification.kind !== "qr") {
      setNotificationQrDataUrl("");
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(activeNotification.content, {
      margin: 1,
      width: 960,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setNotificationQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotificationQrDataUrl("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeNotification]);

  useEffect(() => {
    if (!activeNotification?.updated_at) return;
    const duration = activeNotification.kind === "qr" ? QR_NOTIFICATION_DURATION_MS : TEXT_NOTIFICATION_DURATION_MS;
    const timer = window.setTimeout(() => {
      setActiveNotification((current) =>
        current?.updated_at === activeNotification.updated_at ? null : current,
      );
    }, duration);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeNotification]);

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
  const visibleProjectionBlocks = useMemo(
    () => buildVisibleProjectionBlocks(projectionBlocks, showChord),
    [projectionBlocks, showChord],
  );
  const doubleProjectionBlocks = useMemo(
    () => splitBlocksForDoublePage(visibleProjectionBlocks),
    [visibleProjectionBlocks],
  );
  const activeMarkerIndex = room?.projection?.marker_index ?? null;

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
    if (!roomUpdateTick) return;
    if (typeof window === "undefined") return;

    let frameA = 0;
    let frameB = 0;
    let settleTimer = 0;

    const centerActiveProjectionBlock = () => {
      const activeNode = activeProjectionBlockRef.current;
      if (!activeNode) return;

      const rect = activeNode.getBoundingClientRect();
      const targetTop = window.scrollY + rect.top + (rect.height / 2) - (window.innerHeight / 2);
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });
    };

    frameA = window.requestAnimationFrame(() => {
      frameB = window.requestAnimationFrame(centerActiveProjectionBlock);
    });
    settleTimer = window.setTimeout(centerActiveProjectionBlock, 220);

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
      window.clearTimeout(settleTimer);
    };
  }, [roomUpdateTick, layoutMode, activeMarkerIndex, fontSize, lineHeight, showChord]);

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
    setShowChord(false);
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
        @keyframes changyou-room-notification-enter {
          0% { opacity: 0; transform: translate3d(0, 22px, 0) scale(0.94); }
          65% { opacity: 1; transform: translate3d(0, -4px, 0) scale(1.02); }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
        @keyframes changyou-room-cursor-aura {
          0%, 100% { filter: brightness(1) saturate(1); }
          50% { filter: brightness(1.16) saturate(1.22); }
        }
      `}</style>
      <div style={ambientGlowStyle(backgroundTheme.overlay)} />
      {!settingsOpen && showBackButton && onBack ? (
        <button type="button" onClick={onBack} style={appBackButtonStyle(backgroundThemeKey)}>
          ← 返回
        </button>
      ) : null}
      {activeNotification ? (
        <div style={notificationOverlayStyle}>
          <div
            key={activeNotification.updated_at || activeNotification.content}
            style={notificationModalStyle(backgroundThemeKey)}
          >
            {activeNotification.kind === "qr" ? (
              <div style={notificationQrLayoutStyle}>
                <div style={notificationQrTitleStyle}>扫码查看</div>
                <div style={notificationQrFrameStyle(backgroundThemeKey)}>
                  {notificationQrDataUrl ? (
                    <img src={notificationQrDataUrl} alt="notification qr code" style={notificationQrImageStyle} />
                  ) : (
                    <div style={notificationQrPlaceholderStyle}>QR</div>
                  )}
                </div>
                <div style={notificationQrContentStyle(backgroundThemeKey)}>{activeNotification.content}</div>
              </div>
            ) : (
              <div style={notificationTextContentStyle}>{activeNotification.content}</div>
            )}
          </div>
        </div>
      ) : null}
      {songTitle && !settingsOpen ? (
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
      {!settingsOpen ? (
        <div style={settingsWrapStyle}>
          {settingsHintVisible ? <div style={settingsHintStyle(backgroundThemeKey)}>设置在这里</div> : null}
          <button
            type="button"
            aria-label="打开设置页"
            onClick={() => setSettingsOpen(true)}
            style={settingsButtonStyle(backgroundThemeKey, settingsHintVisible)}
          >
            <svg viewBox="0 0 24 24" style={settingsIconStyle} aria-hidden="true">
              <path
                d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.28 7.28 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.43 7.43 0 0 0-.05.94c0 .32.02.63.05.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      ) : null}

      {settingsOpen ? (
        <div style={settingsPageShellStyle}>
          <button type="button" onClick={() => setSettingsOpen(false)} style={appBackButtonStyle(backgroundThemeKey)}>
            ← 返回
          </button>
          <div style={settingsPageHeaderStyle(backgroundThemeKey)}>
            <div style={settingsPageEyebrowStyle(backgroundThemeKey)}>显示设置</div>
            <div style={settingsPageHeadingStyle(backgroundThemeKey)}>公开页显示设置</div>
            <div style={settingsPageSummaryStyle(backgroundThemeKey)}>
              在这里切换歌词与 chord、版面布局、背景主题和字体参数。
            </div>
          </div>
          <div style={settingsPageCardStyle(backgroundThemeKey)}>
            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle(backgroundThemeKey)}>Chord</div>
              <div style={settingsCaptionStyle(backgroundThemeKey)}>默认只显示歌词，点这里才会把 chord 一起显示出来</div>
              <div style={twoColumnButtonGridStyle}>
                <button
                  type="button"
                  onClick={() => setShowChord(false)}
                  style={modeButtonStyle(!showChord, backgroundThemeKey)}
                >
                  仅歌词
                </button>
                <button
                  type="button"
                  onClick={() => setShowChord(true)}
                  style={modeButtonStyle(showChord, backgroundThemeKey)}
                >
                  显示 Chord
                </button>
              </div>
            </div>

            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle(backgroundThemeKey)}>显示模式</div>
              <div style={twoColumnButtonGridStyle}>
                <button
                  type="button"
                  onClick={() => setLayoutMode("single")}
                  style={modeButtonStyle(layoutMode === "single", backgroundThemeKey)}
                >
                  单页模式
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("double")}
                  style={modeButtonStyle(layoutMode === "double", backgroundThemeKey)}
                >
                  双页模式
                </button>
              </div>
            </div>

            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle(backgroundThemeKey)}>背景主题</div>
              <div style={settingsCaptionStyle(backgroundThemeKey)}>文字会自动切成适合这个背景的反差色</div>
              <div style={swatchGridStyle}>
                {(Object.entries(BACKGROUND_THEMES) as Array<[BackgroundThemeKey, (typeof BACKGROUND_THEMES)[BackgroundThemeKey]]>).map(([key, theme]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBackgroundThemeKey(key)}
                    style={swatchButtonStyle(backgroundThemeKey === key, backgroundThemeKey)}
                  >
                    <span style={themePreviewStyle(theme.page)} />
                    <span>{theme.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle(backgroundThemeKey)}>内容宽度</div>
              <div style={threeColumnButtonGridStyle}>
                {(Object.entries(CONTENT_WIDTH_PRESETS) as Array<[ContentWidthMode, (typeof CONTENT_WIDTH_PRESETS)[ContentWidthMode]]>).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setContentWidthMode(key)}
                    style={modeButtonStyle(contentWidthMode === key, backgroundThemeKey)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={settingsGroupStyle}>
              <div style={settingsTitleStyle(backgroundThemeKey)}>文字光效</div>
              <div style={threeColumnButtonGridStyle}>
                {(Object.entries(TEXT_GLOW_PRESETS) as Array<[TextGlowLevel, (typeof TEXT_GLOW_PRESETS)[TextGlowLevel]]>).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTextGlowLevel(key)}
                    style={modeButtonStyle(textGlowLevel === key, backgroundThemeKey)}
                  >
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
              backgroundThemeKey={backgroundThemeKey}
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
              backgroundThemeKey={backgroundThemeKey}
              onChange={(value) => setLineHeight(Number(value.toFixed(2)))}
            />

            <SettingSlider
              title="外围留白"
              valueLabel={`${outerPadding}px`}
              min={MIN_OUTER_PADDING}
              max={MAX_OUTER_PADDING}
              step={1}
              value={outerPadding}
              backgroundThemeKey={backgroundThemeKey}
              onChange={(value) => setOuterPadding(value)}
            />

            <SettingSlider
              title="顶部距离"
              valueLabel={`${marginTop}px`}
              min={MIN_MARGIN_TOP}
              max={MAX_MARGIN_TOP}
              step={1}
              value={marginTop}
              backgroundThemeKey={backgroundThemeKey}
              onChange={(value) => setMarginTop(value)}
            />

            <SettingSlider
              title="双页间距"
              valueLabel={`${columnGap}px`}
              min={MIN_COLUMN_GAP}
              max={MAX_COLUMN_GAP}
              step={1}
              value={columnGap}
              backgroundThemeKey={backgroundThemeKey}
              onChange={(value) => setColumnGap(value)}
            />

            <div style={settingsFooterStyle}>
              <button type="button" onClick={resetDisplaySettings} style={resetButtonStyle(backgroundThemeKey)}>
                重置 UI
              </button>
            </div>
          </div>
        </div>
      ) : !entry ? (
        <div style={stateShellStyle(backgroundTheme.page, textColor)}>等待歌词…</div>
      ) : layoutMode === "double" ? (
        <div style={contentShellStyle(widthPreset.maxWidth, outerPadding, marginTop)}>
          <div style={doublePageStyle(columnGap, outerPadding, marginTop)}>
            <ProjectionColumn
              blocks={doubleProjectionBlocks.left}
              projectionBlocks={projectionBlocks}
              activeMarkerIndex={activeMarkerIndex}
              backgroundThemeKey={backgroundThemeKey}
              baseStyle={doubleBlockStyle}
              activeProjectionBlockRef={activeProjectionBlockRef}
            />
            <ProjectionColumn
              blocks={doubleProjectionBlocks.right}
              projectionBlocks={projectionBlocks}
              activeMarkerIndex={activeMarkerIndex}
              backgroundThemeKey={backgroundThemeKey}
              baseStyle={doubleBlockStyle}
              activeProjectionBlockRef={activeProjectionBlockRef}
            />
          </div>
        </div>
      ) : (
        <div style={contentShellStyle(widthPreset.maxWidth, outerPadding, marginTop)}>
          <div style={singlePageStyle(outerPadding, marginTop, singleBlockStyle)}>
            <ProjectionColumn
              blocks={visibleProjectionBlocks}
              projectionBlocks={projectionBlocks}
              activeMarkerIndex={activeMarkerIndex}
              backgroundThemeKey={backgroundThemeKey}
              baseStyle={singleBlockStyle}
              activeProjectionBlockRef={activeProjectionBlockRef}
            />
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
  backgroundThemeKey: BackgroundThemeKey;
  onChange: (value: number) => void;
  onDecrease?: () => void;
  onIncrease?: () => void;
}) {
  return (
    <div style={settingsGroupStyle}>
      <div style={settingsTitleStyle(props.backgroundThemeKey)}>{props.title}</div>
      <div style={sliderValueStyle(props.backgroundThemeKey)}>{props.valueLabel}</div>
      {props.onDecrease || props.onIncrease ? (
        <div style={twoColumnButtonGridStyle}>
          <button
            type="button"
            onClick={props.onDecrease}
            style={adjustButtonStyle(props.backgroundThemeKey)}
            disabled={!props.onDecrease}
          >
            A-
          </button>
          <button
            type="button"
            onClick={props.onIncrease}
            style={adjustButtonStyle(props.backgroundThemeKey)}
            disabled={!props.onIncrease}
          >
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

const appBackButtonStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  position: "fixed" as const,
  top: "16px",
  left: "16px",
  zIndex: 6,
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "12px 16px",
  borderRadius: "999px",
  border:
    backgroundThemeKey === "paper"
      ? "1px solid rgba(217,119,6,0.18)"
      : "1px solid rgba(148,163,184,0.24)",
  background:
    backgroundThemeKey === "paper"
      ? "rgba(255,251,235,0.92)"
      : "rgba(15,23,42,0.78)",
  color: backgroundThemeKey === "paper" ? "#111827" : "#f8fafc",
  fontWeight: 900,
  boxShadow: "0 18px 36px rgba(2,6,23,0.24)",
  backdropFilter: "blur(14px)",
  cursor: "pointer",
});

const notificationOverlayStyle = {
  position: "fixed" as const,
  inset: 0,
  zIndex: 8,
  display: "grid",
  placeItems: "center",
  padding: "20px",
  background: "rgba(2,6,23,0.34)",
  backdropFilter: "blur(10px)",
  pointerEvents: "none" as const,
};

const notificationModalStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  width: "min(60vw, calc(100vw - 40px))",
  minWidth: "min(720px, calc(100vw - 40px))",
  minHeight: "60vh",
  maxHeight: "min(60vh, calc(100vh - 40px))",
  padding: "28px 32px",
  borderRadius: "32px",
  display: "grid",
  placeItems: "center",
  background:
    backgroundThemeKey === "paper"
      ? "linear-gradient(180deg, rgba(255,251,235,0.98) 0%, rgba(255,247,237,0.96) 100%)"
      : "linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(8,47,73,0.94) 100%)",
  color: backgroundThemeKey === "paper" ? "#111827" : "#f8fafc",
  border:
    backgroundThemeKey === "paper"
      ? "1px solid rgba(217,119,6,0.22)"
      : "1px solid rgba(45,212,191,0.26)",
  boxShadow:
    backgroundThemeKey === "paper"
      ? "0 36px 80px rgba(120,53,15,0.18)"
      : "0 44px 96px rgba(2,6,23,0.44), 0 0 42px rgba(45,212,191,0.08)",
  animation: "changyou-room-notification-enter 420ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
  willChange: "transform, opacity",
  overflow: "hidden" as const,
  boxSizing: "border-box" as const,
});

const notificationTextContentStyle = {
  width: "100%",
  textAlign: "center" as const,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  fontSize: "clamp(34px, 4.8vw, 76px)",
  lineHeight: 1.18,
  fontWeight: 900,
  letterSpacing: "0.01em",
};

const notificationQrLayoutStyle = {
  width: "100%",
  height: "100%",
  display: "grid",
  justifyItems: "center" as const,
  alignContent: "center" as const,
  gap: "18px",
};

const notificationQrTitleStyle = {
  fontSize: "clamp(28px, 3.4vw, 54px)",
  lineHeight: 1.1,
  fontWeight: 900,
  letterSpacing: "0.04em",
};

const notificationQrFrameStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  width: "min(34vw, 42vh, 520px)",
  height: "min(34vw, 42vh, 520px)",
  minWidth: "220px",
  minHeight: "220px",
  display: "grid",
  placeItems: "center",
  padding: "18px",
  borderRadius: "28px",
  background: "#ffffff",
  boxShadow:
    backgroundThemeKey === "paper"
      ? "0 24px 54px rgba(120,53,15,0.16)"
      : "0 24px 60px rgba(15,23,42,0.36)",
});

const notificationQrImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "contain" as const,
  display: "block",
};

const notificationQrPlaceholderStyle = {
  fontSize: "42px",
  fontWeight: 900,
  color: "#111827",
};

const notificationQrContentStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  maxWidth: "100%",
  padding: "12px 16px",
  borderRadius: "18px",
  background:
    backgroundThemeKey === "paper"
      ? "rgba(255,255,255,0.78)"
      : "rgba(255,255,255,0.08)",
  color: "inherit",
  fontSize: "clamp(16px, 1.6vw, 24px)",
  lineHeight: 1.5,
  fontWeight: 700,
  textAlign: "center" as const,
  wordBreak: "break-all" as const,
  overflowWrap: "anywhere" as const,
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

const settingsHintStyle = (backgroundThemeKey: BackgroundThemeKey) => {
  const chrome = getSettingsChrome(backgroundThemeKey);
  return {
    padding: "12px 16px",
    borderRadius: "999px",
    background: chrome.surfaceStrong,
    color: chrome.text,
    border: `1px solid ${chrome.accentBorder}`,
    boxShadow: chrome.shadow,
    fontSize: "14px",
    fontWeight: 900,
    letterSpacing: "0.04em",
    animation: "changyou-room-setting-label 4.2s ease forwards",
    pointerEvents: "none" as const,
  };
};

const settingsButtonStyle = (backgroundThemeKey: BackgroundThemeKey, highlighted: boolean) => {
  const chrome = getSettingsChrome(backgroundThemeKey);
  return {
  width: "52px",
  height: "52px",
  display: "grid",
  placeItems: "center",
  borderRadius: "999px",
  border: `1px solid ${chrome.softBorder}`,
  background: chrome.surface,
  color: chrome.text,
  boxShadow: chrome.shadow,
  backdropFilter: "blur(14px)",
  cursor: "pointer",
  animation: highlighted ? "changyou-room-setting-burst 1.05s ease-in-out 3" : undefined,
  };
};

const settingsIconStyle = {
  width: "24px",
  height: "24px",
};

const settingsPageShellStyle = {
  position: "relative" as const,
  zIndex: 2,
  minHeight: "100vh",
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "92px 16px 36px",
  display: "grid",
  justifyItems: "center" as const,
  alignContent: "start" as const,
  gap: "18px",
};

const settingsPageHeaderStyle = (backgroundThemeKey: BackgroundThemeKey) => {
  const chrome = getSettingsChrome(backgroundThemeKey);
  return {
    width: "min(760px, calc(100vw - 32px))",
    padding: "22px 24px",
    borderRadius: "28px",
    border: `1px solid ${chrome.border}`,
    background: chrome.surfaceStrong,
    color: chrome.text,
    boxShadow: chrome.shadow,
    backdropFilter: "blur(16px)",
    display: "grid",
    gap: "10px",
  };
};

const settingsPageEyebrowStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  fontSize: "12px",
  fontWeight: 900,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: getSettingsChrome(backgroundThemeKey).label,
});

const settingsPageHeadingStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  fontSize: "clamp(26px, 4vw, 38px)",
  lineHeight: 1.08,
  fontWeight: 900,
  color: getSettingsChrome(backgroundThemeKey).text,
});

const settingsPageSummaryStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  fontSize: "14px",
  lineHeight: 1.6,
  color: getSettingsChrome(backgroundThemeKey).mutedText,
});

const settingsPageCardStyle = (backgroundThemeKey: BackgroundThemeKey) => {
  const chrome = getSettingsChrome(backgroundThemeKey);
  return {
    width: "min(760px, calc(100vw - 32px))",
    padding: "20px",
    borderRadius: "28px",
    border: `1px solid ${chrome.border}`,
    background: chrome.surface,
    color: chrome.text,
    boxShadow: chrome.shadow,
    backdropFilter: "blur(16px)",
    display: "grid",
    gap: "14px",
  };
};

const settingsGroupStyle = {
  display: "grid",
  gap: "10px",
};

const settingsTitleStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  fontSize: "13px",
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: getSettingsChrome(backgroundThemeKey).label,
});

const sliderValueStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  fontSize: "22px",
  fontWeight: 900,
  color: getSettingsChrome(backgroundThemeKey).text,
});

const settingsCaptionStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  fontSize: "12px",
  lineHeight: 1.5,
  color: getSettingsChrome(backgroundThemeKey).mutedText,
});

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

const swatchGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
};

const modeButtonStyle = (active: boolean, backgroundThemeKey: BackgroundThemeKey) => {
  const chrome = getSettingsChrome(backgroundThemeKey);
  return {
    padding: "12px 10px",
    borderRadius: "14px",
    border: active ? `1px solid ${chrome.accentBorder}` : `1px solid ${chrome.softBorder}`,
    background: active ? chrome.accentBg : chrome.buttonBg,
    color: chrome.text,
    fontWeight: 800,
    cursor: "pointer",
  };
};

const swatchButtonStyle = (active: boolean, backgroundThemeKey: BackgroundThemeKey) => {
  const chrome = getSettingsChrome(backgroundThemeKey);
  return {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px",
    borderRadius: "14px",
    border: active ? `1px solid ${chrome.accentBorder}` : `1px solid ${chrome.softBorder}`,
    background: active ? chrome.accentBg : chrome.buttonBg,
    color: chrome.text,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left" as const,
  };
};

const themePreviewStyle = (background: string) => ({
  width: "18px",
  height: "18px",
  borderRadius: "999px",
  background,
  border: "1px solid rgba(255,255,255,0.18)",
  flexShrink: 0,
});

const adjustButtonStyle = (backgroundThemeKey: BackgroundThemeKey) => {
  const chrome = getSettingsChrome(backgroundThemeKey);
  return {
    padding: "12px 14px",
    borderRadius: "14px",
    border: `1px solid ${chrome.softBorder}`,
    background: chrome.buttonBg,
    color: chrome.text,
    fontWeight: 800,
    cursor: "pointer",
  };
};

const sliderStyle = {
  width: "100%",
};

const settingsFooterStyle = {
  display: "flex",
  justifyContent: "flex-end",
};

const resetButtonStyle = (backgroundThemeKey: BackgroundThemeKey) => ({
  padding: "12px 16px",
  borderRadius: "14px",
  border:
    backgroundThemeKey === "paper"
      ? "1px solid rgba(225,29,72,0.24)"
      : "1px solid rgba(251,113,133,0.3)",
  background:
    backgroundThemeKey === "paper"
      ? "rgba(244,63,94,0.1)"
      : "rgba(159,18,57,0.16)",
  color: backgroundThemeKey === "paper" ? "#9f1239" : "#ffe4e6",
  fontWeight: 800,
  cursor: "pointer",
});

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

const doublePageStyle = (columnGap: number, outerPadding: number, marginTop: number) => ({
  minHeight: `calc(100vh - ${(outerPadding * 2) + marginTop}px)`,
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: `${columnGap}px`,
  alignItems: "start",
});

const projectionColumnStyle = {
  position: "relative" as const,
  display: "grid",
  gap: "12px",
  alignContent: "start" as const,
  overflow: "visible" as const,
};

const projectionCursorHaloStyle = (
  top: number,
  height: number,
  visible: boolean,
  backgroundThemeKey: BackgroundThemeKey,
) => ({
  position: "absolute" as const,
  left: "-18px",
  right: "-10px",
  top: `${top}px`,
  height: `${height}px`,
  borderRadius: "28px",
  background:
    backgroundThemeKey === "paper"
      ? "radial-gradient(circle at 14% 50%, rgba(245,158,11,0.26), transparent 54%), linear-gradient(90deg, rgba(251,191,36,0.16) 0%, rgba(255,247,237,0.14) 44%, rgba(255,247,237,0) 100%)"
      : "radial-gradient(circle at 12% 50%, rgba(250,204,21,0.3), transparent 56%), linear-gradient(90deg, rgba(250,204,21,0.16) 0%, rgba(34,211,238,0.12) 42%, rgba(15,23,42,0) 100%)",
  opacity: visible ? 1 : 0,
  filter: "blur(18px)",
  boxShadow:
    backgroundThemeKey === "paper"
      ? "0 0 34px rgba(245,158,11,0.16)"
      : "0 0 42px rgba(250,204,21,0.22)",
  transition: "top 520ms cubic-bezier(0.22, 1, 0.36, 1), height 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease",
  pointerEvents: "none" as const,
  zIndex: 0,
  animation: visible ? "changyou-room-cursor-aura 2.4s ease-in-out infinite" : undefined,
});

const projectionBlockShellStyle = (active: boolean, backgroundThemeKey: BackgroundThemeKey) => ({
  borderRadius: active ? "24px" : "12px",
  padding: active ? "14px 18px 14px 22px" : "0",
  border: "none",
  position: "relative" as const,
  zIndex: active ? 2 : 1,
  background:
    backgroundThemeKey === "paper"
      ? active
        ? "rgba(255,251,235,0.88)"
        : "transparent"
      : active
        ? "rgba(15,23,42,0.24)"
        : "transparent",
  boxShadow:
    backgroundThemeKey === "paper"
      ? active
        ? "0 0 0 1px rgba(245,158,11,0.12)"
        : "none"
      : active
        ? "0 0 0 1px rgba(250,204,21,0.12)"
        : "none",
  transition: "padding 260ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 260ms ease, background 220ms ease, box-shadow 220ms ease",
  overflow: "visible" as const,
});

const projectionTextStyle = (baseStyle: ReturnType<typeof buildTextBlockStyle>, active = false) => {
  const baseFontSize = Number.parseFloat(baseStyle.fontSize) || DEFAULT_FONT_SIZE;
  const activeFontSize = Math.max(baseFontSize + 8, Math.round(baseFontSize * 1.3));
  return {
    ...baseStyle,
    margin: 0,
    width: "100%",
    maxWidth: "100%",
    fontSize: active ? `${activeFontSize}px` : baseStyle.fontSize,
    lineHeight:
      active && typeof baseStyle.lineHeight === "number"
        ? Math.max(1.18, baseStyle.lineHeight - 0.12)
        : baseStyle.lineHeight,
    fontWeight: active ? 900 : undefined,
    minHeight:
      active && typeof baseStyle.lineHeight === "number"
        ? `${Math.round((activeFontSize * baseStyle.lineHeight) + 18)}px`
        : undefined,
    transition: "font-size 260ms cubic-bezier(0.22, 1, 0.36, 1), line-height 260ms cubic-bezier(0.22, 1, 0.36, 1), min-height 260ms cubic-bezier(0.22, 1, 0.36, 1)",
    position: "relative" as const,
    zIndex: 1,
  };
};

const stateShellStyle = (background: string, textColor: string) => ({
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background,
  color: textColor,
  fontSize: "18px",
});
