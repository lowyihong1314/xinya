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
  const [connected, setConnected] = useState(false);
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
      setConnected(true);
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
    const handleDisconnect = () => {
      setConnected(false);
    };

    socket.on("connect", join);
    socket.on("disconnect", handleDisconnect);
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
      setConnected(false);
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
        <div style={centerMsgStyle}>读取抢答活动中...</div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        {/* ── header ── */}
        <header style={headerStyle}>
          <span style={kickerStyle}>Quiz</span>
          <h1 style={h1Style}>抢答</h1>
        </header>

        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        {!joined ? (
          /* ── join form ── */
          <section style={joinCardStyle}>
            <div style={joinTitleStyle}>输入名称加入抢答</div>
            <label style={fieldStyle}>
              <span style={labelStyle}>名称</span>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                style={joinInputStyle}
                maxLength={80}
                autoFocus
              />
            </label>
            <button type="button" onClick={handleJoin} style={joinBtnStyle}>
              进入抢答
            </button>
          </section>
        ) : (
          /* ── quiz view ── */
          <section style={quizStyle}>
            {/* connection + status */}
            <div style={statusBarStyle}>
              <span style={connDotStyle(connected)} />
              <span style={statusChipStyle(derivedStatus)}>
                {statusText(snapshot, derivedStatus, remainingMs)}
              </span>
            </div>

            {/* countdown */}
            {derivedStatus === "waiting" && snapshot?.config.start_at_ms ? (
              <div style={countdownStyle}>{formatDuration(remainingMs)}</div>
            ) : null}

            {/* question */}
            <div style={questionCardStyle}>
              <h2 style={questionTextStyle}>{snapshot?.config.question || "等待主持人配置题目"}</h2>
            </div>

            {/* winner banner */}
            {winner ? (
              <div style={winnerBannerStyle(isWinner, winner.is_correct)}>
                <div style={winnerRowStyle}>
                  <i className="fas fa-trophy" aria-hidden="true" style={trophyStyle} />
                  <span style={winnerNameStyle}>
                    {isWinner ? "你抢到了！" : winner.guest_name}
                  </span>
                  <span style={winnerBadgeStyle(winner.is_correct)}>
                    {winner.is_correct ? "答对" : "答错"}
                  </span>
                </div>
                <div style={winnerInfoStyle}>
                  <span>选择: {winner.answer_index}. {winner.answer_text}</span>
                  {!winner.is_correct ? (
                    <span style={correctHintStyle}>
                      正确答案: {winner.correct_answer_index}. {winner.correct_answer_text}
                    </span>
                  ) : null}
                  <span style={deltaStyle}>+{winner.delta_from_start_ms}ms</span>
                </div>
              </div>
            ) : null}

            {/* submitted hint */}
            {submitted && !winner ? (
              <div style={submittedHintStyle}>
                <i className="fas fa-spinner fa-spin" aria-hidden="true" />
                <span>已提交，等待结果...</span>
              </div>
            ) : null}

            {/* answer grid */}
            <div style={answerGridStyle}>
              {(snapshot?.config.answers || [])
                .filter((a) => a.enabled)
                .map((answer) => {
                  const isCorrectAnswer = winner ? answer.index === winner.correct_answer_index : false;
                  const isWinnerPick = winner ? answer.index === winner.answer_index : false;
                  return (
                    <button
                      key={answer.index}
                      type="button"
                      disabled={!canAnswer}
                      onClick={() => handleAnswer(answer.index)}
                      style={answerBtnStyle(canAnswer, isCorrectAnswer, isWinnerPick)}
                    >
                      <span style={answerNumStyle(isCorrectAnswer)}>{answer.index}</span>
                      <span style={answerTxtStyle}>{answer.text}</span>
                      {isCorrectAnswer ? (
                        <i className="fas fa-check" aria-hidden="true" style={answerCheckStyle} />
                      ) : null}
                    </button>
                  );
                })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/* ═══════════════ helpers ═══════════════ */

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
  if (status === "open") return "可以抢答！";
  if (status === "waiting") return `倒计时 ${formatDuration(remainingMs)}`;
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

/* ═══════════════ styles ═══════════════ */

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--x-color-canvas)",
  color: "var(--x-color-ink)",
};

const shellStyle: CSSProperties = {
  width: "min(680px, calc(100% - 28px))",
  margin: "0 auto",
  padding: "22px 0 40px",
};

const headerStyle: CSSProperties = {
  textAlign: "center",
  marginBottom: "20px",
};

const kickerStyle: CSSProperties = {
  display: "block",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 900,
  textTransform: "uppercase",
};

const h1Style: CSSProperties = {
  margin: 0,
  fontSize: "32px",
  lineHeight: 1.1,
};

const noticeStyle: CSSProperties = {
  marginBottom: "14px",
  padding: "12px 14px",
  borderRadius: "8px",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
};

const centerMsgStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

/* ── join ── */

const joinCardStyle: CSSProperties = {
  maxWidth: "420px",
  margin: "0 auto",
  padding: "28px 24px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "12px",
  background: "var(--x-color-panel)",
  boxShadow: "0 8px 24px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "18px",
};

const joinTitleStyle: CSSProperties = {
  textAlign: "center",
  fontSize: "18px",
  fontWeight: 900,
};

const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };

const labelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const joinInputStyle: CSSProperties = {
  minHeight: "52px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  padding: "0 14px",
  fontSize: "20px",
};

const joinBtnStyle: CSSProperties = {
  minHeight: "52px",
  border: "1px solid var(--x-color-accent)",
  borderRadius: "8px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "18px",
  fontWeight: 900,
  cursor: "pointer",
};

/* ── quiz view ── */

const quizStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

const statusBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
};

const connDotStyle = (connected: boolean): CSSProperties => ({
  width: "10px",
  height: "10px",
  borderRadius: "999px",
  background: connected ? "var(--x-color-success)" : "var(--x-color-danger)",
  flex: "0 0 auto",
});

const statusChipStyle = (status: string): CSSProperties => ({
  padding: "8px 18px",
  borderRadius: "999px",
  fontWeight: 900,
  fontSize: "15px",
  fontFamily: status === "waiting" ? "var(--x-font-mono)" : undefined,
  ...(status === "open"
    ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
    : status === "answered"
      ? { background: "var(--x-color-warning-soft)", color: "var(--x-color-warning)" }
      : status === "closed"
        ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
        : { background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)" }),
});

const countdownStyle: CSSProperties = {
  textAlign: "center",
  fontFamily: "var(--x-font-mono)",
  fontSize: "52px",
  fontWeight: 900,
  color: "var(--x-color-accent)",
};

const questionCardStyle: CSSProperties = {
  padding: "26px 22px",
  borderRadius: "12px",
  background: "linear-gradient(135deg, var(--x-color-panel), var(--x-color-panel-alt))",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 6px 18px var(--x-color-shadow-soft)",
};

const questionTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "28px",
  lineHeight: 1.2,
  textAlign: "center",
  overflowWrap: "anywhere",
};

/* ── winner banner ── */

const winnerBannerStyle = (isMine: boolean, correct: boolean): CSSProperties => ({
  padding: "20px 22px",
  borderRadius: "12px",
  border: `2px solid ${correct ? "rgba(21,128,61,0.3)" : "rgba(194,65,12,0.3)"}`,
  background: isMine
    ? correct
      ? "linear-gradient(135deg, var(--x-color-success-soft), rgba(21,128,61,0.06))"
      : "linear-gradient(135deg, var(--x-color-danger-soft), rgba(194,65,12,0.06))"
    : "var(--x-color-panel)",
  boxShadow: "0 6px 20px var(--x-color-shadow-soft)",
  display: "grid",
  gap: "10px",
});

const winnerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
};

const trophyStyle: CSSProperties = {
  fontSize: "24px",
  color: "#d97706",
};

const winnerNameStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 900,
};

const winnerBadgeStyle = (correct: boolean): CSSProperties => ({
  padding: "3px 10px",
  borderRadius: "999px",
  fontWeight: 900,
  fontSize: "13px",
  background: correct ? "var(--x-color-success)" : "var(--x-color-danger)",
  color: "white",
});

const winnerInfoStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  flexWrap: "wrap",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
};

const correctHintStyle: CSSProperties = {
  color: "var(--x-color-success)",
  fontWeight: 900,
};

const deltaStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  fontWeight: 900,
  color: "var(--x-color-accent)",
};

const submittedHintStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  padding: "14px",
  borderRadius: "8px",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 800,
};

/* ── answer grid ── */

const answerGridStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const answerBtnStyle = (active: boolean, correct: boolean, picked: boolean): CSSProperties => {
  const base: CSSProperties = {
    minHeight: "72px",
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "12px 18px",
    borderRadius: "12px",
    fontSize: "18px",
    fontWeight: 900,
    color: "var(--x-color-ink)",
    cursor: active ? "pointer" : "default",
    transition: "transform 0.1s, box-shadow 0.1s",
  };
  if (correct) {
    return {
      ...base,
      border: "2px solid var(--x-color-success)",
      background: "linear-gradient(135deg, var(--x-color-success-soft), rgba(21,128,61,0.08))",
      boxShadow: "0 4px 14px rgba(21,128,61,0.12)",
    };
  }
  if (picked) {
    return {
      ...base,
      border: "2px solid var(--x-color-warning)",
      background: "var(--x-color-warning-soft)",
    };
  }
  if (active) {
    return {
      ...base,
      border: "2px solid var(--x-color-accent)",
      background: "var(--x-color-accent-soft)",
      boxShadow: "0 4px 12px var(--x-color-shadow-soft)",
    };
  }
  return {
    ...base,
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel-alt)",
    opacity: 0.6,
  };
};

const answerNumStyle = (correct: boolean): CSSProperties => ({
  width: "38px",
  height: "38px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  fontWeight: 900,
  fontSize: "15px",
  background: correct ? "var(--x-color-success)" : "var(--x-color-ink)",
  color: "white",
});

const answerTxtStyle: CSSProperties = {
  flex: "1 1 auto",
};

const answerCheckStyle: CSSProperties = {
  color: "var(--x-color-success)",
  fontSize: "18px",
  flex: "0 0 auto",
};
