import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import QRCode from "qrcode";
import { useNavigate } from "react-router-dom";

import { useUserState } from "../../../../app/UserState";
import { IS_APK } from "../../../../js/apiBase";
import { useBaseNavbarVisibility } from "../../../../router/AppChromeContext";
import { useEnsureDesignTokens } from "../../../../theme/designTokens";
import {
  CHANGYOU_ROOM_PATH,
  getChangyouPublicRoomPath,
  getChangyouRoomPath,
  getChangyouRoomPlayerPath,
} from "../../../router/paths";
import { buildProjectionBlocks, ensureProjectionBlocks, splitBlocksForDoublePage, type LyricProjectionBlock } from "../projection";
import { fetchSongbookEntries, fetchSongbookEntry } from "../api";
import { connectChangyouRoom } from "./socket";
import {
  fetchChangyouRoom,
  fetchChangyouRoomCurrent,
  fetchChangyouRooms,
  notifyChangyouRoom,
  projectChangyouRoomPage,
  type ChangyouRoom,
  type ChangyouRoomProjection,
  updateChangyouRoomMarker,
} from "./api";
import type { SongbookEntry, SongbookVersionOption } from "../types";

const FONT_SIZE_STORAGE_KEY = "xinya.changyou.fontSize";
const HIDE_NAV_STORAGE_KEY = "xinya.changyou.hideNav";
const CHORD_FAMILY_STORAGE_KEY = "xinya.changyou.chordFamily";
const DEFAULT_FONT_SIZE = 18;
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 30;
const SONG_CARD_BATCH_DESKTOP = 18;
const SONG_CARD_BATCH_MOBILE = 10;
const APK_PUBLIC_ROOM_BASE_URL = "http://utbabuddha.com";

type ChordFamily = "original" | "C" | "D" | "E" | "F" | "G" | "A" | "B";
type ControllerPage = "songs" | "projection" | "control";

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

function formatSongTitle(entry: SongbookEntry | null) {
  if (!entry) return "未投放";
  return `${entry.song_number ? `${entry.song_number}. ` : ""}${entry.title}`;
}

function isProjectionForEntry(room: ChangyouRoom | null, entry: SongbookEntry | null) {
  if (!room || !entry) return false;
  const roomEditorId = room.editor_user_id || null;
  const entryEditorId = entry.active_version === "user" ? entry.active_editor_user_id || null : null;
  return (
    room.song_entry_id === entry.id &&
    (room.version_kind || "base") === (entry.active_version || "base") &&
    roomEditorId === entryEditorId
  );
}

function getProjectionBlocks(projection: ChangyouRoomProjection | null | undefined, fallbackContent: string) {
  return ensureProjectionBlocks((projection?.blocks as LyricProjectionBlock[] | undefined) || [], fallbackContent);
}

