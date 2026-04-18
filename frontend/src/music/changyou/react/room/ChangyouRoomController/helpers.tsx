import { buildProjectionBlocks, ensureProjectionBlocks, type LyricProjectionBlock } from "../../projection";
import type { SongbookEntry, SongbookVersionOption } from "../../types";
import type { ChangyouRoom, ChangyouRoomProjection } from "../api";

export const FONT_SIZE_STORAGE_KEY = "xinya.changyou.fontSize";
export const HIDE_NAV_STORAGE_KEY = "xinya.changyou.hideNav";
export const CHORD_FAMILY_STORAGE_KEY = "xinya.changyou.chordFamily";
export const DEFAULT_FONT_SIZE = 18;
export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 30;
export const SONG_CARD_BATCH_DESKTOP = 18;
export const SONG_CARD_BATCH_MOBILE = 10;
export const APK_PUBLIC_ROOM_BASE_URL = "http://utbabuddha.com";

export type ChordFamily = "original" | "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type ControllerPage = "songs" | "projection" | "control";

export const CHORD_FAMILY_OPTIONS: ChordFamily[] = ["original", "C", "D", "E", "F", "G", "A", "B"];

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

export function transformChordContent(content: string, targetFamily: ChordFamily) {
  if (targetFamily === "original") return content;
  return content
    .split("\n")
    .map((line) => (isChordLine(line) ? transposeChordLine(line, targetFamily) : line))
    .join("\n");
}

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
