import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import type { Socket } from "socket.io-client";

import { useBaseNavbarVisibility } from "../../../router/AppChromeContext";
import { connectGameSocket } from "./gameSocket";
import { OPTION_COLORS, OPTION_SHAPES } from "./types";
import type { LeaderRow, MyResult, PlayerSnapshot, PublicQuestion, RevealData } from "./types";

const GUEST_ID_KEY = "xinya.quizgame.guestId";
const GUEST_NAME_KEY = "xinya.quizgame.guestName";

type Phase = "join" | "lobby" | "question" | "reveal" | "podium";

export function GamePlayerPage() {
  useBaseNavbarVisibility(false);

  const location = useLocation();
  const token = useMemo(
    () => new URLSearchParams(location.search).get("token")?.trim().toLowerCase() || "",
    [location.search],
  );

  const [guestId] = useState(getOrCreateGuestId);
  const [guestName, setGuestName] = useState(() => window.localStorage.getItem(GUEST_NAME_KEY) || "");
  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("join");
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [myChoice, setMyChoice] = useState<number | null>(null);
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const [myResult, setMyResult] = useState<MyResult | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(Date.now());

  const socketRef = useRef<Socket | null>(null);
  const choiceRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) setNotice("缺少游戏 token");
  }, [token]);

  useEffect(() => {
    if (!joined || !token || !guestName.trim()) return;
    let socket: Socket | null = connectGameSocket();
    socketRef.current = socket;

    const join = () => {
      socket?.emit("game:guest:join", { room_token: token, guest_id: guestId, guest_name: guestName.trim() });
      socket?.emit("game:time:ping", { client_sent_at_ms: Date.now() });
      setConnected(true);
    };
    const onSnapshot = (snap: PlayerSnapshot) => {
      if (!snap?.room_token) return;
      setLeaderboard(snap.leaderboard || []);
      if (snap.status === "question" && snap.question) {
        applyQuestion(snap.question, snap.my_choice ?? null);
      } else if (snap.status === "reveal" && snap.reveal) {
        setReveal(snap.reveal);
        setMyResult(snap.reveal.me);
        setPhase("reveal");
      } else if (snap.status === "podium") {
        setPhase("podium");
      } else {
        setPhase("lobby");
      }
    };
    const applyQuestion = (q: PublicQuestion, existingChoice: number | null) => {
      setQuestion(q);
      choiceRef.current = existingChoice;
      setMyChoice(existingChoice);
      setReveal(null);
      setMyResult(null);
      setPhase("question");
    };
    const onQuestion = (payload: { question: PublicQuestion }) => {
      if (payload?.question) applyQuestion(payload.question, null);
    };
    const onReveal = (payload: { reveal: RevealData; leaderboard: LeaderRow[] }) => {
      setReveal(payload.reveal);
      setLeaderboard(payload.leaderboard || []);
      setMyResult(deriveResult(payload, choiceRef.current, guestId));
      setPhase("reveal");
    };
    const onPodium = (payload: { leaderboard: LeaderRow[] }) => {
      setLeaderboard(payload.leaderboard || []);
      setPhase("podium");
    };
    const onLobby = () => {
      setPhase("lobby");
      setQuestion(null);
      setMyChoice(null);
      choiceRef.current = null;
    };
    const onAnswered = (payload: { choice: number }) => {
      choiceRef.current = payload.choice;
      setMyChoice(payload.choice);
    };
    const onRejected = (payload: { reason?: string; message?: string }) => {
      if (payload?.reason === "already_answered") return;
      setMyChoice(null);
      choiceRef.current = null;
      setNotice(payload?.message || "作答失败");
    };
    const onPong = (payload: { client_sent_at_ms?: number; server_now_ms?: number }) => {
      if (!payload?.client_sent_at_ms || !payload.server_now_ms) return;
      const receivedAt = Date.now();
      const roundTrip = receivedAt - payload.client_sent_at_ms;
      setServerOffsetMs(payload.server_now_ms + roundTrip / 2 - receivedAt);
    };

    socket.on("connect", join);
    socket.on("disconnect", () => setConnected(false));
    socket.on("game:player", onSnapshot);
    socket.on("game:question", onQuestion);
    socket.on("game:reveal", onReveal);
    socket.on("game:podium", onPodium);
    socket.on("game:lobby", onLobby);
    socket.on("game:answered", onAnswered);
    socket.on("game:answer_rejected", onRejected);
    socket.on("game:time:pong", onPong);
    socket.on("game:error", (p: { message?: string }) => setNotice(p?.message || "连接失败"));
    if (socket.connected) join();
    const pingTimer = window.setInterval(() => socket?.emit("game:time:ping", { client_sent_at_ms: Date.now() }), 5000);

    return () => {
      window.clearInterval(pingTimer);
      socket?.disconnect();
      socket = null;
      socketRef.current = null;
      setConnected(false);
    };
  }, [joined, token, guestName, guestId]);

  function handleJoin() {
    const name = guestName.trim();
    if (!name) {
      setNotice("请输入名字");
      return;
    }
    window.localStorage.setItem(GUEST_NAME_KEY, name);
    setNotice(null);
    setJoined(true);
  }

  function handleAnswer(choice: number) {
    if (phase !== "question" || myChoice !== null) return;
    choiceRef.current = choice;
    setMyChoice(choice);
    setNotice(null);
    if (navigator.vibrate) navigator.vibrate(40);
    socketRef.current?.emit("game:guest:answer", { room_token: token, guest_id: guestId, choice });
  }

  const estimatedNow = tick + serverOffsetMs;
  const remainingMs = question ? Math.max(0, question.endsAt - estimatedNow) : 0;
  const secondsLeft = Math.ceil(remainingMs / 1000);

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        {notice ? <div style={noticeStyle}>{notice}</div> : null}

        {phase === "join" ? (
          <section style={joinCardStyle}>
            <div style={joinTitleStyle}>输入名字加入</div>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="你的名字 Your name"
              maxLength={24}
              style={joinInputStyle}
              autoFocus
            />
            <button type="button" onClick={handleJoin} style={joinBtnStyle} disabled={!token}>
              加入游戏 🚀
            </button>
          </section>
        ) : null}

        {phase === "lobby" ? (
          <section style={centerCardStyle}>
            <div style={{ fontSize: "56px" }}>😀</div>
            <div style={bigTitleStyle}>你已加入！</div>
            <div style={mutedStyle}>{guestName}</div>
            <div style={mutedStyle}>看大屏幕，等待主持人开始…</div>
            <div style={connRow}>
              <span style={connDot(connected)} /> {connected ? "已连接" : "连接中…"}
            </div>
          </section>
        ) : null}

        {phase === "question" && question ? (
          <section style={questionWrapStyle}>
            <div style={qTopStyle}>
              <span style={qNumStyle}>
                {question.index + 1}/{question.total}
              </span>
              <div style={timerTrackStyle}>
                <div style={{ ...timerBarStyle, width: `${(remainingMs / (question.time * 1000)) * 100}%` }} />
              </div>
              <span style={qSecStyle}>{secondsLeft}</span>
            </div>
            <div style={qTextCardStyle}>
              <div style={qZhStyle}>{question.zh}</div>
              {question.en ? <div style={qEnStyle}>{question.en}</div> : null}
            </div>
            <div style={optionsGridStyle}>
              {question.options.map((opt, i) => {
                const locked = myChoice !== null;
                const mine = myChoice === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleAnswer(i)}
                    disabled={locked}
                    style={optionBtnStyle(i, locked, mine)}
                  >
                    <span style={optShapeStyle}>{OPTION_SHAPES[i]}</span>
                    <span style={optZhStyle}>{opt.zh}</span>
                    {opt.en ? <span style={optEnStyle}>{opt.en}</span> : null}
                  </button>
                );
              })}
            </div>
            {myChoice !== null ? <div style={submittedStyle}>✅ 已提交，等待其他人…</div> : null}
          </section>
        ) : null}

        {phase === "reveal" ? (
          <section style={centerCardStyle}>
            <div style={{ fontSize: "72px" }}>
              {!myResult?.answered ? "⏰" : myResult.correct ? "🎉" : "😢"}
            </div>
            <div style={bigTitleStyle}>
              {!myResult?.answered ? "没作答" : myResult.correct ? "答对了！" : "答错了"}
            </div>
            <div style={gainStyle}>+{myResult?.gain ?? 0}</div>
            {myResult && myResult.streak >= 2 ? <div style={streakStyle}>🔥 连对 {myResult.streak} 题！</div> : null}
            <div style={rankLineStyle}>
              当前排名 #{myResult?.rank ?? "-"} · 总分 {myResult?.score ?? 0}
            </div>
            <div style={mutedStyle}>等待下一题…</div>
          </section>
        ) : null}

        {phase === "podium" ? (
          <section style={centerCardStyle}>
            <div style={mutedStyle}>最终成绩 Final</div>
            <PodiumSelf leaderboard={leaderboard} guestId={guestId} />
            <ol style={boardListStyle}>
              {leaderboard.slice(0, 20).map((row) => (
                <li key={row.id} style={boardRowStyle(row.rank, row.id === guestId)}>
                  <span style={rankBadge(row.rank)}>{medal(row.rank)}</span>
                  <span style={rowNameStyle}>
                    {row.name}
                    {row.id === guestId ? " (你)" : ""}
                  </span>
                  <span style={rowScoreStyle}>{row.score}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function PodiumSelf({ leaderboard, guestId }: { leaderboard: LeaderRow[]; guestId: string }) {
  const mine = leaderboard.find((r) => r.id === guestId);
  return (
    <>
      <div style={{ fontSize: "64px", fontWeight: 900, color: "var(--x-color-accent)" }}>
        {mine ? `#${mine.rank}` : "🏁"}
      </div>
      {mine ? <div style={mutedStyle}>{mine.score} 分</div> : null}
    </>
  );
}

/* helpers */

function getOrCreateGuestId() {
  const existing = window.localStorage.getItem(GUEST_ID_KEY);
  if (existing) return existing;
  const next = `g_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(GUEST_ID_KEY, next);
  return next;
}

function deriveResult(
  payload: { reveal: RevealData; leaderboard: LeaderRow[] },
  choice: number | null,
  guestId: string,
): MyResult {
  const row = payload.leaderboard.find((r) => r.id === guestId);
  return {
    answered: choice !== null,
    choice,
    correct: choice !== null && choice === payload.reveal.correct,
    gain: row?.lastGain ?? 0,
    score: row?.score ?? 0,
    rank: row?.rank ?? null,
    streak: row?.streak ?? 0,
  };
}

function medal(rank: number) {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
}

/* styles */

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--x-color-canvas)", color: "var(--x-color-ink)" };
const shellStyle: CSSProperties = {
  width: "min(560px, calc(100% - 24px))",
  margin: "0 auto",
  padding: "18px 0 40px",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};
const noticeStyle: CSSProperties = {
  marginBottom: "12px",
  padding: "10px 14px",
  borderRadius: "8px",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
  textAlign: "center",
};
const joinCardStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
  padding: "28px 24px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "14px",
  background: "var(--x-color-panel)",
  boxShadow: "0 8px 24px var(--x-color-shadow-soft)",
};
const joinTitleStyle: CSSProperties = { textAlign: "center", fontSize: "20px", fontWeight: 900 };
const joinInputStyle: CSSProperties = {
  minHeight: "54px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "10px",
  padding: "0 16px",
  fontSize: "20px",
  textAlign: "center",
};
const joinBtnStyle: CSSProperties = {
  minHeight: "54px",
  border: "none",
  borderRadius: "10px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "20px",
  fontWeight: 900,
  cursor: "pointer",
};
const centerCardStyle: CSSProperties = { display: "grid", gap: "10px", justifyItems: "center", textAlign: "center" };
const bigTitleStyle: CSSProperties = { fontSize: "30px", fontWeight: 900 };
const mutedStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontWeight: 700 };
const connRow: CSSProperties = { marginTop: "8px", display: "inline-flex", alignItems: "center", gap: "8px", color: "var(--x-color-ink-muted)", fontWeight: 700 };
const connDot = (on: boolean): CSSProperties => ({ width: "10px", height: "10px", borderRadius: "999px", background: on ? "var(--x-color-success)" : "var(--x-color-danger)" });
const gainStyle: CSSProperties = { fontSize: "28px", fontWeight: 900, color: "var(--x-color-accent)" };
const streakStyle: CSSProperties = { fontWeight: 800, color: "#d89e00" };
const rankLineStyle: CSSProperties = {
  marginTop: "6px",
  padding: "8px 20px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  fontWeight: 800,
};

const questionWrapStyle: CSSProperties = { display: "grid", gap: "12px" };
const qTopStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px" };
const qNumStyle: CSSProperties = { fontWeight: 900, background: "var(--x-color-panel-alt)", padding: "5px 12px", borderRadius: "999px", whiteSpace: "nowrap" };
const timerTrackStyle: CSSProperties = { flex: 1, height: "12px", background: "var(--x-color-panel-alt)", borderRadius: "999px", overflow: "hidden" };
const timerBarStyle: CSSProperties = { height: "100%", background: "linear-gradient(90deg,#2bd66b,#ffd23f,#ff5a5a)", transition: "width 0.2s linear" };
const qSecStyle: CSSProperties = { fontWeight: 900, fontSize: "18px", minWidth: "28px", textAlign: "center" };
const qTextCardStyle: CSSProperties = { padding: "14px 16px", borderRadius: "14px", background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)" };
const qZhStyle: CSSProperties = { fontSize: "clamp(16px,4.4vw,21px)", fontWeight: 800, lineHeight: 1.45 };
const qEnStyle: CSSProperties = { fontSize: "clamp(11px,3vw,14px)", opacity: 0.7, marginTop: "4px" };
const optionsGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" };
const optionBtnStyle = (i: number, locked: boolean, mine: boolean): CSSProperties => ({
  border: "none",
  borderRadius: "14px",
  padding: "14px",
  minHeight: "84px",
  color: "white",
  background: OPTION_COLORS[i % OPTION_COLORS.length],
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "4px",
  textAlign: "left",
  cursor: locked ? "default" : "pointer",
  opacity: locked && !mine ? 0.35 : 1,
  filter: locked && !mine ? "grayscale(0.6)" : "none",
  outline: mine ? "3px solid var(--x-color-ink)" : "none",
  boxShadow: "0 5px 0 rgba(0,0,0,0.25)",
  transition: "opacity 0.2s, filter 0.2s",
});
const optShapeStyle: CSSProperties = { fontSize: "18px", fontWeight: 900 };
const optZhStyle: CSSProperties = { fontSize: "clamp(14px,3.8vw,17px)", fontWeight: 700, lineHeight: 1.3 };
const optEnStyle: CSSProperties = { fontSize: "clamp(10px,2.8vw,12px)", opacity: 0.85 };
const submittedStyle: CSSProperties = { textAlign: "center", fontWeight: 900, fontSize: "18px", color: "var(--x-color-success)" };

const boardListStyle: CSSProperties = { listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: "8px", width: "100%" };
const boardRowStyle = (rank: number, mine: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "10px 14px",
  borderRadius: "12px",
  border: mine ? "2px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: mine ? "var(--x-color-accent-soft)" : "var(--x-color-panel-alt)",
});
const rankBadge = (rank: number): CSSProperties => ({
  minWidth: "34px",
  textAlign: "center",
  fontWeight: 900,
  fontSize: rank <= 3 ? "20px" : "15px",
  color: rank <= 3 ? undefined : "var(--x-color-ink-muted)",
});
const rowNameStyle: CSSProperties = { flex: "1 1 auto", fontSize: "16px", fontWeight: 800, overflowWrap: "anywhere" };
const rowScoreStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontWeight: 900, color: "var(--x-color-accent)" };
