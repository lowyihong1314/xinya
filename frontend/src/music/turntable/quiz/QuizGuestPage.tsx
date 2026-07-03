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
  const token = useMemo(
    () => new URLSearchParams(location.search).get("token")?.trim().toLowerCase() || "",
    [location.search],
  );
  const [guestId] = useState(() => getOrCreateGuestId());
  const [guestName, setGuestName] = useState(() => window.localStorage.getItem(GUEST_NAME_STORAGE_KEY) || "");
  const [joined, setJoined] = useState(false);
  const [snapshot, setSnapshot] = useState<QuizSessionSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [pendingTap, setPendingTap] = useState(false);
  const [connected, setConnected] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);

  const estimatedNow = tick + serverOffsetMs;
  const status = snapshot?.status || "draft";
  const cutoff = snapshot?.cutoff_at_ms || 0;
  const remainingMs = cutoff ? cutoff - estimatedNow : Number.POSITIVE_INFINITY;
  const reachedCutoff = Boolean(cutoff) && remainingMs <= 0;
  const isOpen = status === "open" || (status === "waiting" && reachedCutoff);

  const leaderboard = snapshot?.leaderboard || [];
  const myEntry = useMemo(() => leaderboard.find((row) => row.guest_id === guestId) || null, [leaderboard, guestId]);
  const hasTapped = Boolean(myEntry) || pendingTap;
  const canTap = joined && isOpen && !hasTapped;

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 60);
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
      .then((next) => {
        if (active) setSnapshot(next);
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
    const applySnapshot = (next: QuizSessionSnapshot) => {
      if (!next?.room_token) return;
      setSnapshot(next);
      // New round (host re-published or returned to publish page) → allow tapping again.
      if (next.status === "draft" || next.status === "waiting") {
        setPendingTap(false);
      }
    };
    const handlePong = (payload: { client_sent_at_ms?: number; server_now_ms?: number }) => {
      if (!payload?.client_sent_at_ms || !payload.server_now_ms) return;
      const receivedAt = Date.now();
      const roundTrip = receivedAt - payload.client_sent_at_ms;
      setServerOffsetMs(payload.server_now_ms + roundTrip / 2 - receivedAt);
    };
    const handleRejected = (payload: { reason?: string; message?: string }) => {
      // Too-early / duplicate — surface briefly and re-enable if it was a mis-timed tap.
      if (payload?.reason === "too_early" || payload?.reason === "not_published") {
        setPendingTap(false);
        setNotice("还没开放，别急！");
      } else if (payload?.reason === "already_tapped") {
        setNotice(null);
      } else {
        setPendingTap(false);
        setNotice(payload?.message || "抢答失败");
      }
    };

    socket.on("connect", join);
    socket.on("disconnect", () => setConnected(false));
    socket.on("quiz:snapshot", applySnapshot);
    socket.on("quiz:config_updated", applySnapshot);
    socket.on("quiz:leaderboard", applySnapshot);
    socket.on("quiz:time:pong", handlePong);
    socket.on("quiz:error", (p: { message?: string }) => setNotice(p?.message || "抢答连接失败"));
    socket.on("quiz:tap_rejected", handleRejected);
    if (socket.connected) join();
    const pingTimer = window.setInterval(() => socket?.emit("quiz:time:ping", { client_sent_at_ms: Date.now() }), 4000);

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

  function handleTap() {
    if (!canTap) return;
    setPendingTap(true);
    setNotice(null);
    socketRef.current?.emit("quiz:guest:tap", {
      room_token: token,
      guest_id: guestId,
      guest_name: guestName.trim(),
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

  // 3-2-1-点 countdown value for the last seconds before cutoff.
  const secondsLeft = Number.isFinite(remainingMs) ? Math.ceil(remainingMs / 1000) : null;
  let countChip: string | null = null;
  if (status === "waiting" && secondsLeft !== null) {
    if (secondsLeft <= 0) countChip = "点!";
    else if (secondsLeft === 1) countChip = "1";
    else if (secondsLeft === 2) countChip = "2";
    else if (secondsLeft === 3) countChip = "3";
    else if (secondsLeft === 4) countChip = "准备";
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
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
          /* ── buzzer view ── */
          <section style={buzzerStyle}>
            <div style={statusBarStyle}>
              <span style={connDotStyle(connected)} />
              <span style={statusChipStyle(status, isOpen)}>{guestStatusText(status, isOpen, hasTapped)}</span>
            </div>

            {/* my result */}
            {myEntry ? (
              <div style={myResultStyle}>
                <span style={myRankLabelStyle}>你的名次</span>
                <span style={myRankNumStyle}>第 {myEntry.rank} 名</span>
                <span style={myDeltaStyle}>+{myEntry.delta_from_cutoff_ms}ms</span>
              </div>
            ) : null}

            {/* the big button */}
            <button
              type="button"
              disabled={!canTap}
              onClick={handleTap}
              style={buzzerBtnStyle(isOpen, canTap, hasTapped)}
            >
              {countChip ? <span style={countChipStyle}>{countChip}</span> : null}
              <span style={buzzerLabelStyle}>
                {hasTapped ? "已抢!" : isOpen ? "点!" : status === "closed" ? "已结束" : status === "draft" ? "等待发布" : "准备…"}
              </span>
            </button>

            {/* leaderboard */}
            {leaderboard.length > 0 ? (
              <div style={boardCardStyle}>
                <div style={boardHeaderStyle}>
                  <i className="fas fa-ranking-star" aria-hidden="true" style={{ color: "var(--x-color-accent)" }} />
                  <span style={boardTitleStyle}>排行榜</span>
                  <span style={boardCountStyle}>{leaderboard.length} 人</span>
                </div>
                <ol style={boardListStyle}>
                  {leaderboard.slice(0, 20).map((row) => {
                    const mine = row.guest_id === guestId;
                    return (
                      <li key={row.guest_id} style={boardRowStyle(row.rank, mine)}>
                        <span style={rankBadgeStyle(row.rank)}>{row.rank}</span>
                        <span style={rowNameStyle}>
                          {row.guest_name}
                          {mine ? " (你)" : ""}
                        </span>
                        <span style={rowDeltaStyle}>+{row.delta_from_cutoff_ms}ms</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
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

function guestStatusText(status: string, isOpen: boolean, hasTapped: boolean) {
  if (status === "closed") return "已结束";
  if (hasTapped) return "已抢答";
  if (isOpen) return "快点！";
  if (status === "waiting") return "准备…";
  return "等待主持人发布";
}

/* ═══════════════ styles ═══════════════ */

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--x-color-canvas)",
  color: "var(--x-color-ink)",
};

const shellStyle: CSSProperties = {
  width: "min(560px, calc(100% - 24px))",
  margin: "0 auto",
  padding: "20px 0 40px",
};

const headerStyle: CSSProperties = { textAlign: "center", marginBottom: "16px" };

const kickerStyle: CSSProperties = {
  display: "block",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 900,
  textTransform: "uppercase",
};

const h1Style: CSSProperties = { margin: 0, fontSize: "30px", lineHeight: 1.1 };

const noticeStyle: CSSProperties = {
  marginBottom: "14px",
  padding: "12px 14px",
  borderRadius: "8px",
  background: "var(--x-color-warning-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
  textAlign: "center",
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

const joinTitleStyle: CSSProperties = { textAlign: "center", fontSize: "18px", fontWeight: 900 };

const fieldStyle: CSSProperties = { display: "grid", gap: "8px" };

const labelStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontWeight: 800 };

const joinInputStyle: CSSProperties = {
  minHeight: "52px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  padding: "0 14px",
  fontSize: "20px",
};

const joinBtnStyle: CSSProperties = {
  minHeight: "52px",
  border: "none",
  borderRadius: "8px",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "18px",
  fontWeight: 900,
  cursor: "pointer",
};

/* ── buzzer ── */

const buzzerStyle: CSSProperties = { display: "grid", gap: "18px", justifyItems: "center" };

const statusBarStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" };

const connDotStyle = (connected: boolean): CSSProperties => ({
  width: "10px",
  height: "10px",
  borderRadius: "999px",
  background: connected ? "var(--x-color-success)" : "var(--x-color-danger)",
  flex: "0 0 auto",
});

const statusChipStyle = (status: string, isOpen: boolean): CSSProperties => ({
  padding: "8px 18px",
  borderRadius: "999px",
  fontWeight: 900,
  fontSize: "15px",
  ...(isOpen
    ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
    : status === "closed"
      ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
      : { background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)" }),
});

const myResultStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "16px",
  padding: "16px 20px",
  borderRadius: "14px",
  border: "2px solid var(--x-color-accent)",
  background: "var(--x-color-accent-soft)",
};

const myRankLabelStyle: CSSProperties = { fontWeight: 800, color: "var(--x-color-ink-muted)" };

const myRankNumStyle: CSSProperties = { fontSize: "28px", fontWeight: 900, color: "var(--x-color-accent-strong)" };

const myDeltaStyle: CSSProperties = { fontFamily: "var(--x-font-mono)", fontWeight: 900, color: "var(--x-color-accent)" };

const buzzerBtnStyle = (isOpen: boolean, canTap: boolean, hasTapped: boolean): CSSProperties => {
  const green = isOpen && !hasTapped;
  const background = hasTapped
    ? "linear-gradient(135deg, #16a34a, #15803d)"
    : green
      ? "linear-gradient(135deg, #22c55e, #16a34a)"
      : "linear-gradient(135deg, #ef4444, #dc2626)";
  return {
    position: "relative",
    width: "min(320px, 78vw)",
    height: "min(320px, 78vw)",
    borderRadius: "999px",
    border: "none",
    background,
    color: "white",
    fontWeight: 900,
    cursor: canTap ? "pointer" : "default",
    boxShadow: green ? "0 0 0 8px rgba(34,197,94,0.25), 0 18px 40px rgba(22,163,74,0.35)" : "0 14px 34px rgba(220,38,38,0.3)",
    transition: "background 0.12s, box-shadow 0.12s, transform 0.06s",
    transform: canTap ? "scale(1)" : "scale(0.98)",
    display: "grid",
    placeItems: "center",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  };
};

const countChipStyle: CSSProperties = {
  position: "absolute",
  top: "-14px",
  left: "50%",
  transform: "translateX(-50%)",
  minWidth: "64px",
  padding: "6px 18px",
  borderRadius: "999px",
  background: "var(--x-color-ink)",
  color: "white",
  fontSize: "30px",
  fontWeight: 900,
  boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
};

const buzzerLabelStyle: CSSProperties = { fontSize: "56px", lineHeight: 1, textShadow: "0 2px 6px rgba(0,0,0,0.25)" };

/* ── leaderboard ── */

const boardCardStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--x-color-line)",
  borderRadius: "14px",
  background: "var(--x-color-panel)",
  padding: "16px",
  display: "grid",
  gap: "10px",
};

const boardHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px" };

const boardTitleStyle: CSSProperties = { fontSize: "16px", fontWeight: 900 };

const boardCountStyle: CSSProperties = { marginLeft: "auto", color: "var(--x-color-ink-muted)", fontWeight: 800 };

const boardListStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" };

const boardRowStyle = (rank: number, mine: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "10px 14px",
  borderRadius: "12px",
  border: mine ? "2px solid var(--x-color-accent)" : rank <= 3 ? "1px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: mine ? "var(--x-color-accent-soft)" : rank <= 3 ? "var(--x-color-panel-alt)" : "var(--x-color-panel-alt)",
});

const rankBadgeStyle = (rank: number): CSSProperties => ({
  width: "32px",
  height: "32px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  fontWeight: 900,
  fontSize: "15px",
  background: rank === 1 ? "#f59e0b" : rank === 2 ? "#9ca3af" : rank === 3 ? "#b45309" : "var(--x-color-ink)",
  color: "white",
});

const rowNameStyle: CSSProperties = { flex: "1 1 auto", fontSize: "16px", fontWeight: 800, overflowWrap: "anywhere" };

const rowDeltaStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  flex: "0 0 auto",
};
