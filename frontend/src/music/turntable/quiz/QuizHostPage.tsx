import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";
import type { Socket } from "socket.io-client";

import { useUserState } from "../../../app/UserState";
import {
  createQuizSession,
  getQuizSession,
  publishQuizSession,
  resetQuizSession,
  saveQuizConfig,
} from "./api";
import { connectQuizSocket } from "./quizSocket";
import type { QuizSessionSnapshot } from "./types";

const HOST_TOKEN_STORAGE_KEY = "xinya.quiz.hostToken";
const MIN_WAIT = 3;
const MAX_WAIT = 600;

type Notice = { tone: "success" | "error" | "info"; text: string };

export function QuizHostPage({ onBack }: { onBack: () => void }) {
  const { isAuthenticated } = useUserState();
  const [snapshot, setSnapshot] = useState<QuizSessionSnapshot | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(6);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [qrDataUrl, setQrDataUrl] = useState("");

  const token = snapshot?.room_token || "";
  const guestUrl = useMemo(() => (token ? buildGuestUrl(token) : ""), [token]);
  const estimatedNow = tick + serverOffsetMs;
  const status = snapshot?.status || "draft";
  const isPublished = status !== "draft";
  const cutoff = snapshot?.cutoff_at_ms || 0;
  const remainingMs = cutoff ? Math.max(0, cutoff - estimatedNow) : 0;
  const leaderboard = snapshot?.leaderboard || [];

  useEffect(() => {
    let active = true;
    async function loadSession() {
      setLoading(true);
      setNotice(null);
      try {
        const storedToken = window.localStorage.getItem(HOST_TOKEN_STORAGE_KEY);
        let next: QuizSessionSnapshot | null = null;
        if (storedToken) {
          try {
            next = await getQuizSession(storedToken);
          } catch {
            window.localStorage.removeItem(HOST_TOKEN_STORAGE_KEY);
          }
        }
        if (!next) next = await createQuizSession();
        if (!active) return;
        window.localStorage.setItem(HOST_TOKEN_STORAGE_KEY, next.room_token);
        setSnapshot(next);
        setWaitSeconds(next.config.wait_seconds || 6);
      } catch (error) {
        if (active) setNotice({ tone: "error", text: error instanceof Error ? error.message : "读取抢答活动失败" });
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) return;
    let socket: Socket | null = connectQuizSocket();
    const join = () => {
      socket?.emit("quiz:host:join", { room_token: token });
      socket?.emit("quiz:time:ping", { client_sent_at_ms: Date.now() });
    };
    const applySnapshot = (next: QuizSessionSnapshot) => {
      if (!next?.room_token) return;
      setSnapshot(next);
    };
    const handlePong = (payload: { client_sent_at_ms?: number; server_now_ms?: number }) => {
      if (!payload?.client_sent_at_ms || !payload.server_now_ms) return;
      const receivedAt = Date.now();
      const roundTrip = receivedAt - payload.client_sent_at_ms;
      setServerOffsetMs(payload.server_now_ms + roundTrip / 2 - receivedAt);
    };

    socket.on("connect", join);
    socket.on("quiz:snapshot", applySnapshot);
    socket.on("quiz:config_updated", applySnapshot);
    socket.on("quiz:leaderboard", applySnapshot);
    socket.on("quiz:time:pong", handlePong);
    socket.on("quiz:error", (p: { message?: string }) => setNotice({ tone: "error", text: p?.message || "抢答连接错误" }));
    if (socket.connected) join();
    const pingTimer = window.setInterval(() => socket?.emit("quiz:time:ping", { client_sent_at_ms: Date.now() }), 5000);

    return () => {
      window.clearInterval(pingTimer);
      socket?.disconnect();
      socket = null;
    };
  }, [token]);

  useEffect(() => {
    if (!guestUrl) return;
    let active = true;
    void QRCode.toDataURL(guestUrl, { width: 320, margin: 1, color: { dark: "#111827", light: "#ffffff" } }).then(
      (dataUrl: string) => {
        if (active) setQrDataUrl(dataUrl);
      },
    );
    return () => {
      active = false;
    };
  }, [guestUrl]);

  async function handlePublish() {
    if (!token) return;
    const wait = clampWait(waitSeconds);
    setSaving(true);
    setNotice(null);
    try {
      await saveQuizConfig(token, { title: snapshot?.config.title || "", wait_seconds: wait });
      const next = await publishQuizSession(token);
      setSnapshot(next);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "发布失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleBackToPublish() {
    if (!token) return;
    setSaving(true);
    setNotice(null);
    try {
      const next = await resetQuizSession(token);
      setSnapshot(next);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "操作失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyGuestUrl() {
    if (!guestUrl) return;
    try {
      await navigator.clipboard.writeText(guestUrl);
      setNotice({ tone: "success", text: "游客入口已复制" });
    } catch {
      setNotice({ tone: "error", text: "复制失败" });
    }
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
        <header style={topBarStyle}>
          <button type="button" onClick={onBack} style={iconTextButtonStyle}>
            <i className="fas fa-arrow-left" aria-hidden="true" />
            <span>返回</span>
          </button>
          <div style={titleBlockStyle}>
            <span style={kickerStyle}>Quiz</span>
            <h1 style={h1Style}>抢答活动</h1>
          </div>
          <div aria-hidden="true" style={{ width: "88px" }} />
        </header>

        {notice ? <div style={noticeStyle(notice.tone)}>{notice.text}</div> : null}

        {!isPublished ? (
          /* ───────── PUBLISH PAGE ───────── */
          <section style={publishLayoutStyle}>
            <div style={qrCardStyle}>
              <div style={qrHintStyle}>扫码入场</div>
              {qrDataUrl ? (
                <div style={qrWrapStyle}>
                  <img src={qrDataUrl} alt="入场二维码" style={qrImgStyle} />
                </div>
              ) : null}
              <div style={tokenLargeStyle}>{token || "未生成"}</div>
              <button type="button" onClick={() => void handleCopyGuestUrl()} style={secondaryBtnStyle}>
                <i className="fas fa-copy" aria-hidden="true" />
                <span>复制链接</span>
              </button>
            </div>

            <div style={publishControlsStyle}>
              <div style={playerCountCardStyle}>
                <i className="fas fa-users" aria-hidden="true" style={{ fontSize: "22px", color: "var(--x-color-accent)" }} />
                <span style={playerCountNumStyle}>{snapshot?.player_count ?? 0}</span>
                <span style={playerCountLabelStyle}>已入场玩家</span>
              </div>

              {isAuthenticated ? (
                <label style={waitFieldStyle}>
                  <span style={labelStyle}>倒数秒数（发布后多少秒变绿）</span>
                  <input
                    type="number"
                    min={MIN_WAIT}
                    max={MAX_WAIT}
                    value={waitSeconds}
                    onChange={(e) => setWaitSeconds(Number.parseInt(e.target.value || "6", 10) || 6)}
                    style={inputStyle}
                  />
                </label>
              ) : null}

              <button type="button" disabled={saving} onClick={() => void handlePublish()} style={bigPublishBtnStyle}>
                <i className="fas fa-paper-plane" aria-hidden="true" />
                <span>{saving ? "发布中..." : "发布"}</span>
              </button>
              <div style={publishHintStyle}>发布后倒数 {clampWait(waitSeconds)} 秒，按钮变绿即可抢点</div>
            </div>
          </section>
        ) : (
          /* ───────── LEADERBOARD PAGE ───────── */
          <section style={boardLayoutStyle}>
            <div style={statusCenterStyle}>
              <span style={statusPillStyle(status)}>{hostStatusLabel(status)}</span>
              <span style={miniPlayerStyle}>
                <i className="fas fa-users" aria-hidden="true" /> {snapshot?.player_count ?? 0}
              </span>
            </div>

            {status === "waiting" ? (
              <div style={countdownWrapStyle}>
                <div style={countdownBigStyle}>{formatDuration(remainingMs)}</div>
                <div style={countdownSubStyle}>倒数中，截止后开放抢点</div>
              </div>
            ) : (
              <div style={openBannerStyle(status)}>
                {status === "open" ? "🟢 抢答进行中" : "已结束"}
              </div>
            )}

            <div style={boardCardStyle}>
              <div style={boardHeaderStyle}>
                <i className="fas fa-ranking-star" aria-hidden="true" style={{ color: "var(--x-color-accent)" }} />
                <h2 style={cardTitleStyle}>排行榜</h2>
                <span style={boardCountStyle}>{leaderboard.length} 人</span>
              </div>
              {leaderboard.length === 0 ? (
                <div style={emptyBoardStyle}>
                  <i className="fas fa-hourglass-half" aria-hidden="true" />
                  <span>{status === "waiting" ? "等待倒数结束" : "等待玩家抢点"}</span>
                </div>
              ) : (
                <ol style={boardListStyle}>
                  {leaderboard.map((row) => (
                    <li key={row.guest_id} style={boardRowStyle(row.rank)}>
                      <span style={rankBadgeStyle(row.rank)}>{row.rank}</span>
                      <span style={rowNameStyle}>{row.guest_name}</span>
                      <span style={rowDeltaStyle}>+{row.delta_from_cutoff_ms}ms</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div style={actionCenterStyle}>
              <button type="button" disabled={saving} onClick={() => void handleBackToPublish()} style={backBtnStyle}>
                <i className="fas fa-rotate-left" aria-hidden="true" />
                <span>退回发布页</span>
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/* ═══════════════════ helpers ═══════════════════ */

function clampWait(value: number) {
  return Math.max(MIN_WAIT, Math.min(MAX_WAIT, Math.round(value || 6)));
}

function buildGuestUrl(token: string) {
  if (window.location.port === "5173") {
    return `${window.location.origin}/#/music/turntable/quiz?token=${token}`;
  }
  return `${window.location.origin}/quiz?token=${token}`;
}

function hostStatusLabel(status: string) {
  if (status === "waiting") return "倒数中";
  if (status === "open") return "抢答开放";
  if (status === "closed") return "已关闭";
  return "未发布";
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

function formatDuration(ms: number) {
  const total = Math.max(0, ms);
  const seconds = Math.floor(total / 1000);
  const milliseconds = Math.floor(total % 1000);
  return `${seconds}.${pad(milliseconds, 3)}`;
}

/* ═══════════════════ styles ═══════════════════ */

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--x-color-canvas)",
  color: "var(--x-color-ink)",
};

const shellStyle: CSSProperties = {
  width: "min(960px, calc(100% - 32px))",
  margin: "0 auto",
  padding: "18px 0 32px",
};

const topBarStyle: CSSProperties = {
  minHeight: "54px",
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "14px",
};

const titleBlockStyle: CSSProperties = { textAlign: "center" };

const kickerStyle: CSSProperties = {
  display: "block",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  fontWeight: 800,
  textTransform: "uppercase",
};

const h1Style: CSSProperties = { margin: 0, fontSize: "24px", lineHeight: 1.15 };

const iconTextButtonStyle: CSSProperties = {
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 14px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
  fontWeight: 800,
};

const noticeStyle = (tone: Notice["tone"]): CSSProperties => ({
  margin: "12px 0",
  padding: "12px 14px",
  borderRadius: "8px",
  background:
    tone === "error" ? "var(--x-color-danger-soft)" : tone === "success" ? "var(--x-color-success-soft)" : "var(--x-color-info-soft)",
  color: tone === "error" ? "var(--x-color-danger)" : tone === "success" ? "var(--x-color-success)" : "var(--x-color-info)",
  fontWeight: 700,
});

const centerMessageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const labelStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
  fontWeight: 800,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "46px",
  boxSizing: "border-box",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  padding: "0 12px",
  color: "var(--x-color-ink)",
  background: "white",
  fontSize: "18px",
  fontWeight: 800,
  textAlign: "center",
};

/* ── publish page ── */

const publishLayoutStyle: CSSProperties = {
  marginTop: "18px",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: "20px",
  alignItems: "stretch",
};

const qrCardStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "16px",
  background: "var(--x-color-panel)",
  padding: "24px",
  display: "grid",
  gap: "14px",
  justifyItems: "center",
  alignContent: "center",
};

const qrHintStyle: CSSProperties = { fontSize: "18px", fontWeight: 900, color: "var(--x-color-ink)" };

const qrWrapStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "14px",
  background: "white",
  border: "1px solid var(--x-color-line)",
};

const qrImgStyle: CSSProperties = { width: "260px", height: "260px", display: "block", maxWidth: "60vw" };

const tokenLargeStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  fontSize: "34px",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  letterSpacing: "0.08em",
};

const publishControlsStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  alignContent: "center",
};

const playerCountCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "18px 22px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
};

const playerCountNumStyle: CSSProperties = {
  fontSize: "40px",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  fontFamily: "var(--x-font-mono)",
};

const playerCountLabelStyle: CSSProperties = { fontSize: "16px", fontWeight: 800, color: "var(--x-color-ink-muted)" };

const waitFieldStyle: CSSProperties = { display: "grid", gap: "8px" };

const bigPublishBtnStyle: CSSProperties = {
  minHeight: "76px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  borderRadius: "16px",
  border: "none",
  background: "var(--x-color-accent)",
  color: "white",
  fontSize: "28px",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 10px 26px var(--x-color-shadow-soft)",
};

const publishHintStyle: CSSProperties = {
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
  fontWeight: 700,
  fontSize: "14px",
};

const secondaryBtnStyle: CSSProperties = {
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "0 16px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontWeight: 900,
  cursor: "pointer",
};

/* ── leaderboard page ── */

const boardLayoutStyle: CSSProperties = { marginTop: "18px", display: "grid", gap: "20px", justifyItems: "center" };

const statusCenterStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "12px" };

const statusPillStyle = (status: string): CSSProperties => ({
  padding: "8px 18px",
  borderRadius: "999px",
  fontWeight: 900,
  fontSize: "14px",
  ...(status === "open"
    ? { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" }
    : status === "closed"
      ? { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" }
      : { background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)" }),
});

const miniPlayerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const countdownWrapStyle: CSSProperties = { textAlign: "center", display: "grid", gap: "6px" };

const countdownBigStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  fontSize: "88px",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  lineHeight: 1,
};

const countdownSubStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontWeight: 800 };

const openBannerStyle = (status: string): CSSProperties => ({
  fontSize: "26px",
  fontWeight: 900,
  color: status === "open" ? "var(--x-color-success)" : "var(--x-color-ink-muted)",
});

const boardCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: "620px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "14px",
  background: "var(--x-color-panel)",
  padding: "18px",
  display: "grid",
  gap: "12px",
};

const boardHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "10px" };

const cardTitleStyle: CSSProperties = { margin: 0, fontSize: "18px" };

const boardCountStyle: CSSProperties = { marginLeft: "auto", color: "var(--x-color-ink-muted)", fontWeight: 800 };

const emptyBoardStyle: CSSProperties = {
  minHeight: "120px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  border: "2px dashed var(--x-color-line)",
  borderRadius: "12px",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
};

const boardListStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" };

const boardRowStyle = (rank: number): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "12px 16px",
  borderRadius: "12px",
  border: rank <= 3 ? "2px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: rank <= 3 ? "var(--x-color-accent-soft)" : "var(--x-color-panel-alt)",
});

const rankBadgeStyle = (rank: number): CSSProperties => ({
  width: "36px",
  height: "36px",
  borderRadius: "999px",
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  fontWeight: 900,
  fontSize: "16px",
  background: rank === 1 ? "#f59e0b" : rank === 2 ? "#9ca3af" : rank === 3 ? "#b45309" : "var(--x-color-ink)",
  color: "white",
});

const rowNameStyle: CSSProperties = { flex: "1 1 auto", fontSize: "18px", fontWeight: 800, overflowWrap: "anywhere" };

const rowDeltaStyle: CSSProperties = {
  fontFamily: "var(--x-font-mono)",
  fontWeight: 900,
  color: "var(--x-color-accent)",
  flex: "0 0 auto",
};

const actionCenterStyle: CSSProperties = { display: "flex", gap: "12px", justifyContent: "center" };

const backBtnStyle: CSSProperties = {
  minHeight: "48px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "0 22px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  fontWeight: 900,
  fontSize: "16px",
  cursor: "pointer",
};
