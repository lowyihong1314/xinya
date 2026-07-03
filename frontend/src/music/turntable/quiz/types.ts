export type QuizStatus = "draft" | "waiting" | "open" | "closed";

export type QuizConfig = {
  title: string;
  wait_seconds: number;
};

export type QuizEntry = {
  rank: number;
  guest_id: string;
  guest_name: string;
  client_clicked_at_ms?: number | null;
  server_received_at_ms: number;
  delta_from_cutoff_ms: number;
};

export type QuizSessionSnapshot = {
  room_token: string;
  status: QuizStatus;
  server_now_ms: number;
  config: QuizConfig;
  cutoff_at_ms: number | null;
  published_at_ms: number | null;
  player_count: number;
  leaderboard: QuizEntry[];
  token_expires_at_ms?: number | null;
};

export type QuizApiPayload = {
  status: "success" | "error";
  message?: string;
  reason?: string;
  token?: string;
  session?: QuizSessionSnapshot;
};
