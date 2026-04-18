import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import QRCode from "qrcode";
import { useNavigate } from "react-router-dom";

import { useUserState } from "../../../../../app/UserState";
import { IS_APK } from "../../../../../js/apiBase";
import { useBaseNavbarVisibility } from "../../../../../router/AppChromeContext";
import { useEnsureDesignTokens } from "../../../../../theme/designTokens";
import {
  CHANGYOU_ROOM_PATH,
  getChangyouPublicRoomPath,
  getChangyouRoomPath,
  getChangyouRoomPlayerPath,
} from "../../../../router/paths";
import { fetchSongbookEntries, fetchSongbookEntry, saveMySongbookEdit } from "../../api";
import { buildProjectionBlocks, splitBlocksForDoublePage } from "../../projection";
import type { SongbookEntry, SongbookVersionOption } from "../../types";
import {
  APK_PUBLIC_ROOM_BASE_URL,
  CHORD_FAMILY_OPTIONS,
  CHORD_FAMILY_STORAGE_KEY,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_STORAGE_KEY,
  HIDE_NAV_STORAGE_KEY,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  SONG_CARD_BATCH_DESKTOP,
  SONG_CARD_BATCH_MOBILE,
  buildProjectionPayload,
  buildVersionHelperText,
  formatSongTitle,
  formatVersionMeta,
  getProjectionBlocks,
  isProjectionForEntry,
  transformChordContent,
  type ChordFamily,
  type ControllerPage,
} from "./helpers";
import { CollapseCard, ProjectionColumn, ProjectionLyricsContextMenu } from "./components";
import {
  backButtonStyle,
  controlCardStyle,
  controlHeadingStyle,
  controlHintStyle,
  controlTitleStyle,
  controlToolbarRowStyle,
  controlToolbarStyle,
  currentProjectionMetaStyle,
  editorStyle,
  editorWrapStyle,
  emptyStateStyle,
  errorStyle,
  ghostButtonStyle,
  hintStyle,
  mainColumnStyle,
  notifyInputCompactStyle,
  notifyInputStyle,
  pageBatchInfoStyle,
  pageChipStyle,
  pageInnerStyle,
  pageStyle,
  pageToolbarActionsStyle,
  pageToolbarStyle,
  primaryButtonStyle,
  projectionHubStyle,
  projectionPreviewCardStyle,
  projectionPreviewHeaderStyle,
  projectionStageStyle,
  projectionTopStyle,
  qrCaptionStyle,
  qrCardStyle,
  qrPlaceholderStyle,
  qrStyle,
  roomActionRowStyle,
  roomCardGridStyle,
  roomCardMetaStyle,
  roomCardStyle,
  roomCardTitleStyle,
  roomSummaryHintStyle,
  roomSummaryLineStyle,
  roomSummaryStyle,
  sectionTitleStyle,
  secondaryButtonStyle,
  settingsBlockStyle,
  settingsLabelStyle,
  setupSummaryMetaStyle,
  setupSummaryStyle,
  setupSummaryTitleStyle,
  smallGhostButtonStyle,
  smallPrimaryButtonStyle,
  smallSecondaryButtonStyle,
  stateStyle,
  togglePillStyle,
  topBarActionsStyle,
  topBarStyle,
  variantChipStyle,
  versionCardGridStyle,
  versionCardMetaStyle,
  versionCardStyle,
  versionCardTitleStyle,
  workflowSwitchStyle,
  workflowTabStyle,
  chipRowStyle,
} from "./styles";
import { connectChangyouRoom } from "../socket";
import {
  fetchChangyouRoom,
  fetchChangyouRoomCurrent,
  fetchChangyouRooms,
  notifyChangyouRoom,
  projectChangyouRoomPage,
  type ChangyouRoom,
  updateChangyouRoomMarker,
} from "../api";

