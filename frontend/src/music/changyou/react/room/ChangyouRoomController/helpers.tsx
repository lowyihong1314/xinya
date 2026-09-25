import { buildProjectionBlocks, ensureProjectionBlocks, type LyricProjectionBlock } from "../../projection";
import type { SongbookEntry, SongbookVersionOption } from "../../types";
import type { ChangyouRoom, ChangyouRoomProjection } from "../api";
import { transformChordContent, type ChordFamily } from "../../shared/chords";

export { CHORD_FAMILY_OPTIONS, transformChordContent } from "../../shared/chords";
export type { ChordFamily } from "../../shared/chords";

export const FONT_SIZE_STORAGE_KEY = "xinya.changyou.fontSize";
export const HIDE_NAV_STORAGE_KEY = "xinya.changyou.hideNav";
export const CHORD_FAMILY_STORAGE_KEY = "xinya.changyou.chordFamily";
export const DEFAULT_FONT_SIZE = 18;
export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 30;
export const SONG_CARD_BATCH_DESKTOP = 18;
export const SONG_CARD_BATCH_MOBILE = 10;
export const APK_PUBLIC_ROOM_BASE_URL = "http://utbabuddha.com";

export type ControllerPage = "songs" | "projection" | "control";

export function buildVersionHelperText(entry: SongbookEntry | null) {
  if (!entry) return "当前显示原版内容。";
  if (entry.active_version === "user") {
    return `当前显示 ${entry.active_editor_name || "个人"} 版本，可继续另存为自己的编辑版。`;
  }
  return "当前显示原版内容，可以切换到其他成员共享的编辑版。";
}

export function formatVersionMeta(option: SongbookVersionOption) {
  if (option.kind === "base") return "默认原版";
  if (option.is_me) return "我的编辑版";
  return option.editor_name || "成员版本";
}

export function formatSongTitle(entry: SongbookEntry | null) {
  if (!entry) return "未投放";
  return `${entry.song_number ? `${entry.song_number}. ` : ""}${entry.title}`;
}

export function isProjectionForEntry(room: ChangyouRoom | null, entry: SongbookEntry | null) {
  if (!room || !entry) return false;
  const roomEditorId = room.editor_user_id || null;
  const entryEditorId = entry.active_version === "user" ? entry.active_editor_user_id || null : null;
  return (
    room.song_entry_id === entry.id &&
    (room.version_kind || "base") === (entry.active_version || "base") &&
    roomEditorId === entryEditorId
  );
}

export function getProjectionBlocks(
  projection: ChangyouRoomProjection | null | undefined,
  fallbackContent: string,
) {
  return ensureProjectionBlocks((projection?.blocks as LyricProjectionBlock[] | undefined) || [], fallbackContent);
}

export function buildProjectionPayload(
  targetEntry: SongbookEntry,
  targetChordFamily: ChordFamily,
  markerIndex: number | null = null,
) {
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
