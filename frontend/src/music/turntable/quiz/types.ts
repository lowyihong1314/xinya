export type QuizStatus = "draft" | "waiting" | "open" | "answered" | "closed";

export type QuizAnswer = {
  index: number;
  text: string;
  enabled: boolean;
};

export type QuizConfig = {
  start_at_ms: number | null;
  question: string;
  correct_answer_index: number | null;
  answers: QuizAnswer[];
};

export type QuizWinner = {
  guest_id: string;
  guest_name: string;
  answer_index: number;
  answer_text: string;
  correct_answer_index: number;
  correct_answer_text: string;
  is_correct: boolean;
  client_clicked_at_ms?: number | null;
  server_received_at_ms: number;
  delta_from_start_ms: number;
};

export type QuizSessionSnapshot = {
  room_token: string;
  status: QuizStatus;
  server_now_ms: number;
  config: QuizConfig;
  winner: QuizWinner | null;
  token_expires_at_ms?: number | null;
};

export type QuizApiPayload = {
  status: "success" | "error";
  message?: string;
  reason?: string;
  token?: string;
  session?: QuizSessionSnapshot;
};
