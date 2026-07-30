import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import type { Socket } from "socket.io-client";

import { useUserState } from "../../../app/UserState";
import { createGameSession, listSets } from "./api";
import { buildGamePlayerUrl, connectGameSocket } from "./gameSocket";
import { QuestionEditorPage } from "./QuestionEditorPage";
import { OPTION_COLORS, OPTION_SHAPES } from "./types";
import type { HostSnapshot, LeaderRow, PlayerRow, PublicQuestion, QuizGameSet, RevealData } from "./types";

type Mode =
  | { name: "setup" }
  | { name: "editor"; setId: number | null }
  | { name: "live"; token: string; title: string };

export function GameHostPage({ onBack }: { onBack: () => void }) {
  const { isAuthenticated } = useUserState();
  const [mode, setMode] = useState<Mode>({ name: "setup" });
  const [sets, setSets] = useState<QuizGameSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<number | null>(null);

  async function reloadSets() {
    setLoading(true);
    setError(null);
    try {
      setSets(await listSets());
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取题库失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    void reloadSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  async function handleStart(set: QuizGameSet) {
    setStarting(set.id);
    setError(null);
    try {
      const { token } = await createGameSession(set.id);
      setMode({ name: "live", token, title: set.title });
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建游戏失败");
    } finally {
      setStarting(null);
    }
  }

  if (mode.name === "editor") {
    return (
      <QuestionEditorPage
        setId={mode.setId}
        onClose={() => setMode({ name: "setup" })}
        onSaved={() => {
          void reloadSets();
          setMode({ name: "setup" });
        }}
      />
    );
  }

  if (mode.name === "live") {
    return <GameLiveHost token={mode.token} title={mode.title} onExit={() => { void reloadSets(); setMode({ name: "setup" }); }} />;
  }

  // ── setup ──
  return (
    <main style={pageStyle}>
      <div style={setupShellStyle}>
        <header style={topBarStyle}>
          <button type="button" onClick={onBack} style={ghostBtnStyle}>
            <i className="fas fa-arrow-left" aria-hidden="true" /> 返回
          </button>
          <div style={{ textAlign: "center" }}>
            <span style={kickerStyle}>Quiz Game</span>
            <h1 style={h1Style}>问答游戏</h1>
          </div>
          <div style={{ width: "88px" }} />
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        {!isAuthenticated ? (
          <div style={infoCardStyle}>请先登录（组织者）才能主持问答游戏。</div>
        ) : loading ? (
          <div style={infoCardStyle}>读取题库中…</div>
        ) : (
          <>
            <div style={sectionLabelStyle}>选择题库开场</div>
            <div style={setGridStyle}>
              {sets.map((set) => (
                <div key={set.id} style={setCardStyle}>
                  <div style={setTitleStyle}>{set.title}</div>
                  {set.description ? <div style={setDescStyle}>{set.description}</div> : null}
                  <div style={setMetaStyle}>
                    <span><i className="fas fa-layer-group" aria-hidden="true" /> {set.question_count} 题</span>
                    <span><i className="fas fa-clock" aria-hidden="true" /> {set.question_time}s/题</span>
                  </div>
                  <div style={setActionsStyle}>
                    <button
                      type="button"
                      onClick={() => void handleStart(set)}
                      disabled={starting !== null || set.question_count === 0}
                      style={startBtnStyle}
                    >
                      <i className="fas fa-play" aria-hidden="true" /> {starting === set.id ? "创建中…" : "开始"}
                    </button>
                    <button type="button" onClick={() => setMode({ name: "editor", setId: set.id })} style={editBtnStyle}>
                      <i className="fas fa-pen" aria-hidden="true" /> 编辑
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setMode({ name: "editor", setId: null })} style={newSetBtnStyle}>
              <i className="fas fa-plus" aria-hidden="true" /> 新建题库
            </button>
          </>
        )}
      </div>
    </main>
  );
}

/* ═══════════════════ live big screen ═══════════════════ */

function GameLiveHost({ token, title, onExit }: { token: string; title: string; onExit: () => void }) {
  const [status, setStatus] = useState<string>("lobby");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [question, setQuestion] = useState<PublicQuestion | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);
  const autoRevealedRef = useRef<number | null>(null);

  const guestUrl = useMemo(() => buildGamePlayerUrl(token), [token]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!guestUrl) return;
    let active = true;
    void QRCode.toDataURL(guestUrl, { width: 320, margin: 1, color: { dark: "#111827", light: "#ffffff" } }).then((url) => {
      if (active) setQrDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, [guestUrl]);

  useEffect(() => {
    let socket: Socket | null = connectGameSocket();
    socketRef.current = socket;

    const join = () => {
      socket?.emit("game:host:join", { room_token: token });
      socket?.emit("game:time:ping", { client_sent_at_ms: Date.now() });
    };
    const applyHost = (snap: HostSnapshot) => {
      if (!snap?.room_token) return;
      setStatus(snap.status);
      setPlayers(snap.players || []);
      setPlayerCount(snap.player_count || 0);
      setQuestion(snap.question);
      setAnsweredCount(snap.answered_count || 0);
      setReveal(snap.reveal);
      if (snap.leaderboard) setLeaderboard(snap.leaderboard);
    };
    const onQuestion = (p: { question: PublicQuestion; player_count?: number }) => {
      setStatus("question");
      setQuestion(p.question);
      setAnsweredCount(0);
      setReveal(null);
      autoRevealedRef.current = null;
      if (typeof p.player_count === "number") setPlayerCount(p.player_count);
    };
    const onReveal = (p: { reveal: RevealData; leaderboard: LeaderRow[] }) => {
      setStatus("reveal");
      setReveal(p.reveal);
      setLeaderboard(p.leaderboard || []);
    };
    const onPodium = (p: { leaderboard: LeaderRow[] }) => {
      setStatus("podium");
      setLeaderboard(p.leaderboard || []);
    };
    const onLobby = (p: { players: PlayerRow[] }) => {
      setStatus("lobby");
      setPlayers(p.players || []);
      setPlayerCount((p.players || []).length);
    };
    const onPlayers = (p: { players: PlayerRow[]; player_count?: number }) => {
      setPlayers(p.players || []);
      setPlayerCount(p.player_count ?? (p.players || []).length);
    };
    const onProgress = (p: { answered_count: number }) => setAnsweredCount(p.answered_count || 0);
    const onPong = (p: { client_sent_at_ms?: number; server_now_ms?: number }) => {
      if (!p?.client_sent_at_ms || !p.server_now_ms) return;
      const receivedAt = Date.now();
      const roundTrip = receivedAt - p.client_sent_at_ms;
      setServerOffsetMs(p.server_now_ms + roundTrip / 2 - receivedAt);
    };

    socket.on("connect", join);
    socket.on("game:host", applyHost);
    socket.on("game:question", onQuestion);
    socket.on("game:reveal", onReveal);
    socket.on("game:podium", onPodium);
    socket.on("game:lobby", onLobby);
    socket.on("game:players", onPlayers);
    socket.on("game:progress", onProgress);
    socket.on("game:time:pong", onPong);
    if (socket.connected) join();
    const pingTimer = window.setInterval(() => socket?.emit("game:time:ping", { client_sent_at_ms: Date.now() }), 5000);

    return () => {
      window.clearInterval(pingTimer);
      socket?.disconnect();
      socket = null;
      socketRef.current = null;
    };
  }, [token]);

  const estimatedNow = tick + serverOffsetMs;
  const remainingMs = question && status === "question" ? Math.max(0, question.endsAt - estimatedNow) : 0;
  const secondsLeft = Math.ceil(remainingMs / 1000);

  // Host drives the per-question timer: auto-reveal once when it hits zero.
  useEffect(() => {
    if (status !== "question" || !question) return;
    if (remainingMs > 0) return;
    if (autoRevealedRef.current === question.index) return;
    autoRevealedRef.current = question.index;
    socketRef.current?.emit("game:host:reveal", { room_token: token });
  }, [status, question, remainingMs, token]);

  const emit = (event: string) => socketRef.current?.emit(event, { room_token: token });
  const isLastQuestion = question ? question.index + 1 >= question.total : false;

  return (
    <main style={livePageStyle}>
      <button type="button" onClick={onExit} style={exitFabStyle} title="退出主持">
        <i className="fas fa-xmark" aria-hidden="true" /> 退出
      </button>

      {status === "lobby" ? (
        <div style={lobbyStyle}>
          <h1 style={lobbyTitleStyle}>{title}</h1>
          {qrDataUrl ? (
            <div style={qrCardStyle}>
              <img src={qrDataUrl} alt="扫码加入" style={{ width: "min(240px,50vw)", display: "block" }} />
            </div>
          ) : null}
          <div style={joinHintStyle}>
            📱 扫码加入 · 房间号 <b style={{ color: "var(--x-color-accent)" }}>{token}</b>
          </div>
          <div style={pcountStyle}>{playerCount}</div>
          <div style={mutedStyle}>位玩家已加入</div>
          <div style={chipsStyle}>
            {players.map((p) => (
              <span key={p.id} style={{ ...chipStyle, opacity: p.online ? 1 : 0.4 }}>
                {p.name}
              </span>
            ))}
          </div>
          <button type="button" onClick={() => emit("game:host:start")} disabled={playerCount === 0} style={bigActionBtnStyle}>
            <i className="fas fa-play" aria-hidden="true" /> 开始游戏
          </button>
        </div>
      ) : null}

      {(status === "question" || status === "reveal") && question ? (
        <div style={questionScreenStyle}>
          <div style={qTopBar}>
            <span style={qNumChip}>
              {question.index + 1}/{question.total}
            </span>
            {question.section ? <span style={qSectionStyle}>{question.section}</span> : null}
            <div style={qTimerTrack}>
              <div style={{ ...qTimerBar, width: status === "reveal" ? "0%" : `${(remainingMs / (question.time * 1000)) * 100}%` }} />
            </div>
            <span style={qBigTime}>{status === "reveal" ? "⏱" : secondsLeft}</span>
          </div>

          <div style={qCardStyle}>
            <div style={qCardZh}>{question.zh}</div>
            {question.en ? <div style={qCardEn}>{question.en}</div> : null}
          </div>

          <div style={hostOptionsGrid}>
            {question.options.map((opt, i) => {
              const isCorrect = reveal && reveal.correct === i;
              const dim = status === "reveal" && !isCorrect;
              return (
                <div key={i} style={hostOptionStyle(i, dim, Boolean(isCorrect))}>
                  <span style={optShape}>{OPTION_SHAPES[i]}</span>
                  <div style={{ flex: 1 }}>
                    <div style={hostOptZh}>{opt.zh}</div>
                    {opt.en ? <div style={hostOptEn}>{opt.en}</div> : null}
                  </div>
                  {status === "reveal" && reveal ? <span style={countChip}>{reveal.counts[i] ?? 0} 人</span> : null}
                </div>
              );
            })}
          </div>

          {status === "reveal" ? (
            <div style={interLbStyle}>
              {leaderboard.slice(0, 5).map((row) => (
                <div key={row.id} style={interRowStyle}>
                  <span>
                    #{row.rank} {row.name}
                    {row.lastGain ? <span style={{ color: "var(--x-color-success)", marginLeft: "8px" }}>+{row.lastGain}</span> : null}
                  </span>
                  <span style={{ fontWeight: 900 }}>{row.score}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div style={statusRowStyle}>
            <div style={{ fontWeight: 800 }}>
              已作答 <b style={{ color: "var(--x-color-accent)", fontSize: "24px" }}>{answeredCount}</b> / {playerCount}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              {status === "question" ? (
                <button type="button" onClick={() => emit("game:host:reveal")} style={ghostActionBtnStyle}>
                  <i className="fas fa-eye" aria-hidden="true" /> 提前公布
                </button>
              ) : (
                <button type="button" onClick={() => emit("game:host:next")} style={bigActionBtnStyle}>
                  {isLastQuestion ? "查看积分榜 🏆" : "下一题 ➜"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {status === "podium" ? (
        <div style={podiumStyle}>
          <h1 style={lobbyTitleStyle}>🏆 最终积分榜</h1>
          <div style={podiumStageStyle}>
            {[1, 0, 2].map((pos) => {
              const e = leaderboard[pos];
              if (!e) return <div key={pos} />;
              const heights = [200, 150, 110];
              const medals = ["🥇", "🥈", "🥉"];
              return (
                <div key={pos} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                  <div style={{ fontWeight: 900, fontSize: "clamp(16px,2.4vw,24px)" }}>{e.name}</div>
                  <div style={mutedStyle}>{e.score} 分</div>
                  <div style={{ ...pillarStyle, height: `${heights[pos]}px`, background: podiumColors[pos] }}>{medals[pos]}</div>
                </div>
              );
            })}
          </div>
          <ol style={fullBoardStyle}>
            {leaderboard.map((row) => (
              <li key={row.id} style={fullRowStyle(row.rank)}>
                <span style={{ minWidth: "40px", fontWeight: 900 }}>{row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : `#${row.rank}`}</span>
                <span style={{ flex: 1, fontWeight: 800 }}>{row.name}</span>
                <span style={{ fontWeight: 900, color: "var(--x-color-accent)" }}>{row.score}</span>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => emit("game:host:reset")} style={ghostActionBtnStyle}>
            <i className="fas fa-rotate-left" aria-hidden="true" /> 重新开始
          </button>
        </div>
      ) : null}
    </main>
  );
}

/* ═══════════════════ styles ═══════════════════ */

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--x-color-canvas)", color: "var(--x-color-ink)" };
const setupShellStyle: CSSProperties = { width: "min(900px, calc(100% - 32px))", margin: "0 auto", padding: "16px 0 40px" };
const topBarStyle: CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: "12px", minHeight: "54px" };
const kickerStyle: CSSProperties = { display: "block", color: "var(--x-color-ink-muted)", fontSize: "12px", fontWeight: 900, textTransform: "uppercase" };
const h1Style: CSSProperties = { margin: 0, fontSize: "24px" };
const ghostBtnStyle: CSSProperties = {
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 14px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};
const errorStyle: CSSProperties = { margin: "12px 0", padding: "12px 14px", borderRadius: "8px", background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)", fontWeight: 800 };
const infoCardStyle: CSSProperties = { marginTop: "24px", padding: "40px 20px", textAlign: "center", borderRadius: "12px", border: "1px dashed var(--x-color-line)", color: "var(--x-color-ink-muted)", fontWeight: 800 };
const sectionLabelStyle: CSSProperties = { margin: "20px 0 12px", fontWeight: 900, color: "var(--x-color-ink-muted)" };
const setGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" };
const setCardStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "8px", padding: "18px", border: "1px solid var(--x-color-line)", borderRadius: "12px", background: "var(--x-color-panel)", boxShadow: "0 8px 20px var(--x-color-shadow-soft)" };
const setTitleStyle: CSSProperties = { fontSize: "18px", fontWeight: 900, lineHeight: 1.3 };
const setDescStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "14px" };
const setMetaStyle: CSSProperties = { display: "flex", gap: "14px", color: "var(--x-color-ink-muted)", fontWeight: 700, fontSize: "14px", marginTop: "auto" };
const setActionsStyle: CSSProperties = { display: "flex", gap: "10px", marginTop: "6px" };
const startBtnStyle: CSSProperties = { flex: 1, minHeight: "44px", border: "none", borderRadius: "8px", background: "var(--x-color-accent)", color: "white", fontWeight: 900, cursor: "pointer" };
const editBtnStyle: CSSProperties = { minHeight: "44px", padding: "0 16px", border: "1px solid var(--x-color-line)", borderRadius: "8px", background: "var(--x-color-surface)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" };
const newSetBtnStyle: CSSProperties = { marginTop: "20px", width: "100%", minHeight: "54px", border: "2px dashed var(--x-color-line)", borderRadius: "12px", background: "transparent", color: "var(--x-color-accent-strong)", fontWeight: 900, fontSize: "16px", cursor: "pointer" };

const livePageStyle: CSSProperties = { minHeight: "100vh", background: "var(--x-color-canvas)", color: "var(--x-color-ink)", padding: "20px", boxSizing: "border-box" };
const exitFabStyle: CSSProperties = { position: "fixed", top: "12px", right: "16px", zIndex: 9, display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 16px", border: "1px solid var(--x-color-line)", borderRadius: "999px", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 800, cursor: "pointer" };

const lobbyStyle: CSSProperties = { minHeight: "calc(100vh - 40px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", textAlign: "center" };
const lobbyTitleStyle: CSSProperties = { fontSize: "clamp(28px,4vw,44px)", margin: 0 };
const qrCardStyle: CSSProperties = { background: "white", borderRadius: "18px", padding: "14px", boxShadow: "0 10px 30px var(--x-color-shadow-soft)" };
const joinHintStyle: CSSProperties = { fontSize: "18px", fontWeight: 700 };
const pcountStyle: CSSProperties = { fontSize: "clamp(40px,7vw,72px)", fontWeight: 900, color: "var(--x-color-accent)", lineHeight: 1 };
const mutedStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontWeight: 700 };
const chipsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "center", maxWidth: "900px", maxHeight: "30vh", overflow: "auto" };
const chipStyle: CSSProperties = { background: "var(--x-color-panel-alt)", padding: "8px 18px", borderRadius: "999px", fontWeight: 700 };
const bigActionBtnStyle: CSSProperties = { minHeight: "58px", padding: "0 40px", border: "none", borderRadius: "14px", background: "var(--x-color-accent)", color: "white", fontSize: "22px", fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 26px var(--x-color-shadow-soft)" };
const ghostActionBtnStyle: CSSProperties = { minHeight: "48px", padding: "0 22px", border: "1px solid var(--x-color-line)", borderRadius: "10px", background: "var(--x-color-panel)", color: "var(--x-color-ink)", fontWeight: 900, fontSize: "16px", cursor: "pointer" };

const questionScreenStyle: CSSProperties = { maxWidth: "1100px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px", paddingTop: "8px" };
const qTopBar: CSSProperties = { display: "flex", alignItems: "center", gap: "16px" };
const qNumChip: CSSProperties = { fontWeight: 900, fontSize: "20px", background: "var(--x-color-panel-alt)", padding: "8px 18px", borderRadius: "999px", whiteSpace: "nowrap" };
const qSectionStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontWeight: 700, whiteSpace: "nowrap" };
const qTimerTrack: CSSProperties = { flex: 1, height: "16px", background: "var(--x-color-panel-alt)", borderRadius: "999px", overflow: "hidden" };
const qTimerBar: CSSProperties = { height: "100%", background: "linear-gradient(90deg,#2bd66b,#ffd23f,#ff5a5a)", transition: "width 0.2s linear" };
const qBigTime: CSSProperties = { fontSize: "32px", fontWeight: 900, minWidth: "56px", textAlign: "center" };
const qCardStyle: CSSProperties = { background: "var(--x-color-panel)", border: "1px solid var(--x-color-line)", borderRadius: "18px", padding: "22px 26px" };
const qCardZh: CSSProperties = { fontSize: "clamp(20px,3vw,32px)", fontWeight: 800, lineHeight: 1.5, whiteSpace: "pre-wrap" };
const qCardEn: CSSProperties = { fontSize: "clamp(13px,1.6vw,18px)", opacity: 0.7, marginTop: "8px", whiteSpace: "pre-wrap" };
const hostOptionsGrid: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" };
const hostOptionStyle = (i: number, dim: boolean, correct: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "16px 20px",
  borderRadius: "16px",
  color: "white",
  background: OPTION_COLORS[i % OPTION_COLORS.length],
  opacity: dim ? 0.28 : 1,
  filter: dim ? "grayscale(0.7)" : "none",
  outline: correct ? "5px solid var(--x-color-ink)" : "none",
  transform: correct ? "scale(1.02)" : "none",
  boxShadow: "0 5px 0 rgba(0,0,0,0.25)",
  transition: "opacity 0.25s, filter 0.25s",
});
const optShape: CSSProperties = { fontSize: "26px", fontWeight: 900 };
const hostOptZh: CSSProperties = { fontSize: "clamp(16px,2.2vw,24px)", fontWeight: 800, lineHeight: 1.3 };
const hostOptEn: CSSProperties = { fontSize: "clamp(11px,1.4vw,15px)", opacity: 0.85 };
const countChip: CSSProperties = { fontSize: "22px", fontWeight: 900, whiteSpace: "nowrap" };
const interLbStyle: CSSProperties = { maxWidth: "640px", margin: "0 auto", width: "100%", display: "grid", gap: "8px" };
const interRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--x-color-panel-alt)", borderRadius: "12px", padding: "10px 20px", fontWeight: 700, fontSize: "18px" };
const statusRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" };

const podiumStyle: CSSProperties = { minHeight: "calc(100vh - 40px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" };
const podiumStageStyle: CSSProperties = { display: "flex", alignItems: "flex-end", gap: "18px", height: "300px" };
const pillarStyle: CSSProperties = { width: "clamp(90px,12vw,150px)", borderRadius: "14px 14px 0 0", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12px", fontSize: "44px", marginTop: "8px" };
const podiumColors = ["linear-gradient(180deg,#ffd23f,#c98f00)", "linear-gradient(180deg,#cfd8ff,#8899cc)", "linear-gradient(180deg,#ffb37a,#b96a2e)"];
const fullBoardStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0, width: "min(560px,90vw)", maxHeight: "26vh", overflow: "auto", display: "grid", gap: "6px" };
const fullRowStyle = (rank: number): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "10px 16px",
  borderRadius: "10px",
  background: rank <= 3 ? "var(--x-color-accent-soft)" : "var(--x-color-panel-alt)",
});