export function ChangyouRoomController({ roomId }: { roomId: string }) {
  useEnsureDesignTokens();

  const navigate = useNavigate();
  const { isAuthenticated, isMobile, openLogin } = useUserState();
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
  const [preparingProjectionEdit, setPreparingProjectionEdit] = useState(false);
  const [editingProjection, setEditingProjection] = useState(false);
  const [savingProjectionEdit, setSavingProjectionEdit] = useState(false);
  const [projectionEditorValue, setProjectionEditorValue] = useState("");
  const [projectionLyricsMenu, setProjectionLyricsMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

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

  useEffect(() => {
    if (!projectionLyricsMenu) {
      return;
    }

    const handlePointerDown = () => setProjectionLyricsMenu(null);
    const handleScroll = () => setProjectionLyricsMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectionLyricsMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectionLyricsMenu]);

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

  useEffect(() => {
    setEditingProjection(false);
    setPreparingProjectionEdit(false);
    setSavingProjectionEdit(false);
    setProjectionEditorValue("");
    setProjectionLyricsMenu(null);
  }, [projectedEntry?.id]);

  function handleProjectionLyricsContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const menuWidth = 168;
    const menuHeight = 56;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : event.clientX + menuWidth;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : event.clientY + menuHeight;
    const x = Math.max(12, Math.min(event.clientX, viewportWidth - menuWidth - 12));
    const y = Math.max(12, Math.min(event.clientY, viewportHeight - menuHeight - 12));
    setProjectionLyricsMenu({ x, y });
  }

  async function handleBeginProjectionEdit() {
    setProjectionLyricsMenu(null);
    if (!projectedEntry) return;
    if (!isAuthenticated) {
      openLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`);
      return;
    }

    setPreparingProjectionEdit(true);
    setError("");
    try {
      const entry =
        selectedEntry && isProjectionForEntry(room, selectedEntry)
          ? selectedEntry
          : await loadEntry(
              projectedEntry.id,
              room?.version_kind === "user"
                ? { versionKind: "user", editorUserId: room.editor_user_id || null }
                : { versionKind: "base" },
            );
      setProjectionEditorValue(entry.content || "");
      setEditingProjection(true);
      setWorkflowPage("control");
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开编辑失败");
    } finally {
      setPreparingProjectionEdit(false);
    }
  }

  async function handleSaveProjectionEdit() {
    if (!roomId || !room || !projectedEntry) return;
    if (!projectionEditorValue.trim()) {
      setError("歌词内容不能为空。");
      return;
    }
    if (!isAuthenticated) {
      openLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`);
      return;
    }

    setSavingProjectionEdit(true);
    setError("");
    try {
      const saveResponse = await saveMySongbookEdit(projectedEntry.id, projectionEditorValue);
      const savedEntry = saveResponse.entry;
      setSelectedEntry(savedEntry);

      const nextProjection = buildProjectionPayload(savedEntry, chordFamily);
      const markerIndex = roomProjection?.marker_index ?? null;
      const safeMarkerIndex =
        markerIndex != null && nextProjection.blocks[markerIndex]?.highlightable ? markerIndex : null;
      const projectionResponse = await projectChangyouRoomPage(roomId, {
        ...nextProjection,
        marker_index: safeMarkerIndex,
      });

      setRoom(projectionResponse.room);
      setProjectedEntry(projectionResponse.entry || null);
      setProjectionEditorValue(savedEntry.content || "");
      setEditingProjection(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存编辑失败");
    } finally {
      setSavingProjectionEdit(false);
    }
  }

  function handleCancelProjectionEdit() {
    setEditingProjection(false);
    setProjectionEditorValue("");
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
                        {savingProjectionEdit
                          ? "保存中..."
                          : preparingProjectionEdit
                            ? "准备编辑..."
                            : editingProjection
                              ? "编辑中"
                              : roomProjection?.marker_index != null
                                ? `已标记 ${roomProjection.marker_index + 1}`
                                : "未开始标记"}
                      </span>
                    ) : null}
                  </div>
                  {!projectedEntry ? (
                    <div style={emptyStateStyle}>还没有投放歌词。</div>
                  ) : preparingProjectionEdit ? (
                    <div style={emptyStateStyle}>正在准备可编辑内容…</div>
                  ) : editingProjection ? (
                    <div style={editorWrapStyle}>
                      <textarea
                        value={projectionEditorValue}
                        onChange={(event) => setProjectionEditorValue(event.target.value)}
                        style={editorStyle(fontSize)}
                      />
                      <div style={hintStyle}>
                        保存后会直接写入“我的编辑版”，并立刻重新投放到当前房间。
                      </div>
                      <div style={pageToolbarActionsStyle}>
                        <button
                          type="button"
                          onClick={() => void handleSaveProjectionEdit()}
                          style={primaryButtonStyle}
                          disabled={savingProjectionEdit || !projectionEditorValue.trim()}
                        >
                          {savingProjectionEdit ? "保存并投放中..." : "保存为我的编辑版"}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelProjectionEdit}
                          style={secondaryButtonStyle}
                          disabled={savingProjectionEdit}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={projectionStageStyle(isMobile, currentProjectedColumns.right.length > 0)}
                      onContextMenu={handleProjectionLyricsContextMenu}
                    >
                      <ProjectionColumn
                        blocks={currentProjectedColumns.left}
                        currentProjectedBlocks={currentProjectedBlocks}
                        activeMarkerIndex={roomProjection?.marker_index}
                        fontSize={fontSize}
                        onSelectMarker={(resolvedIndex, clickable) => {
                          if (!clickable) return;
                          void handleUpdateMarker(resolvedIndex);
                        }}
                      />
                      {currentProjectedColumns.right.length ? (
                        <ProjectionColumn
                          blocks={currentProjectedColumns.right}
                          currentProjectedBlocks={currentProjectedBlocks}
                          activeMarkerIndex={roomProjection?.marker_index}
                          fontSize={fontSize}
                          onSelectMarker={(resolvedIndex, clickable) => {
                            if (!clickable) return;
                            void handleUpdateMarker(resolvedIndex);
                          }}
                        />
                      ) : null}
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </main>
      </div>
      <ProjectionLyricsContextMenu
        menu={projectionLyricsMenu}
        onEdit={() => void handleBeginProjectionEdit()}
      />
    </div>
  );
}
