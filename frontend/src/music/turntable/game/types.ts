export type QuizGameStatus = "lobby" | "question" | "reveal" | "podium";

export type QuizGameOption = { zh: string; en: string };

export type QuizGameQuestion = {
  id?: number;
  section: string;
  zh: string;
  en: string;
  options: QuizGameOption[];
  answer: number;
};

export type QuizGameSet = {
  id: number;
  title: string;
  description: string;
  question_time: number;
  position: number;
  is_archived: boolean;
  question_count: number;
  created_at?: string | null;
  updated_at?: string | null;
  questions?: QuizGameQuestion[];
};

export type PublicQuestion = {
  index: number;
  total: number;
  section: string;
  zh: string;
  en: string;
  options: QuizGameOption[];
  time: number;
  endsAt: number;
};

export type PlayerRow = { id: string; name: string; score: number; online: boolean };

export type LeaderRow = {
  rank: number;
  id: string;
  name: string;
  score: number;
  lastGain: number;
  streak: number;
};

export type RevealData = { correct: number | null; counts: number[]; index: number; total: number };

export type MyResult = {
  answered: boolean;
  choice: number | null;
  correct: boolean;
  gain: number;
  score: number;
  rank: number | null;
  streak: number;
};

export type HostSnapshot = {
  role?: "host";
  room_token: string;
  set_id: number;
  title: string;
  status: QuizGameStatus;
  server_now_ms: number;
  players: PlayerRow[];
  player_count: number;
  question: PublicQuestion | null;
  answered_count: number;
  reveal: RevealData | null;
  leaderboard: LeaderRow[] | null;
};

export type PlayerSnapshot = {
  role?: "player";
  room_token: string;
  set_id: number;
  title: string;
  status: QuizGameStatus;
  server_now_ms: number;
  me: { id: string; name: string; score: number } | null;
  question: PublicQuestion | null;
  my_choice: number | null;
  reveal: (RevealData & { me: MyResult }) | null;
  leaderboard: LeaderRow[] | null;
};

export const OPTION_COLORS = ["#e21b3c", "#1368ce", "#d89e00", "#26890c", "#7c3aed", "#0891b2"];
export const OPTION_SHAPES = ["▲", "◆", "●", "■", "★", "✦"];
