import type { MinuteLogRecord } from "./types";

export type ListeningSessionRecord = {
  key: string;
  music_user_play_minute_id?: number | null;
  music_id?: number | null;
  music_title?: string | null;
  user_id?: number | null;
  username?: string | null;
  display_name?: string | null;
  start_at: string;
  end_at: string;
  minute_count: number;
};

type ParsedNaiveDate = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const ISO_NAIVE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function parseNaiveIso(value?: string | null): ParsedNaiveDate | null {
  if (!value) {
    return null;
  }
  const match = ISO_NAIVE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || "0"),
  };
}

function toMinuteIndex(value?: string | null): number | null {
  const parsed = parseNaiveIso(value);
  if (!parsed) {
    return null;
  }
  return Math.floor(
    Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      parsed.hour,
      parsed.minute,
      parsed.second,
    ) / 60_000,
  );
}

function isSameListeningStream(
  current: MinuteLogRecord,
  next: MinuteLogRecord,
) {
  if (
    current.music_user_play_minute_id != null &&
    next.music_user_play_minute_id != null
  ) {
    return current.music_user_play_minute_id === next.music_user_play_minute_id;
  }
  return (
    current.music_id === next.music_id &&
    current.user_id === next.user_id &&
    (current.username || "") === (next.username || "") &&
    (current.display_name || "") === (next.display_name || "")
  );
}

export function groupMinuteLogsIntoSessions(
  items: MinuteLogRecord[],
): ListeningSessionRecord[] {
  const logs = [...items]
    .filter((item) => Boolean(item?.created_at))
    .sort((a, b) => {
      const timeCompare = String(a.created_at).localeCompare(String(b.created_at));
      if (timeCompare !== 0) {
        return timeCompare;
      }
      return (a.id || 0) - (b.id || 0);
    });

  const sessions: ListeningSessionRecord[] = [];
  let currentSession: ListeningSessionRecord | null = null;
  let currentLog: MinuteLogRecord | null = null;
  let currentMinuteIndex: number | null = null;

  logs.forEach((log) => {
    const minuteIndex = toMinuteIndex(log.created_at);
    if (minuteIndex == null || !log.created_at) {
      return;
    }

    if (
      currentSession &&
      currentLog &&
      currentMinuteIndex != null &&
      isSameListeningStream(currentLog, log) &&
      minuteIndex - currentMinuteIndex <= 1
    ) {
      currentSession.end_at = log.created_at;
      currentSession.minute_count += 1;
      currentLog = log;
      currentMinuteIndex = minuteIndex;
      return;
    }

    currentSession = {
      key: `${log.music_user_play_minute_id || log.music_id || "music"}:${log.created_at}:${log.id || 0}`,
      music_user_play_minute_id: log.music_user_play_minute_id,
      music_id: log.music_id,
      music_title: log.music_title,
      user_id: log.user_id,
      username: log.username,
      display_name: log.display_name,
      start_at: log.created_at,
      end_at: log.created_at,
      minute_count: 1,
    };
    sessions.push(currentSession);
    currentLog = log;
    currentMinuteIndex = minuteIndex;
  });

  return sessions.sort((a, b) => b.end_at.localeCompare(a.end_at));
}

export function formatListeningUser(
  session: Pick<ListeningSessionRecord, "display_name" | "username" | "user_id">,
): string {
  return (
    session.display_name?.trim() ||
    session.username?.trim() ||
    (session.user_id != null ? `用户 #${session.user_id}` : "未知用户")
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatNaiveDate(value?: string | null): string {
  const parsed = parseNaiveIso(value);
  if (!parsed) {
    return "--";
  }
  return `${parsed.year}-${pad(parsed.month)}-${pad(parsed.day)}`;
}

export function formatNaiveTime(value?: string | null): string {
  const parsed = parseNaiveIso(value);
  if (!parsed) {
    return "--:--";
  }
  return `${pad(parsed.hour)}:${pad(parsed.minute)}`;
}

export function formatMinuteSessionWindow(
  session: Pick<ListeningSessionRecord, "start_at" | "end_at">,
): string {
  const startDate = formatNaiveDate(session.start_at);
  const endDate = formatNaiveDate(session.end_at);
  const startTime = formatNaiveTime(session.start_at);
  const endTime = formatNaiveTime(session.end_at);

  if (startDate === endDate) {
    if (startTime === endTime) {
      return `${startDate} ${startTime}`;
    }
    return `${startDate} ${startTime} - ${endTime}`;
  }
  return `${startDate} ${startTime} - ${endDate} ${endTime}`;
}

export function formatSessionDuration(minutes?: number | null): string {
  const safeMinutes = Math.max(1, Math.round(Number(minutes || 0) || 1));
  return `${safeMinutes} 分钟`;
}

export function sumSessionMinutes(
  sessions: Array<Pick<ListeningSessionRecord, "minute_count">>,
): number {
  return sessions.reduce(
    (sum, session) => sum + Math.max(0, Number(session.minute_count || 0)),
    0,
  );
}

export function countUniqueListeners(
  sessions: Array<
    Pick<ListeningSessionRecord, "user_id" | "username" | "display_name">
  >,
): number {
  return new Set(
    sessions.map((session) =>
      [
        session.user_id ?? "",
        session.username ?? "",
        session.display_name ?? "",
      ].join(":"),
    ),
  ).size;
}
