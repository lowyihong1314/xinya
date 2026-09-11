export type MirrorStatus = "lobby" | "rating" | "reveal";

export type MirrorMember = { id: string; name: string; online: boolean; joined_at_ms?: number; photo_at_ms: number };

export type MirrorRosterRow = { id: string; name: string; finished: boolean; photo_at_ms: number };

export type MirrorTarget = { id: string; name: string; photo_at_ms: number };

export type MirrorResult = {
  rated_count: number;
  skipped_count: number;
  peer_count: number;
  min_reveal_count: number;
  visible: boolean;
  average: number | null;
  counts: number[] | null;
};

type MirrorBaseMeta = {
  room_token: string;
  title: string;
  status: MirrorStatus;
  min_reveal_count: number;
  server_now_ms: number;
  token_expires_at_ms?: number | null;
};

export type MirrorSessionMeta = MirrorBaseMeta & { member_count: number };

export type MirrorHostSnapshot = MirrorBaseMeta & {
  role?: "host";
  members: MirrorMember[];
  member_count: number;
  roster: MirrorRosterRow[];
  roster_count: number;
  finished_count: number;
};

export type MirrorPlayerSnapshot = MirrorBaseMeta & {
  role?: "player";
  me: { id: string; name: string; photo_at_ms: number } | null;
  in_roster: boolean;
  member_count: number;
  targets: MirrorTarget[];
  /** target_id -> "1".."5" | "skip", only ever this player's own answers. */
  my_scores: Record<string, string>;
  rated_count: number;
  finished: boolean;
  finished_count: number;
  roster_count: number;
  my_result: MirrorResult | null;
};

export const SKIP_VALUE = "skip";

export const SCORE_ITEMS: Array<{ score: number; label: string; desc: string; color: string }> = [
  { score: 1, label: "1 分", desc: "明显感到被冒犯、忽视或不被尊重", color: "#c0392b" },
  { score: 2, label: "2 分", desc: "有些言行令人不舒服", color: "#d97706" },
  { score: 3, label: "3 分", desc: "普通，没有明显失礼", color: "#6b7280" },
  { score: 4, label: "4 分", desc: "大部分互动礼貌且尊重", color: "#2f8f4e" },
  { score: 5, label: "5 分", desc: "言语、语气和行为都让人感到真诚与尊重", color: "#16794c" },
];

export const SCORE_COLORS = SCORE_ITEMS.map((item) => item.color);

/** Shown on the rating screen — the ground rules that make the activity safe. */
export const RATING_REMINDERS = [
  "全程匿名，没有人知道谁给了谁几分",
  "结束后不讨论谁给了多少分",
  "今天没有足够互动，请选择「无法判断」",
  "请根据真实感受评分",
  "评价的是今天的互动感受，不是在定义一个人",
];

/** The prompts for the silent 1–2 minutes after results open. */
export const FIRST_THOUGHT_HINTS = ["开心？", "意外？", "不服气？", "觉得不公平？", "想知道是谁给的分？", "想马上解释自己？"];
