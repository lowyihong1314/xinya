import { apiFetch } from "../../../js/apiFetch";
import type { QuizApiPayload, QuizConfig, QuizSessionSnapshot } from "./types";

async function parseQuizResponse(response: Response): Promise<QuizApiPayload> {
  const payload = (await response.json().catch(() => ({}))) as QuizApiPayload;
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.message || "抢答服务请求失败");
  }
  return payload;
}

function requireSession(payload: QuizApiPayload): QuizSessionSnapshot {
  if (!payload.session) {
    throw new Error("抢答服务没有返回活动资料");
  }
  return payload.session;
}

export async function createQuizSession() {
  const payload = await parseQuizResponse(
    await apiFetch("/api/quiz/session", {
      method: "POST",
      credentials: "include",
    }),
  );
  return requireSession(payload);
}

export async function getQuizSession(token: string) {
  const payload = await parseQuizResponse(
    await apiFetch(`/api/quiz/session/${encodeURIComponent(token)}`, {
      credentials: "include",
    }),
  );
  return requireSession(payload);
}

export async function saveQuizConfig(token: string, config: QuizConfig) {
  const payload = await parseQuizResponse(
    await apiFetch(`/api/quiz/session/${encodeURIComponent(token)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    }),
  );
  return requireSession(payload);
}

export async function publishQuizSession(token: string) {
  const payload = await parseQuizResponse(
    await apiFetch(`/api/quiz/session/${encodeURIComponent(token)}/publish`, {
      method: "POST",
      credentials: "include",
    }),
  );
  return requireSession(payload);
}

export async function resetQuizSession(token: string) {
  const payload = await parseQuizResponse(
    await apiFetch(`/api/quiz/session/${encodeURIComponent(token)}/reset`, {
      method: "POST",
      credentials: "include",
    }),
  );
  return requireSession(payload);
}

export async function closeQuizSession(token: string) {
  const payload = await parseQuizResponse(
    await apiFetch(`/api/quiz/session/${encodeURIComponent(token)}/close`, {
      method: "POST",
      credentials: "include",
    }),
  );
  return requireSession(payload);
}
