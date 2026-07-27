import { apiFetch } from "../../../js/apiFetch";
import type { HostSnapshot, QuizGameQuestion, QuizGameSet } from "./types";

type ApiPayload = {
  status: "success" | "error";
  message?: string;
  reason?: string;
  token?: string;
  set?: QuizGameSet;
  sets?: QuizGameSet[];
  session?: HostSnapshot | Record<string, unknown>;
  questions?: QuizGameQuestion[];
};

async function parse(response: Response): Promise<ApiPayload> {
  const payload = (await response.json().catch(() => ({}))) as ApiPayload;
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.message || "问答游戏服务请求失败");
  }
  return payload;
}

const BASE = "/api/quiz_game";

function requireSet(payload: ApiPayload): QuizGameSet {
  if (!payload.set) throw new Error("服务器没有返回题库");
  return payload.set;
}

export async function listSets(): Promise<QuizGameSet[]> {
  const payload = await parse(await apiFetch(`${BASE}/sets`, { credentials: "include" }));
  return payload.sets || [];
}

export async function getSet(setId: number): Promise<QuizGameSet> {
  return requireSet(await parse(await apiFetch(`${BASE}/sets/${setId}`, { credentials: "include" })));
}

export async function createSet(input: {
  title: string;
  description?: string;
  question_time?: number;
  questions?: QuizGameQuestion[];
}): Promise<QuizGameSet> {
  return requireSet(
    await parse(
      await apiFetch(`${BASE}/sets`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),
  );
}

export async function updateSet(
  setId: number,
  input: {
    title?: string;
    description?: string;
    question_time?: number;
    is_archived?: boolean;
    questions?: QuizGameQuestion[];
  },
): Promise<QuizGameSet> {
  return requireSet(
    await parse(
      await apiFetch(`${BASE}/sets/${setId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    ),
  );
}

export async function deleteSet(setId: number): Promise<void> {
  await parse(await apiFetch(`${BASE}/sets/${setId}`, { method: "DELETE", credentials: "include" }));
}

export async function generateQuestionsWithAI(input: {
  prompt: string;
  count?: number;
  set_title?: string;
}): Promise<QuizGameQuestion[]> {
  const payload = await parse(
    await apiFetch(`${BASE}/ai/generate`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return payload.questions || [];
}

export async function createGameSession(setId: number): Promise<{ token: string; session: HostSnapshot }> {
  const payload = await parse(
    await apiFetch(`${BASE}/session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ set_id: setId }),
    }),
  );
  if (!payload.token || !payload.session) throw new Error("服务器没有返回游戏房间");
  return { token: payload.token, session: payload.session as HostSnapshot };
}

export async function getGameSession(token: string): Promise<{
  room_token: string;
  title: string;
  status: string;
  player_count: number;
  total_questions: number;
}> {
  const payload = await parse(
    await apiFetch(`${BASE}/session/${encodeURIComponent(token)}`, { credentials: "include" }),
  );
  return payload.session as never;
}
