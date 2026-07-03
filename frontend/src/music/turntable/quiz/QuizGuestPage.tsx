import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import type { Socket } from "socket.io-client";

import { useBaseNavbarVisibility } from "../../../router/AppChromeContext";
import { getQuizSession } from "./api";
import { connectQuizSocket } from "./quizSocket";
import type { QuizSessionSnapshot } from "./types";

const GUEST_ID_STORAGE_KEY = "xinya.quiz.guestId";
const GUEST_NAME_STORAGE_KEY = "xinya.quiz.guestName";

export function QuizGuestPage() {
  useBaseNavbarVisibility(false);

  const location = useLocation();
  const token = useMemo(() => new URLSearchParams(location.search).get("token")?.trim().toLowerCase() || "", [location.search]);
  const [guestId] = useState(() => getOrCreateGuestId());
  const [guestName, setGuestName] = useState(() => window.localStorage.getItem(GUEST_NAME_STORAGE_KEY) || "");
  const [joined, setJoined] = useState(false);
  const [snapshot, setSnapshot] = useState<QuizSessionSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [submitted, setSubmitted] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);

  const derivedStatus = snapshot ? deriveStatus(snapshot, tick + serverOffsetMs) : "draft";
  const winner = snapshot?.winner;
  const isWinner = Boolean(winner && winner.guest_id === guestId);
  const canAnswer = joined && !submitted && !winner && derivedStatus === "open";
  const remainingMs = snapshot?.config.start_at_ms ? Math.max(0, snapshot.config.start_at_ms - (tick + serverOffsetMs)) : 0;

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) {
      setNotice("缺少抢答 token");
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    void getQuizSession(token)
      .then((nextSnapshot) => {
        if (active) setSnapshot(nextSnapshot);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "读取抢答活动失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!joined || !token || !guestName.trim()) return;

    let socket: Socket | null = connectQuizSocket();
    socketRef.current = socket;
    const join = () => {
      socket?.emit("quiz:guest:join", { room_token: token, guest_id: guestId, guest_name: guestName.trim() });
      socket?.emit("quiz:time:ping", { client_sent_at_ms: Date.now() });
    };
    const applySnapshot = (nextSnapshot: QuizSessionSnapshot) => {
      if (!nextSnapshot?.room_token) return;
      setSnapshot(nextSnapshot);
      if (!nextSnapshot.winner) {
        setSubmitted(false);
      }
    };
    const handlePong = (payload: { client_sent_at_ms?: number; server_now_ms?: number }) => {
      if (!payload?.client_sent_at_ms || !payload.server_now_ms) return;
      const receivedAt = Date.now();
      const roundTrip = receivedAt - payload.client_sent_at_ms;
      const estimatedServerNow = payload.server_now_ms + roundTrip / 2;
      setServerOffsetMs(estimatedServerNow - receivedAt);
    };
    const handleError = (payload: { message?: string }) => {
      setNotice(payload?.message || "抢答连接失败");
    };
    const handleRejected = (payload: { message?: string }) => {
      setNotice(payload?.message || "抢答失败");
      setSubmitted(false);
    };

    socket.on("connect", join);
    socket.on("quiz:snapshot", applySnapshot);
    socket.on("quiz:config_updated", applySnapshot);
    socket.on("quiz:winner", applySnapshot);
    socket.on("quiz:time:pong", handlePong);
    socket.on("quiz:error", handleError);
    socket.on("quiz:answer_rejected", handleRejected);
    if (socket.connected) join();
    const pingTimer = window.setInterval(() => {
      socket?.emit("quiz:time:ping", { client_sent_at_ms: Date.now() });
    }, 5000);

    return () => {
      window.clearInterval(pingTimer);
      socket?.disconnect();
      socket = null;
      socketRef.current = null;
    };
  }, [guestId, guestName, joined, token]);

  function handleJoin() {
    const name = guestName.trim();
    if (!name) {
      setNotice("请输入名称");
      return;
    }
    window.localStorage.setItem(GUEST_NAME_STORAGE_KEY, name);
    setNotice(null);
    setJoined(true);
  }

  function handleAnswer(answerIndex: number) {
    if (!canAnswer) return;
    setSubmitted(true);
    socketRef.current?.emit("quiz:guest:answer", {
      room_token: token,
      guest_id: guestId,
      guest_name: guestName.trim(),
      answer_index: answerIndex,
      client_clicked_at_ms: Date.now(),
    });
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <div style={centerMessageStyle}>读取抢答活动中...</div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <header style={headerStyle}>
          <span style={kickerStyle}>Quiz</span>
          <h1 style={titleStyle}>抢答</h1>
          <div style={statusStyle}>{statusText(snapshot, derivedStatus, remainingMs)}</div>
        </header>

        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        {!joined ? (
          <section style={joinPanelStyle}>
            <label style={fieldStyle}>
              <span style={labelStyle}>名称</span>
              <input
                type="text"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                style={inputStyle}
                maxLength={80}
                autoFocus
              />
            </label>
            <button type="button" onClick={handleJoin} style={primaryButtonStyle}>
              进入抢答
            </button>
          </section>
        ) : (
          <section style={quizPanelStyle}>
            <h2 style={questionStyle}>{snapshot?.config.question || "等待主持人配置题目"}</h2>

            {winner ? (
              <div style={resultStyle(isWinner, winner.is_correct)}>
                <div style={resultTitleStyle}>{isWinner ? "你抢到了" : "已被抢答"}</div>
                <div>{winner.guest_name}</div>
                <div>选择：{winner.answer_index}. {winner.answer_text}</div>
                {isWinner ? <div>{winner.is_correct ? "答对" : "答错"}</div> : null}
              </div>
            ) : null}

            <div style={answerGridStyle}>
              {(snapshot?.config.answers || []).filter((answer) => answer.enabled).map((answer) => (
                <button
                  key={answer.index}
                  type="button"
                  disabled={!canAnswer}
                  onClick={() => handleAnswer(answer.index)}
                  style={answerButtonStyle(canAnswer)}
                >
                  <span style={answerIndexStyle}>{answer.index}</span>
                  <span>{answer.text}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function getOrCreateGuestId() {
  const existing = window.localStorage.getItem(GUEST_ID_STORAGE_KEY);
  if (existing) return existing;
  const next = `guest_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(GUEST_ID_STORAGE_KEY, next);
  return next;
}

function deriveStatus(snapshot: QuizSessionSnapshot, estimatedServerNowMs: number) {
  if (snapshot.winner) return "answered";
  if (snapshot.status === "closed") return "closed";
  if (!snapshot.config.start_at_ms || !snapshot.config.question) return "draft";
  return estimatedServerNowMs >= snapshot.config.start_at_ms ? "open" : "waiting";
}

function statusText(snapshot: QuizSessionSnapshot | null, status: string, remainingMs: number) {
  if (!snapshot) return "未连接";
  if (status === "answered") return "已抢答";
  if (status === "closed") return "已关闭";
  if (status === "open") return "可以抢答";
  if (status === "waiting") return formatDuration(remainingMs);
  return "等待配置";
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

function formatDuration(ms: number) {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const milliseconds = Math.floor(total % 1000);
  return `${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--x-color-canvas)",
  color: "var(--x-color-ink)",
};

const shellStyle: CSSProperties = {
  width: "min(760px, calc(100% - 28px))",
  margin: "0 auto",
  padding: "22px 0 32px",
};

const headerStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  justifyItems: "center",
  textAlign: "center",
  marginBottom: "18px",
};

const kickerStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 900,
  textTransform: "uppercase",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "34px",
  lineHeight: 1.1,
};

const statusStyle: CSSProperties = {
  minHeight: "38px",
  display: "inline-flex",
  alignItems: "center",
  padding: "0 14px",
  borderRadius: "999px",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontFamily: "var(--x-font-mono)",
  fontWeight: 900,
};

const noticeStyle: CSSProperties = {
  marginBottom: "14px",
  padding: "12px 14px",
  borderRadius: "8px",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
};

const joinPanelStyle: CSSProperties = {
  display: "grid",
  gap: "14px",
  padding: "18px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const labelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const inputStyle: CSSProperties = {
  minHeight: "48px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  padding: "0 12px",
  fontSize: "18px",
};

const primaryButtonStyle: CSSProperties = {
  minHeight: "48px",
  border: "1px solid var(--x-color-accent)",
  borderRadius: "8px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "17px",
  fontWeight: 900,
  cursor: "pointer",
};

const quizPanelStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
};

const questionStyle: CSSProperties = {
  margin: 0,
  padding: "22px",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  fontSize: "34px",
  lineHeight: 1.1,
  overflowWrap: "anywhere",
};

const answerGridStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const answerButtonStyle = (active: boolean): CSSProperties => ({
  minHeight: "76px",
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "14px",
  borderRadius: "8px",
  border: active ? "2px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontSize: "20px",
  fontWeight: 900,
  cursor: active ? "pointer" : "not-allowed",
  opacity: active ? 1 : 0.62,
});

const answerIndexStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  background: "var(--x-color-ink)",
  color: "white",
  flex: "0 0 auto",
};

const resultStyle = (mine: boolean, correct: boolean): CSSProperties => ({
  display: "grid",
  gap: "8px",
  padding: "18px",
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: mine ? (correct ? "var(--x-color-success-soft)" : "var(--x-color-danger-soft)") : "var(--x-color-panel)",
  fontSize: "18px",
  fontWeight: 800,
});

const resultTitleStyle: CSSProperties = {
  fontSize: "28px",
  fontWeight: 900,
};

const centerMessageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};