export function ChangyouRoomController({ roomId }: { roomId: string }) {
  useEnsureDesignTokens();

  const navigate = useNavigate();
  const { isMobile } = useUserState();
  const [room, setRoom] = useState<ChangyouRoom | null>(null);
  const [rooms, setRooms] = useState<ChangyouRoom[]>([]);
  const [entries, setEntries] = useState<SongbookEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<SongbookEntry | null>(null);
  const [projectedEntry, setProjectedEntry] = useState<SongbookEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [error, setError] = useState("");
  const [songQuery, setSongQuery] = useState("");
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
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [marking, setMarking] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notificationValue, setNotificationValue] = useState("");
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [workflowPage, setWorkflowPage] = useState<ControllerPage>("songs");
  const [songBatchIndex, setSongBatchIndex] = useState(0);
  const [projectingSong, setProjectingSong] = useState(false);

  const selectedSongId = selectedEntry?.id || null;

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

  async function loadEntry(targetEntryId: number, options?: { versionKind?: "base" | "user"; editorUserId?: number | null }) {
    const response = await fetchSongbookEntry(targetEntryId, options);
    setSelectedEntry(response.entry);
    return response.entry;
  }

  useEffect(() => {
    let cancelled = false;
    fetchChangyouRooms()
      .then((response) => {
        if (!cancelled) {
          setRooms(response.rooms || []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError((current) => current || (err instanceof Error ? err.message : "加载房间失败"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEntriesLoading(true);
    fetchSongbookEntries("", "")
      .then((response) => {
        if (!cancelled) {
          setEntries(response.entries || []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError((current) => current || (err instanceof Error ? err.message : "加载歌曲失败"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setEntriesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([fetchChangyouRoom(roomId), fetchChangyouRoomCurrent(roomId)])
      .then(async ([roomResponse, currentResponse]) => {
        if (cancelled) return;
        setRoom(roomResponse.room);
        setProjectedEntry(currentResponse.entry || null);
        const currentSongId = currentResponse.room.song_entry_id || currentResponse.entry?.id || null;
        if (currentSongId) {
          await loadEntry(currentSongId, {
            versionKind: (currentResponse.room.version_kind as "base" | "user") || "base",
            editorUserId: currentResponse.room.editor_user_id || null,
          });
          setWorkflowPage("control");
        } else {
          setSelectedEntry(null);
          setWorkflowPage("songs");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRoom(null);
          setProjectedEntry(null);
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
    if (!roomId) return;
    const socket = connectChangyouRoom(roomId);
    socket.on("changyou_room_update", (payload) => {
      setRoom((current) => (current ? { ...current, ...payload.room } : payload.room || current));
      setProjectedEntry(payload.entry || null);
    });
    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  const publicRoomAppPath = useMemo(() => {
    if (!room) return "";
    return getChangyouRoomPlayerPath(room.room_id);
  }, [room]);

  const publicRoomExternalUrl = useMemo(() => {
    if (!room) return "";
    const roomPath = IS_APK ? getChangyouPublicRoomPath(room.room_id) : room.playback_url || getChangyouPublicRoomPath(room.room_id);
    const originBase = IS_APK ? APK_PUBLIC_ROOM_BASE_URL : window.location.origin;
    return new URL(roomPath, originBase).toString();
  }, [room]);

  useEffect(() => {
    if (!publicRoomExternalUrl) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(publicRoomExternalUrl).then(setQrDataUrl).catch(() => setQrDataUrl(""));
  }, [publicRoomExternalUrl]);

  const renderedContent = useMemo(
    () => transformChordContent(selectedEntry?.content || "", chordFamily),
    [selectedEntry?.content, chordFamily],
  );

  const titleText = useMemo(
    () => (selectedEntry ? `${selectedEntry.song_number ? `${selectedEntry.song_number}. ` : ""}${selectedEntry.title}` : "还没有选歌"),
    [selectedEntry],
  );
  const versionOptions = useMemo(() => selectedEntry?.versions || [], [selectedEntry]);
  const activeVersionNote = useMemo(() => buildVersionHelperText(selectedEntry), [selectedEntry]);
  const projectionBlocks = useMemo(() => buildProjectionBlocks(renderedContent), [renderedContent]);
  const projectionHighlightableIndices = useMemo(
    () => projectionBlocks.flatMap((block, index) => (block.highlightable ? [index] : [])),
    [projectionBlocks],
  );
  const songCardsPerBatch = isMobile ? SONG_CARD_BATCH_MOBILE : SONG_CARD_BATCH_DESKTOP;

  const lineCount = useMemo(
    () => renderedContent.split("\n").filter((line) => line.trim()).length,
    [renderedContent],
  );

  const filteredEntries = useMemo(() => {
    const query = songQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((item) => {
      const haystack = `${item.song_number || ""} ${item.title} ${item.title_normalized || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [entries, songQuery]);
  const songBatchCount = Math.max(1, Math.ceil(filteredEntries.length / songCardsPerBatch));
  const songCardSlice = useMemo(
    () => filteredEntries.slice(songBatchIndex * songCardsPerBatch, (songBatchIndex + 1) * songCardsPerBatch),
    [filteredEntries, songBatchIndex, songCardsPerBatch],
  );

  useEffect(() => {
    setSongBatchIndex(0);
  }, [songQuery]);

  useEffect(() => {
    if (songBatchIndex > songBatchCount - 1) {
      setSongBatchIndex(Math.max(0, songBatchCount - 1));
    }
  }, [songBatchIndex, songBatchCount]);

  const roomProjection = room?.projection || null;
  const projectingSelectedEntry = useMemo(() => {
    if (!isProjectionForEntry(room, selectedEntry)) return false;
    return (roomProjection?.content || "") === renderedContent;
  }, [room, selectedEntry, roomProjection?.content, renderedContent]);
  const currentProjectedBlocks = useMemo(
    () => getProjectionBlocks(roomProjection, projectedEntry?.content || ""),
    [roomProjection, projectedEntry?.content],
  );
  const currentProjectedColumns = useMemo(
    () => splitBlocksForDoublePage(currentProjectedBlocks),
    [currentProjectedBlocks],
  );
  const currentProjectedHighlightableIndices = useMemo(
    () => currentProjectedBlocks.flatMap((block, index) => (block.highlightable ? [index] : [])),
    [currentProjectedBlocks],
  );

  function buildProjectionPayload(targetEntry: SongbookEntry, targetChordFamily: ChordFamily, markerIndex: number | null = null) {
    const content = transformChordContent(targetEntry.content || "", targetChordFamily);
    const blocks = buildProjectionBlocks(content);
    return {
      song_entry_id: targetEntry.id,
      version_kind: targetEntry.active_version || "base",
      editor_user_id: targetEntry.active_version === "user" ? targetEntry.active_editor_user_id || null : null,
      page_index: 0,
      page_count: 1,
      page_label: "整首歌词",
      content,
      blocks,
      marker_index: markerIndex,
    };
  }

  async function handleSelectSong(songId: number) {
    setError("");
    try {
      const entry = await loadEntry(songId, { versionKind: "base" });
      setChordFamily("original");
      await projectSongEntry(entry, "original");
      setWorkflowPage("projection");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载歌曲失败");
    }
  }

  async function handlePickVersion(version: SongbookVersionOption) {
    if (!selectedEntry) return;
    setError("");
    try {
      const entry = await loadEntry(
        selectedEntry.id,
        version.kind === "user"
          ? { versionKind: "user", editorUserId: version.user_id ?? undefined }
          : { versionKind: "base" },
      );
      await projectSongEntry(entry, chordFamily);
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换版本失败");
    }
  }

  async function projectSongEntry(targetEntry: SongbookEntry, targetChordFamily: ChordFamily, markerIndex: number | null = null) {
    if (!roomId || !room) return;
    setProjectingSong(true);
    setError("");
    try {
      const response = await projectChangyouRoomPage(roomId, buildProjectionPayload(targetEntry, targetChordFamily, markerIndex));
      setRoom(response.room);
      setProjectedEntry(response.entry || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "投放失败");
    } finally {
      setProjectingSong(false);
    }
  }

  async function projectSelectedSong(markerIndex: number | null = null) {
    if (!selectedEntry) return;
    await projectSongEntry(selectedEntry, chordFamily, markerIndex);
  }

  async function handlePickChordFamily(nextFamily: ChordFamily) {
    setChordFamily(nextFamily);
    if (!selectedEntry) return;
    setError("");
    try {
      await projectSongEntry(selectedEntry, nextFamily);
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换 Chord 失败");
    }
  }

  async function handleUpdateMarker(markerIndex: number | null) {
    if (!roomId || !room) return;
    setMarking(true);
    setError("");
    try {
      const response = await updateChangyouRoomMarker(roomId, { marker_index: markerIndex });
      setRoom(response.room);
      setProjectedEntry(response.entry || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新标记失败");
    } finally {
      setMarking(false);
    }
  }

  async function handleStartMarker() {
    if (!selectedEntry) return;
    const firstHighlightable = projectionHighlightableIndices[0] ?? null;
    if (firstHighlightable == null) {
      setError("当前歌曲没有可点亮的歌词段落。");
      return;
    }
    if (projectingSelectedEntry && roomProjection) {
      await handleUpdateMarker(firstHighlightable);
      return;
    }
    await projectSelectedSong(firstHighlightable);
  }

  async function handleMoveMarker(step: -1 | 1) {
    if (!currentProjectedHighlightableIndices.length) return;
    const activeMarkerIndex = roomProjection?.marker_index ?? null;
    const fallbackPosition = step > 0 ? -1 : currentProjectedHighlightableIndices.length;
    const currentPosition =
      activeMarkerIndex == null ? fallbackPosition : currentProjectedHighlightableIndices.indexOf(activeMarkerIndex);
    const safePosition = currentPosition >= 0 ? currentPosition : fallbackPosition;
    const nextPosition = safePosition + step;
    if (nextPosition < 0 || nextPosition >= currentProjectedHighlightableIndices.length) return;
    await handleUpdateMarker(currentProjectedHighlightableIndices[nextPosition]);
  }

  async function handleNotify() {
    if (!roomId || !room || !notificationValue.trim()) return;
    setNotifying(true);
    setError("");
    try {
      await notifyChangyouRoom(roomId, {
        kind: "text",
        content: notificationValue.trim(),
      });
      setNotificationValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "推送通知失败");
    } finally {
      setNotifying(false);
    }
  }

  async function handleNotifyQr() {
    if (!roomId || !room || !notificationValue.trim()) return;
    setNotifying(true);
    setError("");
    try {
      await notifyChangyouRoom(roomId, {
        kind: "qr",
        content: notificationValue.trim(),
      });
      setNotificationValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "推送通知失败");
    } finally {
      setNotifying(false);
    }
  }

  function handleOpenPublicRoom() {
    if (IS_APK) {
      if (!publicRoomAppPath) return;
      navigate(publicRoomAppPath);
      return;
    }
    if (!publicRoomExternalUrl) return;
    window.open(publicRoomExternalUrl, "_blank", "noopener,noreferrer");
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName || "";
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        void handleMoveMarker(-1);
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        void handleMoveMarker(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentProjectedHighlightableIndices, roomProjection, roomId, room, selectedEntry]);

  if (loading) return <div style={stateStyle}>加载房间中…</div>;
  if (!room) return <div style={stateStyle}>{error || "房间不存在或已过期。"}</div>;

  function renderCurrentProjectionColumn(blocks: LyricProjectionBlock[]) {
    return (
      <div style={projectionColumnCompactStyle}>
        {blocks.map((block, blockIndex) => {
          const projectedBlockIndex = currentProjectedBlocks.findIndex((item) => item.id === block.id);
          const resolvedIndex = projectedBlockIndex >= 0 ? projectedBlockIndex : blockIndex;
          const active = roomProjection?.marker_index === resolvedIndex;
          const clickable = Boolean(block.highlightable);
          return (
            <button
              key={block.id || `${resolvedIndex}`}
              type="button"
              onClick={() => {
                if (!clickable) return;
                void handleUpdateMarker(resolvedIndex);
              }}
              style={projectionBlockStyle(active, clickable)}
            >
              <pre style={projectionBlockTextStyle(fontSize)}>{block.text}</pre>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={pageStyle(hideNav)}>
      <div style={pageInnerStyle}>
        <div style={topBarStyle(isMobile)}>
          <button type="button" onClick={() => navigate(CHANGYOU_ROOM_PATH)} style={backButtonStyle(isMobile)}>
            ← 返回房间列表
          </button>
          <div style={topBarActionsStyle}>
            <button
              type="button"
              onClick={handleOpenPublicRoom}
              style={ghostButtonStyle}
              disabled={!(IS_APK ? publicRoomAppPath : publicRoomExternalUrl)}
            >
              播放歌词端
            </button>
            <label style={togglePillStyle}>
              <input
                type="checkbox"
                checked={hideNav}
                onChange={(event) => setHideNav(event.target.checked)}
              />
              <span>隐藏导航</span>
            </label>
          </div>
        </div>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <main style={mainColumnStyle}>
          <section style={workflowSwitchStyle(isMobile)}>
            <button
              type="button"
              onClick={() => setWorkflowPage("songs")}
              style={workflowTabStyle(workflowPage === "songs")}
            >
              第 1 页 · 歌曲选择
            </button>
            <button
              type="button"
              onClick={() => setWorkflowPage("projection")}
              style={workflowTabStyle(workflowPage === "projection")}
              disabled={!selectedEntry}
            >
              第 2 页 · 投放歌词
            </button>
            <button
              type="button"
              onClick={() => setWorkflowPage("control")}
              style={workflowTabStyle(workflowPage === "control")}
              disabled={!projectedEntry}
            >
              第 3 页 · 投放控制
            </button>
          </section>

          <section style={projectionHubStyle}>
            {workflowPage === "songs" ? (
              <>
                <div style={projectionTopStyle(isMobile)}>
                  <div style={roomSummaryStyle}>
                    <div style={sectionTitleStyle}>公开播放页</div>
                    <div style={roomSummaryLineStyle}>{room.topic}</div>
                    <div style={roomSummaryHintStyle}>
                      QR 缩小放在上面。第一页点歌即投放，第二页只调投放版本和 Chord，第三页专心做标记和通知。
                    </div>
                    <div style={roomActionRowStyle}>
                      <button
                        type="button"
                        onClick={() => setRoomPickerOpen((open) => !open)}
                        style={secondaryButtonStyle}
                      >
                        {roomPickerOpen ? "收起房间切换" : "切换房间"}
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenPublicRoom}
                        style={primaryButtonStyle}
                        disabled={!(IS_APK ? publicRoomAppPath : publicRoomExternalUrl)}
                      >
                        {IS_APK ? "进入播放页" : "打开公开页"}
                      </button>
                    </div>
                  </div>
                  <div style={qrCardStyle}>
                    {qrDataUrl ? <img src={qrDataUrl} alt="room qr" style={qrStyle} /> : <div style={qrPlaceholderStyle}>QR</div>}
                    <div style={qrCaptionStyle}>扫码进入公开页</div>
                  </div>
                </div>

                {roomPickerOpen ? (
                  <CollapseCard
                    title="房间选择"
                    subtitle={rooms.length ? "点击卡片直接切换房间" : "还没有房间"}
                  >
                    {!rooms.length ? (
                      <div style={emptyStateStyle}>还没有可控制的房间。</div>
                    ) : (
                      <div style={roomCardGridStyle}>
                        {rooms.map((item) => (
                          <button
                            key={item.room_id}
                            type="button"
                            onClick={() => navigate(getChangyouRoomPath(item.room_id))}
                            style={roomCardStyle(item.room_id === roomId)}
                          >
                            <div style={roomCardTitleStyle}>{item.topic}</div>
                            <div style={roomCardMetaStyle}>房间码：{item.room_id}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </CollapseCard>
                ) : null}
              </>
            ) : null}

            {workflowPage === "songs" ? (
              <CollapseCard
                title="歌曲选择"
                subtitle="点歌曲卡片就会立刻投放，再进入下一页调版本和 Chord"
              >
                <input
                  value={songQuery}
                  onChange={(event) => setSongQuery(event.target.value)}
                  placeholder="搜索歌名或编号"
                  style={notifyInputStyle}
                />
                {entriesLoading ? (
                  <div style={emptyStateStyle}>加载歌曲中…</div>
                ) : filteredEntries.length === 0 ? (
                  <div style={emptyStateStyle}>没有匹配的歌曲。</div>
                ) : (
                  <>
                    <div style={pageToolbarStyle(isMobile)}>
                      <div style={pageBatchInfoStyle}>
                        第 {songBatchIndex + 1} / {songBatchCount} 组
                      </div>
                      <div style={pageToolbarActionsStyle}>
                        <button
                          type="button"
                          onClick={() => setSongBatchIndex((value) => Math.max(0, value - 1))}
                          style={ghostButtonStyle}
                          disabled={songBatchIndex === 0}
                        >
                          上一组
                        </button>
                        <button
                          type="button"
                          onClick={() => setSongBatchIndex((value) => Math.min(songBatchCount - 1, value + 1))}
                          style={ghostButtonStyle}
                          disabled={songBatchIndex >= songBatchCount - 1}
                        >
                          下一组
                        </button>
                      </div>
                    </div>
                    <div style={versionCardGridStyle}>
                      {songCardSlice.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => void handleSelectSong(item.id)}
                          style={versionCardStyle(selectedSongId === item.id)}
                        >
                          <div style={versionCardTitleStyle}>
                            {item.song_number ? `${item.song_number}. ` : ""}
                            {item.title}
                          </div>
                          <div style={versionCardMetaStyle}>
                            {item.variant} family
                            {item.selected_key ? ` · Key ${item.selected_key}` : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </CollapseCard>
            ) : workflowPage === "projection" ? (
              <CollapseCard
                title="投放歌词"
                subtitle="这个模块只做投放版本和 Chord，点击就会立刻同步到公开页"
              >
                {!selectedEntry ? (
                  <div style={emptyStateStyle}>先选一首歌。</div>
                ) : (
                  <>
                    <div style={setupSummaryStyle}>
                      <div style={setupSummaryTitleStyle}>{titleText}</div>
                      <div style={setupSummaryMetaStyle}>
                        当前投放：{selectedEntry.active_version_label || "当前版本"} · {chordFamily === "original" ? "原始 Chord" : `${chordFamily} family`}
                      </div>
                    </div>

                    <div style={settingsBlockStyle}>
                      <div style={settingsLabelStyle}>投放版本</div>
                      <div style={versionCardGridStyle}>
                        {versionOptions.map((option, index) => {
                          const active =
                            option.kind === selectedEntry.active_version &&
                            (option.kind === "base" || option.user_id === selectedEntry.active_editor_user_id);
                          return (
                            <button
                              key={`${option.kind}-${option.user_id ?? "base"}-${index}`}
                              type="button"
                              onClick={() => void handlePickVersion(option)}
                              style={versionCardStyle(active)}
                              disabled={projectingSong}
                            >
                              <div style={versionCardTitleStyle}>{index === 0 ? "原版" : option.label}</div>
                              <div style={versionCardMetaStyle}>{formatVersionMeta(option)}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={settingsBlockStyle}>
                      <div style={settingsLabelStyle}>投放 Chord</div>
                      <div style={chipRowStyle}>
                        {CHORD_FAMILY_OPTIONS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => void handlePickChordFamily(option)}
                            style={variantChipStyle(chordFamily === option)}
                            disabled={projectingSong}
                          >
                            {option === "original" ? "原始" : `${option} family`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={pageToolbarActionsStyle}>
                      <button
                        type="button"
                        onClick={() => void projectSelectedSong(null)}
                        style={primaryButtonStyle}
                        disabled={!selectedEntry || projectingSong}
                      >
                        {projectingSong ? "投放中..." : "重新投放当前设置"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkflowPage("control")}
                        style={secondaryButtonStyle}
                        disabled={!projectedEntry}
                      >
                        进入第 3 页控制
                      </button>
                    </div>
                  </>
                )}
              </CollapseCard>
            ) : (
              <>
                <section style={controlCardStyle}>
                  <div style={controlToolbarStyle(isMobile)}>
                    <div style={controlHeadingStyle}>
                      <div style={controlTitleStyle}>投放控制</div>
                      <div style={controlHintStyle}>键盘上下左右键也可顺序移动点亮内容。</div>
                    </div>
                    <div style={controlToolbarRowStyle}>
                      <button
                        type="button"
                        onClick={() => void handleStartMarker()}
                        style={smallPrimaryButtonStyle}
                        disabled={!selectedEntry || !projectionHighlightableIndices.length || marking}
                      >
                        开始标记
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveMarker(-1)}
                        style={smallSecondaryButtonStyle}
                        disabled={!currentProjectedHighlightableIndices.length || marking}
                      >
                        上一句
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveMarker(1)}
                        style={smallSecondaryButtonStyle}
                        disabled={!currentProjectedHighlightableIndices.length || marking}
                      >
                        下一句
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdateMarker(null)}
                        style={smallGhostButtonStyle}
                        disabled={!projectedEntry || marking}
                      >
                        清除
                      </button>
                      <input
                        value={notificationValue}
                        onChange={(event) => setNotificationValue(event.target.value)}
                        placeholder="输入通知文本或 QR 内容"
                        style={notifyInputCompactStyle}
                      />
                      <button
                        type="button"
                        onClick={() => void handleNotify()}
                        style={smallPrimaryButtonStyle}
                        disabled={notifying || !notificationValue.trim()}
                      >
                        {notifying ? "推送中..." : "推通知"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleNotifyQr()}
                        style={smallSecondaryButtonStyle}
                        disabled={notifying || !notificationValue.trim()}
                      >
                        {notifying ? "推送中..." : "推 QR"}
                      </button>
                    </div>
                  </div>
                </section>

                <section style={projectionPreviewCardStyle}>
                  <div style={projectionPreviewHeaderStyle}>
                    <div>
                      <div style={sectionTitleStyle}>当前播放内容</div>
                      <div style={currentProjectionMetaStyle}>
                        {projectedEntry
                          ? `${formatSongTitle(projectedEntry)}${roomProjection?.page_label ? ` · ${roomProjection.page_label}` : " · 整首歌词"}`
                          : "还没有投放内容"}
                      </div>
                    </div>
                    {projectedEntry ? (
                      <span style={pageChipStyle(true)}>
                        {roomProjection?.marker_index != null ? `已标记 ${roomProjection.marker_index + 1}` : "未开始标记"}
                      </span>
                    ) : null}
                  </div>
                  {!projectedEntry ? (
                    <div style={emptyStateStyle}>还没有投放歌词。</div>
                  ) : (
                    <div style={projectionStageStyle(isMobile, currentProjectedColumns.right.length > 0)}>
                      {renderCurrentProjectionColumn(currentProjectedColumns.left)}
                      {currentProjectedColumns.right.length ? renderCurrentProjectionColumn(currentProjectedColumns.right) : null}
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function CollapseCard({
  title,
  subtitle,
  open = true,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <section style={collapseCardStyle}>
      <button type="button" onClick={onToggle} style={collapseHeaderStyle}>
        <div>
          <div style={sectionTitleStyle}>{title}</div>
          {subtitle ? <div style={collapseSubtitleStyle}>{subtitle}</div> : null}
        </div>
        {onToggle ? <span style={collapseArrowStyle}>{open ? "收起" : "展开"}</span> : null}
      </button>
      {open ? <div style={collapseBodyStyle}>{children}</div> : null}
    </section>
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
  maxWidth: "1600px",
  margin: "0 auto",
  display: "grid",
  gap: "16px",
};

const topBarStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: isMobile ? "stretch" : "center",
  flexDirection: isMobile ? "column" : "row",
  gap: "12px",
});

const topBarActionsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

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

const ghostButtonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-strongest)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};

const togglePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "10px 14px",
  borderRadius: "999px",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
};

const layoutStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.8fr) minmax(320px, 0.9fr)",
  gap: "18px",
  alignItems: "start",
});

const mainColumnStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

const heroCardStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "28px",
  background: "linear-gradient(145deg, rgba(255,255,255,0.9), rgba(240,248,255,0.82))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 20px 40px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "18px",
};

const workflowSwitchStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
  gap: "12px",
});

const workflowTabStyle = (active: boolean): CSSProperties => ({
  padding: "16px 18px",
  borderRadius: "20px",
  border: active ? "1px solid rgba(15,118,110,0.26)" : "1px solid var(--x-color-line-soft)",
  background: active
    ? "linear-gradient(180deg, rgba(15,118,110,0.14), rgba(255,255,255,0.94))"
    : "rgba(255,255,255,0.78)",
  color: "var(--x-color-ink)",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: active ? "0 16px 30px rgba(15,118,110,0.1)" : "none",
});

const heroHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.4fr) minmax(260px, 1fr)",
  gap: "18px",
};

const heroTitleWrapStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const heroTitleStyle = (isMobile: boolean): CSSProperties => ({
  margin: 0,
  fontSize: isMobile ? "34px" : "44px",
  lineHeight: 1.05,
  color: "var(--x-color-ink)",
});

const heroCopyStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: 1.8,
  color: "var(--x-color-ink-muted)",
};

const heroStatGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
};

const metaWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const metaPillStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.76)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 800,
};

const miniStatStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.72)",
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

const projectionHubStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

const projectionTopStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 170px",
  gap: "14px",
  padding: "18px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 18px 34px var(--x-color-shadow-soft)",
});

const roomSummaryStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const roomSummaryLineStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const roomSummaryHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const roomActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const qrCardStyle: CSSProperties = {
  borderRadius: "22px",
  border: "1px solid var(--x-color-line-soft)",
  background: "rgba(255,255,255,0.86)",
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: "8px",
  padding: "12px",
};

const qrStyle: CSSProperties = {
  width: "100%",
  maxWidth: "124px",
  borderRadius: "16px",
  background: "white",
};

const qrPlaceholderStyle: CSSProperties = {
  width: "124px",
  height: "124px",
  borderRadius: "18px",
  display: "grid",
  placeItems: "center",
  background: "var(--x-color-panel-glass)",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const qrCaptionStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

const collapseCardStyle: CSSProperties = {
  borderRadius: "24px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 18px 34px var(--x-color-shadow-soft)",
  overflow: "hidden",
};

const collapseHeaderStyle: CSSProperties = {
  width: "100%",
  padding: "18px",
  border: "none",
  background: "transparent",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  textAlign: "left",
  cursor: "pointer",
};

const collapseSubtitleStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

const collapseArrowStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

const collapseBodyStyle: CSSProperties = {
  padding: "0 18px 18px",
  display: "grid",
  gap: "14px",
};

const controlCardStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "20px",
  background: "linear-gradient(135deg, rgba(8,47,73,0.96), rgba(15,118,110,0.92))",
  border: "1px solid rgba(125,211,252,0.14)",
  boxShadow: "0 14px 28px rgba(8,47,73,0.18)",
  display: "grid",
  gap: "10px",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const sectionLabelStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const roomCardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const roomCardStyle = (active: boolean): CSSProperties => ({
  padding: "16px",
  borderRadius: "18px",
  border: active ? "1px solid rgba(15,118,110,0.28)" : "1px solid var(--x-color-line-soft)",
  background: active ? "rgba(15,118,110,0.12)" : "rgba(255,255,255,0.78)",
  display: "grid",
  gap: "6px",
  textAlign: "left",
  cursor: "pointer",
});

const roomCardTitleStyle: CSSProperties = {
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const roomCardMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--x-color-ink-muted)",
};

const versionCardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const versionCardStyle = (active: boolean): CSSProperties => ({
  padding: "16px",
  borderRadius: "18px",
  border: active ? "1px solid rgba(59,130,246,0.28)" : "1px solid var(--x-color-line-soft)",
  background: active ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.78)",
  display: "grid",
  gap: "6px",
  textAlign: "left",
  cursor: "pointer",
});

const versionCardTitleStyle: CSSProperties = {
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const versionCardMetaStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.6,
  color: "var(--x-color-ink-muted)",
};

const setupSummaryStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "20px",
  border: "1px solid var(--x-color-line-soft)",
  background: "rgba(255,255,255,0.78)",
  display: "grid",
  gap: "8px",
};

const setupSummaryTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const setupSummaryMetaStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const pageToolbarStyle = (isMobile: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: isMobile ? "stretch" : "center",
  flexDirection: isMobile ? "column" : "row",
  gap: "10px",
});

const pageBatchInfoStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

const pageToolbarActionsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const pageGridStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
  gap: "12px",
});

const pageCardStyle = (active: boolean): CSSProperties => ({
  padding: "16px",
  borderRadius: "20px",
  border: active ? "1px solid rgba(245,158,11,0.3)" : "1px solid var(--x-color-line-soft)",
  background: active ? "linear-gradient(180deg, rgba(251,191,36,0.14), rgba(255,255,255,0.92))" : "rgba(255,255,255,0.82)",
  display: "grid",
  gap: "10px",
  textAlign: "left",
  cursor: "pointer",
});

const pageCardTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
};

const pageCardTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const pageCardSnippetStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const pageChipStyle = (active: boolean): CSSProperties => ({
  padding: "6px 10px",
  borderRadius: "999px",
  background: active ? "rgba(245,158,11,0.18)" : "rgba(15,23,42,0.08)",
  color: active ? "#92400e" : "var(--x-color-ink-muted)",
  fontSize: "11px",
  fontWeight: 900,
});

const pageActiveBadgeStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 900,
  color: "#92400e",
};

const controlToolbarStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: "10px",
});

const controlHeadingStyle: CSSProperties = {
  display: "grid",
  gap: "2px",
  alignContent: "center",
};

const controlTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 900,
  color: "#f0fdfa",
};

const controlHintStyle: CSSProperties = {
  fontSize: "11px",
  lineHeight: 1.5,
  color: "rgba(240,253,250,0.72)",
};

const controlToolbarRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  alignItems: "center",
  justifyContent: "flex-end",
};

const primaryButtonStyle: CSSProperties = {
  padding: "13px 18px",
  borderRadius: "14px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const smallPrimaryButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "12px",
  border: "none",
  background: "linear-gradient(135deg, #f97316, #f59e0b)",
  color: "white",
  fontSize: "12px",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "13px 18px",
  borderRadius: "14px",
  border: "1px solid rgba(15,118,110,0.2)",
  background: "rgba(255,255,255,0.88)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};

const smallSecondaryButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(191,219,254,0.24)",
  background: "rgba(255,255,255,0.14)",
  color: "#eff6ff",
  fontSize: "12px",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const smallGhostButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(226,232,240,0.16)",
  background: "rgba(15,23,42,0.18)",
  color: "rgba(240,253,250,0.9)",
  fontSize: "12px",
  fontWeight: 800,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dangerButtonStyle: CSSProperties = {
  padding: "13px 18px",
  borderRadius: "14px",
  border: "1px solid rgba(220,38,38,0.2)",
  background: "rgba(254,226,226,0.92)",
  color: "#991b1b",
  fontWeight: 800,
  cursor: "pointer",
};

const keyHintStyle: CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.7,
  color: "rgba(226,232,240,0.82)",
};

const notifyRowStyle = (isMobile: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
  gap: "10px",
});

const notifyInputStyle: CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(148,163,184,0.24)",
  background: "rgba(255,255,255,0.94)",
  boxSizing: "border-box",
};

const notifyInputCompactStyle: CSSProperties = {
  flex: "1 1 220px",
  minWidth: "180px",
  padding: "9px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(191,219,254,0.18)",
  background: "rgba(255,255,255,0.94)",
  boxSizing: "border-box",
  fontSize: "12px",
};

const projectionPreviewCardStyle: CSSProperties = {
  padding: 0,
  borderRadius: 0,
  background: "transparent",
  border: "none",
  boxShadow: "none",
  display: "grid",
  gap: "12px",
};

const projectionPreviewHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const currentProjectionMetaStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "13px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const projectionStageStyle = (isMobile: boolean, hasRightColumn: boolean): CSSProperties => ({
  minHeight: isMobile ? "auto" : "68vh",
  display: "grid",
  gridTemplateColumns: isMobile || !hasRightColumn ? "1fr" : "repeat(2, minmax(0, 1fr))",
  gap: isMobile ? "16px" : "28px",
  alignItems: "start",
});

const projectionColumnCompactStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  alignContent: "start",
};

const projectionBlockStyle = (active: boolean, clickable: boolean): CSSProperties => ({
  width: "100%",
  padding: "0",
  borderRadius: "14px",
  border: "none",
  background: active ? "rgba(250,204,21,0.14)" : "transparent",
  boxShadow: "none",
  cursor: clickable ? "pointer" : "default",
  textAlign: "left",
});

const projectionBlockTextStyle = (fontSize: number): CSSProperties => ({
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: `${fontSize}px`,
  lineHeight: 1.8,
  color: "var(--x-color-ink)",
  tabSize: 8,
  MozTabSize: 8,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  overflowWrap: "anywhere",
  overflowX: "auto",
  boxSizing: "border-box",
});

const sideCardStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, var(--x-color-panel-strongest), var(--x-color-panel))",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 16px 34px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "14px",
};

const settingsBlockStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const settingsLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const variantChipStyle = (active: boolean): CSSProperties => ({
  padding: "10px 12px",
  borderRadius: "999px",
  border: active ? "1px solid rgba(15,118,110,0.24)" : "1px solid var(--x-color-line)",
  background: active ? "rgba(15,118,110,0.12)" : "var(--x-color-panel-strongest)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
});

const hintStyle: CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
};

const fontControlRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  gap: "10px",
  alignItems: "center",
};

const fontButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-strongest)",
  fontWeight: 800,
  cursor: "pointer",
};

const fontValueStyle: CSSProperties = {
  textAlign: "center",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const actionStackStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const editorWrapStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

const editorStyle = (fontSize: number): CSSProperties => ({
  width: "100%",
  minHeight: "420px",
  padding: "18px",
  borderRadius: "18px",
  border: "1px solid var(--x-color-line)",
  background: "rgba(255,255,255,0.95)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
  fontSize: `${fontSize}px`,
  lineHeight: 1.8,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  tabSize: 8,
  MozTabSize: 8,
});

const contentStyle = (fontSize: number): CSSProperties => ({
  margin: 0,
  minHeight: "320px",
  maxHeight: "60vh",
  overflow: "auto",
  padding: "18px",
  borderRadius: "20px",
  background: "rgba(255,255,255,0.92)",
  border: "1px solid var(--x-color-line-soft)",
  boxSizing: "border-box",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: `${fontSize}px`,
  lineHeight: 1.8,
  color: "var(--x-color-ink)",
  tabSize: 8,
  MozTabSize: 8,
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
});

const stateStyle: CSSProperties = {
  minHeight: "40vh",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
};

const errorStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(254,226,226,0.9)",
  border: "1px solid rgba(220,38,38,0.18)",
  color: "#991b1b",
  fontWeight: 700,
};

const emptyStateStyle: CSSProperties = {
  minHeight: "120px",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.78)",
  border: "1px dashed var(--x-color-line-soft)",
  display: "grid",
  placeItems: "center",
  gap: "10px",
  color: "var(--x-color-ink-muted)",
  padding: "18px",
  textAlign: "center",
};
